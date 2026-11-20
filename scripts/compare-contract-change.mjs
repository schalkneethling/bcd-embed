import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  compareContentTrees,
  describeContentTree,
  loadContentTree,
  MAX_META_BYTES,
} from "../packages/generator/dist/index.js";
import {
  CONTRACT_VERSION,
  MAX_ROOT_BYTES,
  MAX_SHARD_BYTES,
  shardPath,
  snapshotRootPath,
  snapshotRootSchema,
  storedMetaResponseSchema,
} from "../packages/schema/dist/index.js";

const usage = "Usage: compare-contract-change --baseline <directory> --candidate <directory>";
const values = new Map();
const options = new Set(["--baseline", "--candidate"]);
for (let index = 2; index < process.argv.length; index += 2) {
  const option = process.argv[index];
  const value = process.argv[index + 1];
  if (!options.has(option) || values.has(option) || !value || value.startsWith("--"))
    throw new Error(usage);
  values.set(option, value);
}
const baselineRoot = values.get("--baseline");
const candidateRoot = values.get("--candidate");
if (baselineRoot === undefined || candidateRoot === undefined) throw new Error(usage);

/** Reads a file and refuses it above `cap` bytes. */
const readCapped = async (path, cap) => {
  const bytes = await readFile(join(baselineRoot, path));
  if (bytes.byteLength > cap) throw new Error(`'${path}' exceeds its ${cap}-byte cap.`);
  return bytes;
};

// The baseline was emitted under an earlier contract, so this code cannot load its bodies:
// `loadContentTree` rejects any contract but `CONTRACT_VERSION`, and that check stays strict for
// every freshness run. Like the publisher reading the live snapshot from R2, this reads only the
// baseline's metadata, root and shards, which have no contract-dependent shape, and compares
// pointers. The candidate is loaded and checked in full.
//
// Time is O(B) for the candidate's B bytes, which `loadContentTree` reads once, plus O(N) for the
// N feature pointers on each side. Memory is O(N) pointers plus one candidate file at a time.
const meta = storedMetaResponseSchema.parse(
  JSON.parse((await readCapped("v1/meta.json", MAX_META_BYTES)).toString("utf8")),
);
if (meta.contract === CONTRACT_VERSION) {
  throw new Error(
    `The baseline is already at contract ${CONTRACT_VERSION}. Compare it with compare-freshness-output.mjs, which checks both trees in full.`,
  );
}
const snapshot = meta.snapshots.find(({ id }) => id === meta.current);
const rootBytes = await readCapped(snapshotRootPath(meta.current), MAX_ROOT_BYTES);
const shardBytes = new Map();
for (const sha256 of new Set(
  snapshotRootSchema.parse(JSON.parse(rootBytes.toString("utf8"))).shards,
))
  shardBytes.set(sha256, await readCapped(shardPath(sha256), MAX_SHARD_BYTES));
const baseline = describeContentTree({
  snapshotId: meta.current,
  sourceVersion: snapshot.source.version,
  rootBytes,
  shardBytes,
});

const candidate = await loadContentTree(candidateRoot);
if (candidate === null) throw new Error("Candidate artifact tree must not be empty.");
const report = compareContentTrees(baseline, candidate);

// What a publication over this baseline uploads, computed as `publishCandidate` computes its
// upload list: three files per blob and one per shard the baseline lacks, plus the root.
const liveBlobs = new Set(Object.values(baseline.root.structural));
for (const pointer of baseline.features.values()) {
  liveBlobs.add(pointer.feature);
  liveBlobs.add(pointer.raw);
}
const liveShards = new Set(baseline.root.shards);
const blobs = [...candidate.blobs].filter((hash) => !liveBlobs.has(hash)).length;
const shards = [...candidate.shards].filter((hash) => !liveShards.has(hash)).length;
const upload = { blobs, shards, objects: blobs * 3 + shards + 1 };

process.stdout.write(
  `${JSON.stringify({ baselineContract: meta.contract, candidateContract: CONTRACT_VERSION, upload, ...report })}\n`,
);
if (report.blocked.length > 0) process.exitCode = 2;
