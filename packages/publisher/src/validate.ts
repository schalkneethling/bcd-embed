import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, opendir } from "node:fs/promises";
import { join, posix, resolve } from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createBrotliDecompress, createGunzip } from "node:zlib";

import {
  ARTIFACT_MANIFEST_PATH,
  artifactManifestSchema,
  browsersResponseSchema,
  featureResponseSchema,
  indexResponseSchema,
  metaResponseSchema,
  type ArtifactManifest,
  type ArtifactRepresentation,
  type MetaResponse,
} from "@bcd-embed/schema";
import { validateRawArtifact } from "@bcd-embed/generator";

export const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
export const MAX_META_BYTES = 256 * 1024;
export const MAX_IDENTITY_BYTES = 16 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_SHARD_BYTES = 2 * 1024 * 1024;

const boundedFile = async (path: string, maximum: number): Promise<Buffer> => {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    size += chunk.byteLength;
    if (size > maximum) throw new Error("Candidate file exceeds its reviewed byte cap.");
    if (chunk.byteLength > 0) chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

const hashFile = async (
  path: string,
  maximum: number,
): Promise<{ sha256: string; size: number }> => {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    size += chunk.byteLength;
    if (size > maximum) throw new Error("Candidate artifact exceeds its declared size.");
    hash.update(chunk);
  }
  return { sha256: hash.digest("hex"), size };
};

export const hashDecodedStream = async (
  input: NodeJS.ReadableStream,
  encoding: "br" | "gzip",
  maximumSize: number,
) => {
  const hash = createHash("sha256");
  let size = 0;
  const sink = new Writable({
    write(chunk: unknown, _encoding, callback) {
      if (!(chunk instanceof Uint8Array)) {
        callback(new Error("Decoder returned non-byte content."));
        return;
      }
      size += chunk.byteLength;
      if (size > maximumSize) {
        callback(new Error("Decoded artifact exceeds its declared identity size."));
        return;
      }
      hash.update(chunk);
      callback();
    },
  });
  await pipeline(input, encoding === "br" ? createBrotliDecompress() : createGunzip(), sink);
  return { sha256: hash.digest("hex"), size };
};

const filesUnder = async (root: string): Promise<Set<string>> => {
  const files = new Set<string>();
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const entries = await opendir(directory);
    for await (const entry of entries) {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Artifact tree contains a symlink at '${path}'.`);
      if (entry.isDirectory()) {
        await visit(join(directory, entry.name), path);
      } else if (entry.isFile()) {
        files.add(path);
      } else {
        throw new Error(`Artifact tree contains a non-file at '${path}'.`);
      }
    }
  };
  await visit(root, "");
  return files;
};

/** Derive the entire required identity inventory from validated index content. */
const validateIdentityInventory = async (
  root: string,
  manifest: ArtifactManifest,
  meta: MetaResponse,
): Promise<void> => {
  const prefix = `v1/${manifest.snapshotId}/`;
  const logicalPaths = new Set(
    manifest.artifacts
      .filter((item) => item.encoding === "identity")
      .map((item) => item.logicalPath),
  );
  const readIdentity = async (path: string): Promise<unknown> => {
    if (!logicalPaths.has(path)) {
      throw new Error(`Candidate manifest is missing required identity artifact '${path}'.`);
    }
    const maximum = path.startsWith(`${prefix}index/`) ? MAX_SHARD_BYTES : MAX_IDENTITY_BYTES;
    return JSON.parse((await boundedFile(join(root, path), maximum)).toString("utf8"));
  };
  const current = meta.snapshots[0]!;
  const envelopeMatches = (value: {
    contract: string;
    generated: string;
    source: { package: string; version: string };
  }): boolean =>
    value.contract === meta.contract &&
    value.generated === current.generated &&
    value.source.package === current.source.package &&
    value.source.version === current.source.version;
  const browsersPath = `${prefix}browsers.json`;
  const indexPath = `${prefix}index.json`;
  const browsers = browsersResponseSchema.parse(await readIdentity(browsersPath));
  const index = indexResponseSchema.parse(await readIdentity(indexPath));
  if (
    meta.generated !== current.generated ||
    !envelopeMatches(browsers) ||
    !envelopeMatches(index) ||
    index.namespace !== null
  ) {
    throw new Error("Candidate browser or index envelope does not match metadata.");
  }
  const expected = new Set(["v1/meta.json", browsersPath, indexPath]);
  const allKeys = new Set(index.keys);
  if (allKeys.size !== index.keys.length)
    throw new Error("Candidate all-index contains duplicate keys.");
  const shardKeys = new Set<string>();
  for (const namespace of meta.namespaces) {
    const shardPath = `${prefix}index/${namespace}.json`;
    const shard = indexResponseSchema.parse(await readIdentity(shardPath));
    if (!envelopeMatches(shard) || shard.namespace !== namespace) {
      throw new Error("Candidate index shard does not match its metadata namespace.");
    }
    expected.add(shardPath);
    for (const key of shard.keys) {
      if (
        (key !== namespace && !key.startsWith(`${namespace}.`)) ||
        !allKeys.has(key) ||
        shardKeys.has(key)
      ) {
        throw new Error("Candidate index shard has duplicate, foreign, or unlisted keys.");
      }
      shardKeys.add(key);
    }
  }
  if (shardKeys.size !== allKeys.size) throw new Error("Candidate index shards omit features.");
  for (const key of allKeys) {
    const featurePath = `${prefix}features/${key}.json`;
    const rawPath = `${prefix}raw/${key}.json`;
    expected.add(featurePath);
    expected.add(rawPath);
    const feature = featureResponseSchema.parse(await readIdentity(featurePath));
    if (!envelopeMatches(feature) || feature.query !== key) {
      throw new Error("Candidate feature does not match its index key or metadata envelope.");
    }
    validateRawArtifact(await readIdentity(rawPath));
  }
  if (
    logicalPaths.size !== expected.size ||
    [...logicalPaths].some((path) => !expected.has(path))
  ) {
    throw new Error("Candidate manifest lacks required index-derived artifacts or has extras.");
  }
};

export type ValidatedCandidate = {
  root: string;
  manifest: ArtifactManifest;
  meta: MetaResponse;
  manifestFile: { size: number; sha256: string };
  representations: ReadonlyMap<string, ArtifactRepresentation>;
};

/** Verify the exact local upload set and each compressed variant against its identity bytes. */
export const validateCandidate = async (candidateRoot: string): Promise<ValidatedCandidate> => {
  const root = resolve(candidateRoot);
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("Candidate root must be a regular directory.");
  }
  const manifestPath = join(root, ARTIFACT_MANIFEST_PATH);
  const manifestInfo = await lstat(manifestPath);
  if (
    !manifestInfo.isFile() ||
    manifestInfo.isSymbolicLink() ||
    manifestInfo.size > MAX_MANIFEST_BYTES
  ) {
    throw new Error("Candidate manifest must be a bounded regular file.");
  }
  const manifestBytes = await boundedFile(manifestPath, MAX_MANIFEST_BYTES);
  const manifest = artifactManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
  const manifestFile = {
    size: manifestBytes.byteLength,
    sha256: createHash("sha256").update(manifestBytes).digest("hex"),
  };
  let totalBytes = manifestBytes.byteLength;
  for (const artifact of manifest.artifacts) {
    if (artifact.encoding === "identity" && artifact.size > MAX_IDENTITY_BYTES)
      throw new Error("Candidate identity exceeds the reviewed 16 MiB policy.");
    totalBytes += artifact.size;
    if (totalBytes > MAX_TOTAL_BYTES)
      throw new Error("Candidate representations exceed the reviewed 2 GiB aggregate policy.");
  }
  const byPath = new Map(manifest.artifacts.map((artifact) => [artifact.path, artifact]));
  const found = await filesUnder(root);
  const expected = new Set([ARTIFACT_MANIFEST_PATH, ...byPath.keys()]);
  if (found.size !== expected.size || [...found].some((path) => !expected.has(path))) {
    throw new Error("Candidate tree does not match its complete manifest inventory.");
  }
  for (const artifact of manifest.artifacts) {
    if (posix.normalize(artifact.path) !== artifact.path || artifact.path.startsWith("/")) {
      throw new Error("Manifest contains an unsafe object path.");
    }
    const absolute = join(root, artifact.path);
    const info = await lstat(absolute);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== artifact.size)
      throw new Error(`Candidate artifact '${artifact.path}' differs from its manifest size.`);
    const measured = await hashFile(absolute, artifact.size);
    if (measured.size !== artifact.size || measured.sha256 !== artifact.sha256) {
      throw new Error(`Candidate artifact '${artifact.path}' differs from its manifest.`);
    }
    if (artifact.encoding !== "identity") {
      const identity = byPath.get(artifact.logicalPath);
      if (identity === undefined || identity.encoding !== "identity") {
        throw new Error(`Compressed artifact '${artifact.path}' lacks identity bytes.`);
      }
      const decoded = await hashDecodedStream(
        createReadStream(absolute),
        artifact.encoding,
        identity.size,
      );
      if (decoded.size !== identity.size || decoded.sha256 !== identity.sha256) {
        throw new Error(`Compressed artifact '${artifact.path}' does not encode its identity.`);
      }
    }
  }
  const metaPath = join(root, "v1/meta.json");
  const metaInfo = await lstat(metaPath);
  if (metaInfo.size > MAX_META_BYTES)
    throw new Error("Candidate metadata exceeds server read cap.");
  const meta = metaResponseSchema.parse(
    JSON.parse((await boundedFile(metaPath, MAX_META_BYTES)).toString("utf8")),
  );
  if (meta.current !== manifest.snapshotId || meta.snapshots.length !== 1) {
    throw new Error("Candidate metadata must describe exactly the manifested snapshot.");
  }
  await validateIdentityInventory(root, manifest, meta);
  return { root, manifest, meta, manifestFile, representations: byPath };
};
