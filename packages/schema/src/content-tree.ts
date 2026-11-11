import { z } from "zod";
import { type ContentEncoding } from "./artifacts.js";
import { featureKeySchema, namespaceSchema, snapshotIdentifierSchema } from "./schemas.js";

/**
 * Content-addressed storage layout (Document 8). These files are internal to the bucket: the
 * Worker reads them to answer a request, and no public route returns them.
 *
 *   v1/blobs/<sha256>.json{,.gz,.br}   a served file's bytes, named by the hash of its plain bytes
 *   v1/shards/<sha256>.json            the pointers for the feature keys of one shard
 *   v1/snapshots/<snapshot>.json       the root: 256 shard hashes plus the structural pointers
 */

/** A feature key's shard is the first byte of the SHA-256 hash of the key, so there are 256. */
export const SHARD_COUNT = 256;
export const CONTENT_TREE_VERSION = 1 as const;

export const contentHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export type ContentHash = z.infer<typeof contentHashSchema>;

/** Both files a feature key answers with: `features/<key>.json` and `raw/<key>.json`. */
export const featurePointerSchema = z.strictObject({
  feature: contentHashSchema,
  raw: contentHashSchema,
});
export type FeaturePointer = z.infer<typeof featurePointerSchema>;

const isSorted = (keys: readonly string[]): boolean =>
  keys.every((key, index) => index === 0 || keys[index - 1]! < key);

/**
 * Keys are in ascending code unit order, so that two snapshots with the same pointers produce the
 * same bytes, and therefore the same shard hash, whatever order the generator visited them in.
 */
export const shardSchema = z
  .strictObject({
    version: z.literal(CONTENT_TREE_VERSION),
    pointers: z.record(featureKeySchema, featurePointerSchema),
  })
  .refine((shard) => isSorted(Object.keys(shard.pointers)), {
    message: "Shard keys must be in ascending order.",
  });
export type Shard = z.infer<typeof shardSchema>;

/** Paths below the snapshot that are not per-feature: browsers.json and the index files. */
const structuralPathSchema = z.string().refine((path) => {
  if (path === "browsers.json" || path === "index.json") return true;
  const namespace = /^index\/([^/]+)\.json$/.exec(path);
  return namespace !== null && namespaceSchema.safeParse(namespace[1]).success;
}, "Unexpected structural path.");

export const snapshotRootSchema = z
  .strictObject({
    version: z.literal(CONTENT_TREE_VERSION),
    snapshot: snapshotIdentifierSchema,
    /** Index N holds the hash of the shard for keys whose hash starts with byte N. */
    shards: z.array(contentHashSchema).length(SHARD_COUNT),
    structural: z.record(structuralPathSchema, contentHashSchema),
  })
  .refine(
    (root) =>
      isSorted(Object.keys(root.structural)) &&
      Object.hasOwn(root.structural, "browsers.json") &&
      Object.hasOwn(root.structural, "index.json"),
    { message: "Structural pointers must be sorted and include browsers.json and index.json." },
  );
export type SnapshotRoot = z.infer<typeof snapshotRootSchema>;

const ENCODING_SUFFIX: Record<ContentEncoding, string> = { identity: "", br: ".br", gzip: ".gz" };

/** `sha256` is the hash of the plain bytes for all three encodings, as for `v1/_meta/`. */
export function blobPath(sha256: string, encoding: ContentEncoding): string {
  return `v1/blobs/${contentHashSchema.parse(sha256)}.json${ENCODING_SUFFIX[encoding]}`;
}

export function shardPath(sha256: string): string {
  return `v1/shards/${contentHashSchema.parse(sha256)}.json`;
}

export function snapshotRootPath(snapshotId: string): string {
  return `v1/snapshots/${snapshotIdentifierSchema.parse(snapshotId)}.json`;
}
