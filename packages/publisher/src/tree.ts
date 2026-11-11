import { describeContentTree, type ContentTree } from "@bcd-embed/generator";
import { shardPath, snapshotRootPath, snapshotRootSchema, type Snapshot } from "@bcd-embed/schema";

import { runBounded } from "./concurrency.js";
import { PublisherError } from "./errors.js";
import { readSmallObject } from "./objects.js";
import type { PublicationStore } from "./store.js";
import { MAX_ROOT_BYTES, MAX_SHARD_BYTES } from "./validate.js";

/**
 * Reads a published snapshot's pointers: its root and the shards the root names, which is at most
 * 257 reads. Every object's bytes are checked against the SHA-256 stored with it, each shard
 * against the name the root gives it, and each key against the shard its hash selects. Blobs are
 * not read: they were verified when their snapshot was published.
 */
export const readPublishedTree = async (
  store: PublicationStore,
  snapshot: Pick<Snapshot, "id" | "source">,
): Promise<ContentTree> => {
  const rootBytes = await readSmallObject(store, snapshotRootPath(snapshot.id), MAX_ROOT_BYTES);
  if (rootBytes === null) throw new PublisherError("Published snapshot has no root.");
  let shardNames: string[];
  try {
    const root = snapshotRootSchema.parse(JSON.parse(Buffer.from(rootBytes).toString("utf8")));
    shardNames = [...new Set(root.shards)];
  } catch {
    throw new PublisherError("Published snapshot root is not a valid root.");
  }
  const shardBytes = new Map<string, Uint8Array>();
  await runBounded(shardNames, async (sha256) => {
    const bytes = await readSmallObject(store, shardPath(sha256), MAX_SHARD_BYTES);
    if (bytes === null) throw new PublisherError("Published snapshot is missing a shard.");
    shardBytes.set(sha256, bytes);
  });
  try {
    return describeContentTree({
      snapshotId: snapshot.id,
      sourceVersion: snapshot.source.version,
      rootBytes,
      shardBytes,
    });
  } catch {
    throw new PublisherError("Published snapshot's root and shards do not agree.");
  }
};
