import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  blobPath,
  CONTENT_TREE_VERSION,
  representationPath,
  SHARD_COUNT,
  shardPath,
  shardSchema,
  snapshotIdentifierSchema,
  snapshotRootPath,
  snapshotRootSchema,
  type ContentEncoding,
  type FeaturePointer,
  type SnapshotRoot,
} from "@bcd-embed/schema";

import {
  acquireOutputLock,
  assertArtifactIdentity,
  assertArtifactPath,
  assertMatchingMeta,
  fileBytes,
  pathIn,
  regularFileAt,
  stagingPrefix,
} from "./emit.js";
import type { GeneratedSnapshot } from "./generate.js";
import { createRepresentations } from "./representations.js";

const sha256Hex = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

/** The shard of a feature key: the first byte of the SHA-256 hash of its UTF-8 bytes. O(|key|). */
export const shardIndexOf = (key: string): number =>
  createHash("sha256").update(key, "utf8").digest()[0]!;

/** Says which blob answers one request path of a snapshot. */
export type ContentPointer =
  | { kind: "feature" | "raw"; key: string; sha256: string }
  | { kind: "structural"; path: string; sha256: string };

export type PointerTreeFile = { path: string; sha256: string; bytes: Uint8Array };
export type PointerTree = {
  root: SnapshotRoot;
  rootFile: PointerTreeFile;
  /** One entry per shard index, so `shardFiles[n]` is the shard that `root.shards[n]` names. */
  shardFiles: PointerTreeFile[];
};

const byCodeUnit = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

/**
 * Builds the 256 shards and the root from a snapshot's pointers.
 *
 * Time: O(N) to place N pointers into shards, because each key is hashed once, plus
 * O(N log(N / 256)) to sort the keys inside each shard. Space: O(N) for the pointers; no served
 * file's bytes are held. For BCD 8.1.8, N is 41,880 pointers and a shard holds 60 to 106 keys.
 */
export const createPointerTree = (
  snapshotId: string,
  pointers: Iterable<ContentPointer>,
): PointerTree => {
  snapshotIdentifierSchema.parse(snapshotId);
  const shards = Array.from(
    { length: SHARD_COUNT },
    () => new Map<string, Partial<FeaturePointer>>(),
  );
  const structural = new Map<string, string>();

  for (const pointer of pointers) {
    if (pointer.kind === "structural") {
      if (structural.has(pointer.path))
        throw new Error(`Duplicate structural pointer '${pointer.path}'.`);
      structural.set(pointer.path, pointer.sha256);
      continue;
    }
    const shard = shards[shardIndexOf(pointer.key)]!;
    const entry = shard.get(pointer.key) ?? {};
    if (entry[pointer.kind] !== undefined)
      throw new Error(`Duplicate ${pointer.kind} pointer for '${pointer.key}'.`);
    entry[pointer.kind] = pointer.sha256;
    shard.set(pointer.key, entry);
  }

  const shardFiles = shards.map((shard) => {
    // Sorting makes the bytes depend only on the pointers, not on the generator's visiting order.
    const keys = [...shard.keys()].sort(byCodeUnit);
    const body = shardSchema.parse({
      version: CONTENT_TREE_VERSION,
      pointers: Object.fromEntries(
        keys.map((key) => {
          const { feature, raw } = shard.get(key)!;
          if (feature === undefined || raw === undefined)
            throw new Error(`Feature key '${key}' lacks its normalized or its raw pointer.`);
          return [key, { feature, raw }];
        }),
      ),
    });
    const bytes = fileBytes(body);
    const sha256 = sha256Hex(bytes);
    return { path: shardPath(sha256), sha256, bytes };
  });

  const root = snapshotRootSchema.parse({
    version: CONTENT_TREE_VERSION,
    snapshot: snapshotId,
    shards: shardFiles.map(({ sha256 }) => sha256),
    structural: Object.fromEntries(
      [...structural].sort(([left], [right]) => byCodeUnit(left, right)),
    ),
  });
  const rootBytes = fileBytes(root);
  return {
    root,
    rootFile: {
      path: snapshotRootPath(snapshotId),
      sha256: sha256Hex(rootBytes),
      bytes: rootBytes,
    },
    shardFiles,
  };
};

/** What a comparison needs to know about one snapshot, whether it was read from disk or from R2. */
export type ContentTree = {
  snapshotId: string;
  /** The BCD version the snapshot was generated from. */
  sourceVersion: string;
  /** The hash of the root file. It covers the snapshot's identifier and every pointer. */
  digest: string;
  /** The hash of the pointers alone, so two snapshots with the same data share it. */
  semanticDigest: string;
  root: SnapshotRoot;
  features: ReadonlyMap<string, FeaturePointer>;
  /** The namespaces that have an index file, in ascending order. */
  namespaces: readonly string[];
};

export type DescribeContentTreeOptions = {
  snapshotId: string;
  sourceVersion: string;
  rootBytes: Uint8Array;
  /** The bytes of every shard the root names, by shard hash. */
  shardBytes: ReadonlyMap<string, Uint8Array>;
};

/**
 * Checks a root and its shards against each other and returns the snapshot's pointers.
 *
 * It verifies that each shard's bytes hash to the name the root gives it, and that every key is in
 * the shard its hash selects. It does not read blobs. Time and space are O(N) for N feature keys.
 */
export const describeContentTree = ({
  snapshotId,
  sourceVersion,
  rootBytes,
  shardBytes,
}: DescribeContentTreeOptions): ContentTree => {
  const root = snapshotRootSchema.parse(JSON.parse(Buffer.from(rootBytes).toString("utf8")));
  if (root.snapshot !== snapshotId)
    throw new Error(`Root names snapshot '${root.snapshot}', not '${snapshotId}'.`);

  const features = new Map<string, FeaturePointer>();
  const verified = new Map<string, Record<string, FeaturePointer>>();
  root.shards.forEach((sha256, index) => {
    let pointers = verified.get(sha256);
    if (pointers === undefined) {
      const bytes = shardBytes.get(sha256);
      if (bytes === undefined) throw new Error(`Shard '${sha256}' is missing.`);
      if (sha256Hex(bytes) !== sha256)
        throw new Error(`Shard '${sha256}' does not hash to its name.`);
      pointers = shardSchema.parse(JSON.parse(Buffer.from(bytes).toString("utf8"))).pointers;
      verified.set(sha256, pointers);
    }
    for (const [key, pointer] of Object.entries(pointers)) {
      if (shardIndexOf(key) !== index)
        throw new Error(
          `Feature key '${key}' is in shard ${index}, which its hash does not select.`,
        );
      features.set(key, pointer);
    }
  });

  const namespaces = Object.keys(root.structural).flatMap((path) => {
    const match = /^index\/(.+)\.json$/.exec(path);
    return match === null ? [] : [match[1]!];
  });
  return {
    snapshotId,
    sourceVersion,
    digest: sha256Hex(rootBytes),
    semanticDigest: sha256Hex(JSON.stringify({ shards: root.shards, structural: root.structural })),
    root,
    features,
    namespaces,
  };
};

export type EmitContentTreeOptions = {
  outputRoot: string;
  generatedSnapshot: GeneratedSnapshot;
};

export type ContentTreeEmission = {
  snapshotId: string;
  /** The hash of the root file. It covers every shard and blob, so it identifies the snapshot. */
  rootSha256: string;
  /** Served files in the snapshot, not counting `meta.json`. */
  artifacts: number;
  /** Distinct blobs among those files; fewer than `artifacts` when files share bytes. */
  blobs: number;
  /** Files this run created: three per new blob, plus new shards, the root, and metadata. */
  filesWritten: number;
  /** Blobs and shards that the output root already held from an earlier snapshot. */
  filesReused: number;
};

const ENCODINGS = ["br", "gzip", "identity"] as const satisfies readonly ContentEncoding[];

/**
 * Emits a snapshot as content-addressed blobs, 256 shards and a root (Document 8).
 *
 * No file is named after a feature key, so keys that differ only in case, such as `api.Crypto` and
 * `api.crypto`, cannot collide on a case-insensitive filesystem. A rerun into the same output
 * root reuses the blobs and shards it finds there, after comparing their bytes. An output root
 * holds one candidate: existing metadata that names another snapshot is refused, not replaced.
 *
 * Time: one pass over the N artifacts. Each file's B bytes are serialized, hashed and compressed
 * once, so the work is O(total bytes), plus `createPointerTree`. A blob that already exists is
 * compared with the new bytes and not compressed again. Space: O(N) pointers plus one file's bytes
 * at a time; the largest BCD 8.1.8 file is 3.4 MB.
 */
export const emitContentTree = async ({
  outputRoot,
  generatedSnapshot,
}: EmitContentTreeOptions): Promise<ContentTreeEmission> => {
  if (outputRoot.trim().length === 0) throw new Error("Output root must not be empty.");
  const snapshotId = generatedSnapshot.snapshot.id;
  snapshotIdentifierSchema.parse(snapshotId);

  const root = resolve(outputRoot);
  await mkdir(root, { recursive: true });
  const lockPath = await acquireOutputLock(root);
  let stagingRoot: string | undefined;

  try {
    stagingRoot = await mkdtemp(join(root, stagingPrefix));
    const staging = stagingRoot;
    let staged = 0;
    let filesWritten = 0;
    let filesReused = 0;

    /** Writes through a staging file so that a file never exists under its final name half-written. */
    const place = async (path: string, bytes: Uint8Array): Promise<void> => {
      const destination = pathIn(root, path);
      const temporary = join(staging, String((staged += 1)));
      await writeFile(temporary, bytes, { flag: "wx" });
      await mkdir(dirname(destination), { recursive: true });
      await rename(temporary, destination);
      filesWritten += 1;
    };

    /** An immutable file that already exists must hold exactly the bytes this run produced. */
    const existsWithBytes = async (path: string, bytes: Uint8Array): Promise<boolean> => {
      const destination = pathIn(root, path);
      const regularFile = await regularFileAt(destination);
      if (regularFile === undefined) return false;
      if (!regularFile) throw new Error(`Existing path '${path}' is not a regular file.`);
      if (!(await readFile(destination)).equals(bytes))
        throw new Error(`Existing immutable file '${path}' differs from the generated bytes.`);
      return true;
    };

    const snapshotPrefix = `v1/${snapshotId}/`;
    const seenPaths = new Set<string>();
    const seenBlobs = new Set<string>();
    const pointers: ContentPointer[] = [];
    let metaBytes: Uint8Array | undefined;

    for (const artifact of generatedSnapshot.artifacts) {
      assertArtifactPath(artifact, snapshotId);
      assertArtifactIdentity(artifact, generatedSnapshot);
      if (seenPaths.has(artifact.path))
        throw new Error(`Generated artifact path collision at '${artifact.path}'.`);
      seenPaths.add(artifact.path);

      const bytes = fileBytes(artifact.data);
      if (artifact.kind === "meta") {
        if (metaBytes !== undefined)
          throw new Error("Generated snapshot contains multiple metadata artifacts.");
        metaBytes = bytes;
        continue;
      }

      const sha256 = sha256Hex(bytes);
      pointers.push(
        artifact.kind === "feature" || artifact.kind === "raw"
          ? { kind: artifact.kind, key: basename(artifact.path, ".json"), sha256 }
          : { kind: "structural", path: artifact.path.slice(snapshotPrefix.length), sha256 },
      );
      if (seenBlobs.has(sha256)) continue;
      seenBlobs.add(sha256);

      // The plain file is written last, so its presence means all three encodings are complete.
      if (await existsWithBytes(blobPath(sha256, "identity"), bytes)) {
        for (const encoding of ["br", "gzip"] as const) {
          if ((await regularFileAt(pathIn(root, blobPath(sha256, encoding)))) !== true)
            throw new Error(`Existing blob '${sha256}' lacks its ${encoding} encoding.`);
        }
        filesReused += ENCODINGS.length;
        continue;
      }
      const encoded = new Map(
        createRepresentations(artifact.path, bytes).map((item) => [item.encoding, item.bytes]),
      );
      for (const encoding of ENCODINGS)
        await place(blobPath(sha256, encoding), encoded.get(encoding)!);
    }

    if (metaBytes === undefined || pointers.length === 0)
      throw new Error("Generated snapshot must contain metadata and snapshot artifacts.");

    const tree = createPointerTree(snapshotId, pointers);
    const seenShards = new Set<string>();
    for (const shard of tree.shardFiles) {
      if (seenShards.has(shard.sha256)) continue;
      seenShards.add(shard.sha256);
      if (await existsWithBytes(shard.path, shard.bytes)) filesReused += 1;
      else await place(shard.path, shard.bytes);
    }
    if (!(await existsWithBytes(tree.rootFile.path, tree.rootFile.bytes)))
      await place(tree.rootFile.path, tree.rootFile.bytes);

    // Metadata goes last and is never replaced: it is the file that names the snapshot.
    const metaPath = "v1/meta.json";
    const stagedMeta = join(staging, "meta.json");
    await writeFile(stagedMeta, metaBytes, { flag: "wx" });
    const metaState = await assertMatchingMeta(stagedMeta, pathIn(root, metaPath));
    for (const { encoding, path, bytes } of createRepresentations(metaPath, metaBytes)) {
      if (encoding === "identity") continue;
      if (!(await existsWithBytes(path, bytes))) await place(path, bytes);
    }
    if (metaState === "created") await place(representationPath(metaPath, "identity"), metaBytes);

    return {
      snapshotId,
      rootSha256: tree.rootFile.sha256,
      artifacts: pointers.length,
      blobs: seenBlobs.size,
      filesWritten,
      filesReused,
    };
  } finally {
    try {
      if (stagingRoot !== undefined) await rm(stagingRoot, { recursive: true, force: true });
    } finally {
      await rm(lockPath, { force: true });
    }
  }
};
