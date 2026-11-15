import { createHash } from "node:crypto";

import {
  blobPath,
  CONTENT_TREE_VERSION,
  SHARD_COUNT,
  shardPath,
  shardSchema,
  snapshotIdentifierSchema,
  snapshotRootPath,
  snapshotRootSchema,
  type ContentEncoding,
} from "@bcd-embed/schema";

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const shardIndexOf = (key: string): number => createHash("sha256").update(key, "utf8").digest()[0]!;
const byCodeUnit = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
const ENCODINGS: readonly ContentEncoding[] = ["identity", "br", "gzip"];

/**
 * Builds the content-addressed bucket that the handler reads, from files named the way tests
 * think about them: `v1/<snapshot>/<path below the snapshot>`. Any other path, such as
 * `v1/meta.json`, is stored as given.
 *
 * Each file becomes a blob in all three encodings. A compressed copy holds a marker instead of
 * real compressed bytes, because the handler streams it without decoding. A feature key given
 * only a normalized or only a raw file points both at the same blob. A snapshot without
 * `browsers.json` or `index.json` gets an empty one, because the root schema requires both.
 *
 * The shard rule (first byte of the key's SHA-256) is written out again here, so these tests do
 * not depend on the generator. The Worker tests serve a tree the real generator emitted.
 */
export const contentStore = (files: Record<string, unknown>) => {
  const stored = new Map<string, string>();
  const locatedChains = new Map<string, { chain: string[]; hash: string }>();
  const shardsBySnapshot = new Map<string, string[]>();
  const snapshots = new Map<string, Map<string, unknown>>();

  for (const [path, value] of Object.entries(files)) {
    const match = /^v1\/([^/]+)\/(.+)$/.exec(path);
    if (match === null || !snapshotIdentifierSchema.safeParse(match[1]).success) {
      stored.set(path, JSON.stringify(value));
      continue;
    }
    const tree = snapshots.get(match[1]!) ?? new Map<string, unknown>();
    tree.set(match[2]!, value);
    snapshots.set(match[1]!, tree);
  }
  const metadata = files["v1/meta.json"] as { snapshots?: { id: string }[] } | undefined;
  for (const { id } of metadata?.snapshots ?? []) {
    if (snapshotIdentifierSchema.safeParse(id).success && !snapshots.has(id))
      snapshots.set(id, new Map());
  }

  const putBlob = (value: unknown): string => {
    const body = JSON.stringify(value);
    const hash = sha256(body);
    for (const encoding of ENCODINGS)
      stored.set(
        blobPath(hash, encoding),
        encoding === "identity" ? body : JSON.stringify({ encoded: encoding, of: value }),
      );
    return hash;
  };

  for (const [id, tree] of snapshots) {
    for (const path of ["browsers.json", "index.json"]) if (!tree.has(path)) tree.set(path, {});
    const structural: Record<string, string> = {};
    const pointers = Array.from(
      { length: SHARD_COUNT },
      () => new Map<string, { feature?: string; raw?: string }>(),
    );
    const located: [string, string, string | null][] = [];
    for (const [path, value] of [...tree].sort(([left], [right]) => byCodeUnit(left, right))) {
      const hash = putBlob(value);
      const feature = /^(features|raw)\/(.+)\.json$/.exec(path);
      if (feature === null) {
        structural[path] = hash;
        located.push([path, hash, null]);
        continue;
      }
      const key = feature[2]!;
      const shard = pointers[shardIndexOf(key)]!;
      const entry = shard.get(key) ?? {};
      entry[feature[1] === "features" ? "feature" : "raw"] = hash;
      shard.set(key, entry);
      located.push([path, hash, key]);
    }
    const shardHashes = pointers.map((shard) => {
      const body = JSON.stringify(
        shardSchema.parse({
          version: CONTENT_TREE_VERSION,
          pointers: Object.fromEntries(
            [...shard]
              .sort(([left], [right]) => byCodeUnit(left, right))
              .map(([key, { feature, raw }]) => [
                key,
                { feature: feature ?? raw!, raw: raw ?? feature! },
              ]),
          ),
        }),
      );
      const hash = sha256(body);
      stored.set(shardPath(hash), body);
      return hash;
    });
    const root = snapshotRootSchema.parse({
      version: CONTENT_TREE_VERSION,
      snapshot: id,
      shards: shardHashes,
      structural,
    });
    stored.set(snapshotRootPath(id), JSON.stringify(root));
    shardsBySnapshot.set(id, shardHashes);
    for (const [path, hash, key] of located) {
      const chain = [snapshotRootPath(id)];
      if (key !== null) chain.push(shardPath(shardHashes[shardIndexOf(key)]!));
      locatedChains.set(`${id}/${path}`, { chain, hash });
    }
  }

  return {
    /** The path of the pointer shard a key belongs to, whether or not the key has pointers. */
    shardFor(snapshot: string, key: string): string {
      const shards = shardsBySnapshot.get(snapshot);
      if (shards === undefined) throw new Error(`No test snapshot ${snapshot}.`);
      return shardPath(shards[shardIndexOf(key)]!);
    },
    /** Storage path to stored body. Tests may delete entries to simulate corruption. */
    files: stored,
    /**
     * The reads after `v1/meta.json` that serve one file: the root, the shard for a feature key,
     * then the blob in the requested encoding.
     */
    reads(snapshot: string, path: string, encoding: ContentEncoding = "identity"): string[] {
      const found = locatedChains.get(`${snapshot}/${path}`);
      if (found === undefined) throw new Error(`No test file ${snapshot}/${path}.`);
      return [...found.chain, blobPath(found.hash, encoding)];
    },
  };
};
