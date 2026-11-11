import { createHash } from "node:crypto";
import { lstat, opendir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";

import {
  blobPath,
  browsersResponseSchema,
  CONTRACT_VERSION,
  featureResponseSchema,
  indexResponseSchema,
  metaResponseSchema,
  representationPath,
  shardPath,
  snapshotRootPath,
  snapshotRootSchema,
  type MetaResponse,
} from "@bcd-embed/schema";

import { describeContentTree, type ContentTree } from "./content-tree.js";
import { validateRawArtifact } from "./input.js";

/** Reviewed caps: no single file above 16 MiB, and no tree above 2 GiB in all its encodings. */
export const MAX_CONTENT_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_CONTENT_TREE_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_META_BYTES = 256 * 1024;

const META_PATH = "v1/meta.json";
const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** A snapshot read from a local folder, with every file it needs checked. */
export type LocalContentTree = ContentTree & {
  directory: string;
  meta: MetaResponse;
  metaBytes: Uint8Array;
  rootBytes: Uint8Array;
  /** The distinct blobs the pointers name. Each has three files: plain, Brotli and gzip. */
  blobs: ReadonlySet<string>;
  /** The distinct shards the root names. */
  shards: ReadonlySet<string>;
};

const filesUnder = async (root: string): Promise<Set<string>> => {
  const files = new Set<string>();
  const visit = async (directory: string, prefix: string): Promise<void> => {
    let entries = 0;
    for await (const entry of await opendir(directory)) {
      entries += 1;
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink '${path}'.`);
      if (entry.isDirectory()) await visit(join(directory, entry.name), path);
      else if (entry.isFile()) files.add(path);
      else throw new Error(`Unexpected artifact entry '${path}'.`);
    }
    if (entries === 0 && prefix !== "") throw new Error(`Unexpected empty directory '${prefix}'.`);
  };
  await visit(root, "");
  return files;
};

const parse = <T>(schema: { parse(value: unknown): T }, bytes: Uint8Array, path: string): T => {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch (cause) {
    throw new Error(`Invalid JSON in '${path}'.`, { cause });
  }
  try {
    return schema.parse(value);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "Schema validation failed.";
    throw new Error(`Invalid artifact '${path}': ${detail}`, { cause });
  }
};

const assertContract = (value: { contract: string }, path: string): void => {
  if (value.contract !== CONTRACT_VERSION)
    throw new Error(`Unexpected contract version in '${path}'.`);
};

/**
 * Reads a snapshot that `emitContentTree` wrote and checks all of it: every pointer resolves to a
 * blob whose bytes hash to its name, both compressed copies decode to those bytes, every body
 * matches its schema, the indexes cover exactly the feature keys, and the folder holds no file the
 * snapshot does not name. Returns `null` for an empty folder, which stands for "no baseline".
 *
 * Each file is read once, and its hash and its parsed value come from those same bytes. Time is
 * O(total bytes); memory is O(N) pointers plus one file at a time.
 */
export const loadContentTree = async (path: string): Promise<LocalContentTree | null> => {
  const directory = resolve(path);
  let info;
  try {
    info = await lstat(directory);
  } catch (cause) {
    throw new Error(`Artifact directory '${path}' does not exist.`, { cause });
  }
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error(`Artifact root '${path}' must be a regular directory.`);

  const unread = await filesUnder(directory);
  if (unread.size === 0) return null;
  let totalBytes = 0;

  /** Reads a file the snapshot names, at most once, and counts it against the caps. */
  const read = async (relativePath: string, cap = MAX_CONTENT_FILE_BYTES): Promise<Buffer> => {
    if (!unread.delete(relativePath))
      throw new Error(`Artifact tree '${path}' is missing '${relativePath}'.`);
    const absolute = join(directory, relativePath);
    const size = (await lstat(absolute)).size;
    totalBytes += size;
    if (size > cap || totalBytes > MAX_CONTENT_TREE_BYTES)
      throw new Error(`'${relativePath}' exceeds the reviewed byte caps.`);
    return readFile(absolute);
  };

  /** Checks that both compressed copies of `bytes` decode to it. */
  const assertEncodings = async (
    bytes: Buffer,
    pathFor: (encoding: "br" | "gzip") => string,
  ): Promise<void> => {
    for (const encoding of ["br", "gzip"] as const) {
      const encodedPath = pathFor(encoding);
      const encoded = await read(encodedPath);
      let decoded: Buffer;
      try {
        const options = { maxOutputLength: Math.max(bytes.byteLength, 1) };
        decoded =
          encoding === "br" ? brotliDecompressSync(encoded, options) : gunzipSync(encoded, options);
      } catch (cause) {
        throw new Error(`'${encodedPath}' does not decode.`, { cause });
      }
      if (!decoded.equals(bytes))
        throw new Error(`'${encodedPath}' does not decode to its plain bytes.`);
    }
  };

  const metaBytes = await read(META_PATH, MAX_META_BYTES);
  const meta = parse(metaResponseSchema, metaBytes, META_PATH);
  if (meta.snapshots.length !== 1 || meta.snapshots[0]!.id !== meta.current)
    throw new Error(`Artifact tree '${path}' must describe exactly its current snapshot.`);
  if (new Set(meta.namespaces).size !== meta.namespaces.length)
    throw new Error(`Artifact tree '${path}' contains duplicate metadata namespaces.`);
  const metaSha256 = sha256Hex(metaBytes);
  await assertEncodings(metaBytes, (encoding) =>
    representationPath(META_PATH, encoding, metaSha256),
  );

  const snapshotId = meta.current;
  const rootBytes = await read(snapshotRootPath(snapshotId));
  const shardNames = new Set(
    parse(snapshotRootSchema, rootBytes, snapshotRootPath(snapshotId)).shards,
  );
  const shardBytes = new Map<string, Uint8Array>();
  for (const sha256 of shardNames) shardBytes.set(sha256, await read(shardPath(sha256)));
  const tree = describeContentTree({
    snapshotId,
    sourceVersion: meta.snapshots[0]!.source.version,
    rootBytes,
    shardBytes,
  });

  const blobs = new Set<string>();
  /** Returns a blob's plain bytes the first time it is asked for, and `null` after that. */
  const blob = async (sha256: string): Promise<Buffer | null> => {
    if (blobs.has(sha256)) return null;
    blobs.add(sha256);
    const plainPath = blobPath(sha256, "identity");
    const bytes = await read(plainPath);
    if (sha256Hex(bytes) !== sha256) throw new Error(`'${plainPath}' does not hash to its name.`);
    await assertEncodings(bytes, (encoding) => blobPath(sha256, encoding));
    return bytes;
  };
  const structural = async (relativePath: string): Promise<Buffer> => {
    const bytes = await blob(tree.root.structural[relativePath]!);
    if (bytes === null) throw new Error(`'${relativePath}' shares its bytes with another file.`);
    return bytes;
  };

  const browsers = parse(
    browsersResponseSchema,
    await structural("browsers.json"),
    "browsers.json",
  );
  assertContract(browsers, "browsers.json");
  const index = parse(indexResponseSchema, await structural("index.json"), "index.json");
  assertContract(index, "index.json");
  if (
    index.namespace !== null ||
    index.keys.length !== tree.features.size ||
    new Set(index.keys).size !== index.keys.length ||
    index.keys.some((key) => !tree.features.has(key))
  )
    throw new Error(`Global index does not exactly cover the feature pointers in '${path}'.`);

  if (
    tree.namespaces.length !== meta.namespaces.length ||
    tree.namespaces.some((namespace) => !meta.namespaces.includes(namespace))
  )
    throw new Error(`Namespace indexes do not match metadata in '${path}'.`);
  let indexed = 0;
  for (const namespace of tree.namespaces) {
    const indexPath = `index/${namespace}.json`;
    const shard = parse(indexResponseSchema, await structural(indexPath), indexPath);
    assertContract(shard, indexPath);
    if (
      shard.namespace !== namespace ||
      shard.keys.length === 0 ||
      new Set(shard.keys).size !== shard.keys.length ||
      shard.keys.some(
        (key) => (key !== namespace && !key.startsWith(`${namespace}.`)) || !tree.features.has(key),
      )
    )
      throw new Error(`Index '${indexPath}' has missing, duplicate or foreign keys.`);
    indexed += shard.keys.length;
  }
  if (indexed !== tree.features.size)
    throw new Error(`Namespace indexes do not cover the feature pointers in '${path}'.`);

  const validRaw = new Set<string>();
  for (const [key, pointer] of tree.features) {
    const featurePath = `features/${key}.json`;
    const featureBytes = await blob(pointer.feature);
    // A normalized body carries its own key, so no two keys can validly share one.
    if (featureBytes === null)
      throw new Error(`'${featurePath}' shares its bytes with another file.`);
    const feature = parse(featureResponseSchema, featureBytes, featurePath);
    assertContract(feature, featurePath);
    if (feature.query !== key) throw new Error(`Query does not match '${featurePath}'.`);

    // Raw bodies carry no key, so keys with the same data share a blob. Validate it once.
    const rawBytes = await blob(pointer.raw);
    if (rawBytes === null) {
      if (!validRaw.has(pointer.raw))
        throw new Error(`'raw/${key}.json' shares its bytes with a file of another kind.`);
      continue;
    }
    try {
      validateRawArtifact(JSON.parse(rawBytes.toString("utf8")));
    } catch (cause) {
      throw new Error(`Invalid raw artifact 'raw/${key}.json'.`, { cause });
    }
    validRaw.add(pointer.raw);
  }

  if (unread.size > 0)
    throw new Error(`Artifact tree '${path}' holds unexpected file '${[...unread].sort()[0]}'.`);
  return { ...tree, directory, meta, metaBytes, rootBytes, blobs, shards: shardNames };
};
