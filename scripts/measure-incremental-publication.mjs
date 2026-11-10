// Measures how much of a snapshot the incremental publication design in
// docs/planning/08-incremental-publication.md could reuse from the snapshot before it.
//
// It generates two snapshots in memory, removes the release fields (`generated` and
// `source`) from every normalized body as the design proposes, and compares the SHA-256
// hash of each file's bytes. Nothing is written to disk or to R2.
//
// The generator accepts only the BCD version it is pinned to, so each snapshot comes from
// its own built copy of the generator. To measure 8.1.7 against 8.1.8:
//
//   git worktree add --detach <directory> 2a6c06e^   # the last commit pinned to 8.1.7
//   (cd <directory> && pnpm install --frozen-lockfile && pnpm --filter @bcd-embed/generator... run build)
//   pnpm build
//   node scripts/measure-incremental-publication.mjs \
//     --baseline <directory>/packages/generator/dist/index.js \
//     --candidate packages/generator/dist/index.js
//
// Time is O(B), where B is the total bytes of both snapshots: each artifact is serialized
// and hashed once. Space is O(F) for F files, because only a hash and a size are kept per
// file; the bytes of a file are held only while it is hashed, and again only for the files
// that are new in the candidate, to measure their compressed sizes.
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const usage =
  "Usage: measure-incremental-publication --baseline <generator-module> --candidate <generator-module>";
const SHARD_COUNT = 256;
// Any valid pair works: both fields are removed before hashing.
const GENERATED = "2026-01-01T00:00:00Z";
const EXPIRES = "2026-02-01";

const values = new Map();
const options = new Set(["--baseline", "--candidate"]);
for (let index = 2; index < process.argv.length; index += 2) {
  const option = process.argv[index];
  const value = process.argv[index + 1];
  if (!options.has(option) || values.has(option) || !value || value.startsWith("--"))
    throw new Error(usage);
  values.set(option, value);
}
const baselineModule = values.get("--baseline");
const candidateModule = values.get("--candidate");
if (baselineModule === undefined || candidateModule === undefined) throw new Error(usage);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest();
const perFeature = /^(?:features|raw)\/(.+)\.json$/;

/**
 * Generate one snapshot and reduce it to a hash and a size per file.
 * `onFile` sees each file's bytes once, so the caller can measure new files without this
 * function keeping every body in memory.
 */
const measureSnapshot = async (modulePath, onFile) => {
  const generator = await import(pathToFileURL(resolve(modulePath)).href);
  const { snapshot, artifacts } = generator.generateSnapshot({
    generated: GENERATED,
    expires: EXPIRES,
  });
  const prefix = `v1/${snapshot.id}/`;
  const files = new Map();
  // One running hash per shard. Artifacts arrive in a fixed order, so hashing each pointer
  // as it arrives gives the same result as hashing the finished shard.
  const shards = Array.from({ length: SHARD_COUNT }, () => createHash("sha256"));
  const shardKeys = new Uint32Array(SHARD_COUNT);
  for (const artifact of artifacts) {
    // `v1/meta.json` is the one mutable file and stays outside the content-addressed tree.
    if (artifact.kind === "meta") continue;
    if (!artifact.path.startsWith(prefix))
      throw new Error(`Unexpected artifact path '${artifact.path}'.`);
    const path = artifact.path.slice(prefix.length);
    // Raw files are BCD's own data and carry no release fields. A raw subtree may hold a
    // feature that is itself named `source`, so the fields are removed only from the
    // normalized bodies.
    let body = artifact.data;
    if (artifact.kind !== "raw") {
      const { generated: _generated, source: _source, ...rest } = artifact.data;
      body = rest;
    }
    const bytes = Buffer.from(JSON.stringify(body));
    const hash = sha256(bytes).toString("hex");
    files.set(path, { hash, size: bytes.byteLength });
    const key = perFeature.exec(path)?.[1];
    if (key !== undefined) {
      const shard = sha256(key)[0];
      shards[shard].update(`${path}\n${hash}\n`);
      if (path.startsWith("features/")) shardKeys[shard] += 1;
    }
    onFile?.(hash, bytes);
  }
  return {
    version: snapshot.source.version,
    files,
    shardHashes: shards.map((shard) => shard.digest("hex")),
    shardKeys,
    createRepresentations: generator.createRepresentations,
  };
};

const baseline = await measureSnapshot(baselineModule);
const baselineBlobs = new Set(Array.from(baseline.files.values(), ({ hash }) => hash));

// A blob is new when no file in the baseline has the same bytes, whatever its path.
const newBlobs = new Map();
const candidate = await measureSnapshot(candidateModule, (hash, bytes) => {
  if (!baselineBlobs.has(hash) && !newBlobs.has(hash)) newBlobs.set(hash, bytes);
});

const kinds = ["features", "raw", "structural"];
const kindOf = (path) => (perFeature.test(path) ? path.slice(0, path.indexOf("/")) : "structural");
const counts = Object.fromEntries(
  kinds.map((kind) => [kind, { identical: 0, changed: 0, added: 0, removed: 0 }]),
);
for (const [path, { hash }] of candidate.files) {
  const before = baseline.files.get(path);
  const outcome = before === undefined ? "added" : before.hash === hash ? "identical" : "changed";
  counts[kindOf(path)][outcome] += 1;
}
for (const path of baseline.files.keys()) {
  if (!candidate.files.has(path)) counts[kindOf(path)].removed += 1;
}

const total = { identical: 0, changed: 0, added: 0, removed: 0 };
for (const kind of kinds)
  for (const outcome of Object.keys(total)) total[outcome] += counts[kind][outcome];
const changedShards = candidate.shardHashes.filter(
  (hash, shard) => hash !== baseline.shardHashes[shard],
).length;

const newBytes = { identity: 0, gzip: 0, br: 0 };
for (const [hash, bytes] of newBlobs) {
  for (const { encoding, size } of candidate.createRepresentations(`${hash}.json`, bytes)) {
    newBytes[encoding] += size;
  }
}
const candidateBlobs = new Set(Array.from(candidate.files.values(), ({ hash }) => hash));
let candidateBytes = 0;
for (const { size } of candidate.files.values()) candidateBytes += size;
const keysPerShard = Array.from(candidate.shardKeys);

process.stdout.write(
  `${JSON.stringify(
    {
      baseline: baseline.version,
      candidate: candidate.version,
      files: { ...counts, total },
      candidateFiles: candidate.files.size,
      identicalShare: total.identical / candidate.files.size,
      candidateBlobs: candidateBlobs.size,
      candidateIdentityBytes: candidateBytes,
      newBlobs: newBlobs.size,
      newBlobBytes: newBytes,
      shards: {
        count: SHARD_COUNT,
        changed: changedShards,
        fewestKeys: Math.min(...keysPerShard),
        mostKeys: Math.max(...keysPerShard),
      },
      // Three encodings per new blob, each changed shard, and the snapshot's root.
      // Compare-and-swap of `v1/meta.json` comes on top and is unchanged by the design.
      immutableWrites: newBlobs.size * 3 + changedShards + 1,
    },
    null,
    2,
  )}\n`,
);
