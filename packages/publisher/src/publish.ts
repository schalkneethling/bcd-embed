import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  compareContentTrees,
  createRepresentations,
  type ContentTree,
  type DiffApproval,
  type DiffReport,
} from "@bcd-embed/generator";
import {
  blobPath,
  generatedTimestampSchema,
  metaResponseSchema,
  releaseDateSchema,
  shardPath,
  snapshotIdentifierSchema,
  snapshotRootPath,
  type MetaResponse,
  type Snapshot,
} from "@bcd-embed/schema";
import { compare as compareVersions, valid as validVersion } from "semver";

import type { PublicationStore } from "./store.js";
import { putAndVerify, readMetadata, readVerified } from "./objects.js";
import { runBounded } from "./concurrency.js";
import { PublisherError } from "./errors.js";
import { countOperations, type OperationCounts } from "./operations.js";
import { readPublishedTree } from "./tree.js";
import { putImmutable, realSleep, type Sleep } from "./upload.js";
import { MAX_META_BYTES, validateCandidate, type ValidatedCandidate } from "./validate.js";

const META_KEY = "v1/meta.json";
const RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1_000;
const PRUNE_PAGE_SIZE = 1_000;
/** An unreferenced object is kept this long, so a publication in progress never loses a blob. */
const GRACE_DAYS = 7;
/**
 * Compressed copies of superseded metadata are deleted only once the current metadata has been
 * in place this long. The server reads `meta.json` and then the copy named by its hash, so a copy
 * must outlive every request that read the metadata it belongs to.
 */
const META_SETTLE_DAYS = 1;
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
export type PublicationClock = () => Date;
const wallClock: PublicationClock = () => new Date();
const readClock = (clock: PublicationClock): Date => {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new PublisherError("Publication clock must return a finite Date.");
  }
  return value;
};

const assertMonotonic = (previous: Snapshot | undefined, candidate: Snapshot, now: Date): void => {
  const generated = Date.parse(candidate.generated);
  const expiry = Date.parse(candidate.expires);
  if (generated > now.getTime() || expiry <= now.getTime()) {
    throw new PublisherError("Candidate generation/expiry time is not publishable now.");
  }
  if (expiry - generated > RETENTION_DAYS * DAY_MS) {
    throw new PublisherError("Candidate retention exceeds the reviewed 90-day policy.");
  }
  if (
    [candidate.source.version, candidate.generatorVersion].some(
      (version) => validVersion(version) === null,
    )
  ) {
    throw new PublisherError(
      "Snapshot source and generator versions must be valid SemVer for publication.",
    );
  }
  if (previous === undefined) return;
  if (generated <= Date.parse(previous.generated)) {
    throw new PublisherError("New snapshot generation must be later than published current.");
  }
  const source = candidate.source.version;
  const priorSource = previous.source.version;
  const generator = candidate.generatorVersion;
  const priorGenerator = previous.generatorVersion;
  if (
    [source, priorSource, generator, priorGenerator].some(
      (version) => validVersion(version) === null,
    )
  ) {
    throw new PublisherError(
      "Snapshot source and generator versions must be valid SemVer for publication.",
    );
  }
  if (compareVersions(source, priorSource) < 0 || compareVersions(generator, priorGenerator) < 0) {
    throw new PublisherError("Candidate would downgrade published source or generator version.");
  }
};

const mergedMetadata = (candidate: MetaResponse, previous: MetaResponse | undefined, now: Date) => {
  const kept: Snapshot[] = [];
  for (const snapshot of previous?.snapshots ?? []) {
    if (snapshot.id !== candidate.current && Date.parse(snapshot.expires) > now.getTime()) {
      kept.push(snapshot);
    }
  }
  const body = metaResponseSchema.parse({
    ...candidate,
    snapshots: [candidate.snapshots[0], ...kept],
  });
  const bytes = Buffer.from(`${JSON.stringify(body)}\n`, "utf8");
  if (bytes.byteLength > MAX_META_BYTES)
    throw new PublisherError("Merged metadata exceeds server read cap.");
  return { body, bytes };
};

/** Variants are named by the hash of the plain metadata, so an existing one is accepted if it decodes to it. */
const uploadMetaVariants = async (store: PublicationStore, bytes: Uint8Array, sleep: Sleep) => {
  const representations = createRepresentations(META_KEY, bytes);
  const identity = representations.find((item) => item.encoding === "identity")!;
  for (const item of representations) {
    if (item.encoding === "identity") continue;
    await putImmutable(
      store,
      {
        key: item.path,
        bytes: item.bytes,
        sha256: item.sha256,
        encoded: { encoding: item.encoding, identity },
      },
      sleep,
    );
  }
  return identity;
};

/** Scheduled/no-change retention still needs a metadata CAS before physical cleanup. */
const retireExpiredMembership = async (
  store: PublicationStore,
  now: Date,
  sleep: Sleep,
): Promise<void> => {
  const remote = await readMetadata(store);
  if (remote === null) throw new PublisherError("Canonical metadata is required before pruning.");
  const treeDigest = remote.object.metadata["tree-digest"];
  if (treeDigest === undefined || !/^[a-f0-9]{64}$/.test(treeDigest)) {
    throw new PublisherError("Canonical metadata lacks its reviewed tree digest.");
  }
  const kept = remote.body.snapshots.filter(
    (snapshot) =>
      snapshot.id === remote.body.current || Date.parse(snapshot.expires) > now.getTime(),
  );
  if (kept.length === remote.body.snapshots.length) return;
  const body = metaResponseSchema.parse({ ...remote.body, snapshots: kept });
  const bytes = Buffer.from(`${JSON.stringify(body)}\n`, "utf8");
  if (bytes.byteLength > MAX_META_BYTES)
    throw new PublisherError("Retired metadata exceeds server read cap.");
  const identity = await uploadMetaVariants(store, bytes, sleep);
  const current = await readMetadata(store);
  if (
    current?.object.etag !== remote.object.etag ||
    current.object.sha256 !== remote.object.sha256
  ) {
    throw new PublisherError("Metadata changed while preparing retention CAS.");
  }
  const result = await store.put({
    key: META_KEY,
    body: identity.bytes,
    size: identity.size,
    sha256: identity.sha256,
    contentType: "application/json; charset=utf-8",
    metadata: { "tree-digest": treeDigest },
    ifMatch: remote.object.etag,
  });
  if (result.type === "precondition-failed")
    throw new PublisherError("Retention metadata CAS lost a race.");
  const verified = await readMetadata(store);
  if (
    verified?.object.sha256 !== identity.sha256 ||
    verified.object.metadata["tree-digest"] !== treeDigest
  ) {
    throw new PublisherError("Retention metadata committed but readback failed.");
  }
};

export type PublicationReservation = {
  version: 1;
  snapshotId: string;
  candidateDigest: string;
  generated: string;
  expires: string;
};

const markerFor = async (
  store: PublicationStore,
  key: string,
): Promise<PublicationReservation | null> => {
  const object = await store.get(key);
  if (object === null) return null;
  if (
    !Number.isSafeInteger(object.size) ||
    object.size < 0 ||
    object.size > 1_024 ||
    object.sha256 === undefined ||
    !/^[a-f0-9]{64}$/.test(object.sha256)
  ) {
    object.dispose();
    throw new PublisherError("Invalid publication marker.");
  }
  const bytes = await readVerified(object, { size: object.size, sha256: object.sha256 }, 1_024);
  if (bytes === undefined) throw new PublisherError("Publication marker has no bytes.");
  const value: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new PublisherError("Invalid publication marker.");
  }
  const fields = value as Record<string, unknown>;
  if (
    Object.keys(fields).sort().join(",") !==
      "candidateDigest,expires,generated,snapshotId,version" ||
    fields.version !== 1 ||
    !snapshotIdentifierSchema.safeParse(fields.snapshotId).success ||
    !generatedTimestampSchema.safeParse(fields.generated).success ||
    !releaseDateSchema.safeParse(fields.expires).success ||
    typeof fields.candidateDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(fields.candidateDigest) ||
    key !== `v1/_publication/${fields.snapshotId}.json`
  ) {
    throw new PublisherError("Invalid publication marker.");
  }
  return {
    version: 1,
    candidateDigest: fields.candidateDigest,
    snapshotId: snapshotIdentifierSchema.parse(fields.snapshotId),
    generated: generatedTimestampSchema.parse(fields.generated),
    expires: releaseDateSchema.parse(fields.expires),
  };
};

/** Read-only recovery seam: reproduce reserved candidate timestamps, never relax its digest. */
export const readPublicationReservation = async (
  store: PublicationStore,
  snapshotId: string,
): Promise<PublicationReservation | null> => {
  const id = snapshotIdentifierSchema.parse(snapshotId);
  return markerFor(store, `v1/_publication/${id}.json`);
};

const HASHED_NAME = /^([a-f0-9]{64})\.json(?:\.br|\.gz)?$/;

export type CleanupResult = {
  /** True when nothing was deleted and the counts say what a real run would delete. */
  dryRun: boolean;
  deleted: { blobs: number; shards: number; roots: number; metaCopies: number };
};

export type CleanupOptions = {
  clock?: PublicationClock;
  /** Count what would be deleted without deleting it. */
  dryRun?: boolean;
  sleep?: Sleep;
};

/**
 * Removes blobs, shards and roots that no retained snapshot uses, and compressed copies of
 * metadata that is no longer current.
 *
 * 1. Drop expired snapshots from metadata, by compare-and-swap, before any bytes are deleted.
 * 2. Read the root and shards of every snapshot metadata still lists. Their pointers are the live
 *    set. Any failure here stops the run, so nothing is deleted on an incomplete picture.
 * 3. List the prefixes and delete what is not live and is older than the grace period. The only
 *    live metadata copies are the two named by the hash of the current `meta.json`. Their prefix
 *    is skipped until that file is a day old, because a request that read the previous metadata
 *    may still ask for the previous copy.
 *
 * Metadata is read again before each batch of deletes. If it changed, a publication ran at the
 * same time and the live set is out of date, so the run stops.
 *
 * Cost: at most 257 reads per retained snapshot, one listing per 1,000 stored objects, and one
 * read per batch. Memory is O(L) for L live hashes.
 */
export const pruneRetiredSnapshots = async (
  store: PublicationStore,
  { clock = wallClock, dryRun = false, sleep = realSleep }: CleanupOptions = {},
): Promise<CleanupResult> => {
  await retireExpiredMembership(store, readClock(clock), sleep);
  const metadata = await readMetadata(store);
  if (metadata === null) throw new PublisherError("Canonical metadata disappeared during pruning.");

  const live = {
    blobs: new Set<string>(),
    shards: new Set<string>(),
    roots: new Set<string>(),
  };
  for (const snapshot of metadata.body.snapshots) {
    const tree = await readPublishedTree(store, snapshot);
    live.roots.add(snapshot.id);
    for (const sha256 of tree.root.shards) live.shards.add(sha256);
    for (const sha256 of Object.values(tree.root.structural)) live.blobs.add(sha256);
    for (const pointer of tree.features.values()) {
      live.blobs.add(pointer.feature);
      live.blobs.add(pointer.raw);
    }
  }

  const deleted = { blobs: 0, shards: 0, roots: 0, metaCopies: 0 };
  const now = readClock(clock).getTime();
  const cutoff = now - GRACE_DAYS * DAY_MS;
  if (!Number.isFinite(metadata.object.lastModified.getTime()))
    throw new PublisherError("R2 returned metadata without a valid date.");
  const metadataSettled = metadata.object.lastModified.getTime() < now - META_SETTLE_DAYS * DAY_MS;
  for (const [kind, prefix] of [
    ["blobs", "v1/blobs/"],
    ["shards", "v1/shards/"],
    ["roots", "v1/snapshots/"],
    ["metaCopies", "v1/_meta/"],
  ] as const) {
    if (kind === "metaCopies" && !metadataSettled) continue;
    let startAfter: string | undefined;
    for (;;) {
      const page = await store.list(prefix, startAfter, PRUNE_PAGE_SIZE);
      let previous = startAfter;
      const unreferenced: string[] = [];
      for (const { key, lastModified } of page.objects) {
        if (!key.startsWith(prefix) || (previous !== undefined && key <= previous))
          throw new PublisherError("R2 listing did not advance within its prefix.");
        previous = key;
        const name = key.slice(prefix.length);
        const hashed = HASHED_NAME.exec(name)?.[1];
        const isLive =
          kind === "roots"
            ? name.endsWith(".json") && live.roots.has(name.slice(0, -".json".length))
            : kind === "metaCopies"
              ? hashed === metadata.object.sha256
              : hashed !== undefined && live[kind].has(hashed);
        if (!Number.isFinite(lastModified.getTime()))
          throw new PublisherError("R2 listing returned an object without a valid date.");
        if (!isLive && lastModified.getTime() < cutoff) unreferenced.push(key);
      }
      if (page.truncated && page.objects.length === 0)
        throw new PublisherError("R2 listing did not advance.");
      if (unreferenced.length > 0) {
        if (!dryRun) {
          const latest = await readMetadata(store);
          if (
            latest === null ||
            latest.object.etag !== metadata.object.etag ||
            latest.object.sha256 !== metadata.object.sha256
          )
            throw new PublisherError("Metadata changed while pruning; the live set is stale.");
          await store.delete(unreferenced);
        }
        deleted[kind] += unreferenced.length;
      }
      if (!page.truncated) break;
      startAfter = previous;
    }
  }
  return { dryRun, deleted };
};

/** How many of the objects this run must store are stored and verified in R2 so far. */
export type PublicationProgress = { verified: number; total: number };

export type PublishOptions = {
  approval?: DiffApproval;
  candidateRoot: string;
  clock?: PublicationClock;
  /** Called after each immutable object is stored and read back. Must not throw. */
  onProgress?: (progress: PublicationProgress) => void;
  /** Waits between retries of a failed request. Tests replace it. */
  sleep?: Sleep;
  store: PublicationStore;
};

export type PublishResult =
  | {
      type: "unchanged";
      candidateDigest: string;
      current: string;
      pruned: CleanupResult;
      operations: OperationCounts;
    }
  | {
      type: "published";
      candidateDigest: string;
      current: string;
      metaSha256: string;
      /** Objects this run had to store: three per new blob, the new shards, and the root. */
      uploaded: { blobs: number; shards: number; objects: number };
      pruned: CleanupResult;
      operations: OperationCounts;
    };

type RemoteMetadata = NonNullable<Awaited<ReturnType<typeof readMetadata>>>;

/** Reads the live snapshot's pointers and checks them against the digest metadata records. */
const readBaseline = async (
  store: PublicationStore,
  remote: RemoteMetadata | null,
): Promise<{ tree: ContentTree; snapshot: Snapshot } | null> => {
  if (remote === null) return null;
  const snapshot = remote.body.snapshots.find((item) => item.id === remote.body.current);
  if (snapshot === undefined) throw new PublisherError("Remote current snapshot is absent.");
  const tree = await readPublishedTree(store, snapshot);
  if (remote.object.metadata["tree-digest"] !== tree.digest)
    throw new PublisherError("Remote metadata does not correspond to its snapshot's root.");
  return { tree, snapshot };
};

export type PublicationComparison = { report: DiffReport; candidate: ValidatedCandidate };

/**
 * The review gate, read-only: checks the local candidate, reads the live snapshot's pointers from
 * the store, and compares them. The report's digests are what an approval must name.
 */
export const comparePublication = async ({
  approval,
  candidateRoot,
  store,
}: Pick<
  PublishOptions,
  "approval" | "candidateRoot" | "store"
>): Promise<PublicationComparison> => {
  const candidate = await validateCandidate(candidateRoot);
  const baseline = await readBaseline(store, await readMetadata(store));
  return { candidate, report: compareContentTrees(baseline?.tree ?? null, candidate, approval) };
};

const readCandidateFile = async (candidate: ValidatedCandidate, path: string) => {
  const bytes = await readFile(join(candidate.directory, path));
  return { bytes, sha256: sha256(bytes) };
};

/**
 * Fail-closed publication. Only what the live snapshot does not already have is uploaded, each
 * object is read back and verified, and one conditional metadata write makes the snapshot current.
 *
 * Time: O(N) to compare N pointers, then one write and one read per missing object. An
 * interrupted run leaves unreferenced objects that a rerun finds in place and verifies.
 */
export const publishCandidate = async ({
  approval,
  candidateRoot,
  clock = wallClock,
  onProgress,
  sleep = realSleep,
  store: uncounted,
}: PublishOptions): Promise<PublishResult> => {
  const { store, counts } = countOperations(uncounted);
  const now = readClock(clock);
  const candidate = await validateCandidate(candidateRoot);
  const remote = await readMetadata(store);
  const baseline = await readBaseline(store, remote);
  const diff = compareContentTrees(baseline?.tree ?? null, candidate, approval);
  if (diff.blocked.length > 0 && !diff.approved) {
    throw new PublisherError(
      "Output diff blocked; review the local report and provide exact-digest approval.",
    );
  }
  if (remote !== null && !diff.semanticChanged) {
    const pruned = await pruneRetiredSnapshots(store, { clock, sleep });
    return {
      type: "unchanged",
      candidateDigest: diff.candidateDigest,
      current: remote.body.current,
      pruned,
      operations: { ...counts },
    };
  }
  const previous = baseline?.snapshot;
  const candidateSnapshot = candidate.meta.snapshots[0]!;
  if (previous?.id === candidateSnapshot.id) {
    throw new PublisherError("Snapshot ID already current but candidate semantic content differs.");
  }
  assertMonotonic(previous, candidateSnapshot, now);

  // This small marker survives retirement and permanently reserves an immutable snapshot ID.
  const markerBytes = Buffer.from(
    `${JSON.stringify({ version: 1, snapshotId: candidateSnapshot.id, candidateDigest: diff.candidateDigest, generated: candidateSnapshot.generated, expires: candidateSnapshot.expires })}\n`,
  );
  const markerKey = `v1/_publication/${candidateSnapshot.id}.json`;
  await putAndVerify(store, {
    key: markerKey,
    body: markerBytes,
    size: markerBytes.byteLength,
    sha256: sha256(markerBytes),
    contentType: "application/json; charset=utf-8",
    ifNoneMatch: true,
  });

  // The upload list: what the candidate points to that the live snapshot does not.
  const liveBlobs = new Set<string>();
  if (baseline !== null) {
    for (const hash of Object.values(baseline.tree.root.structural)) liveBlobs.add(hash);
    for (const pointer of baseline.tree.features.values()) {
      liveBlobs.add(pointer.feature);
      liveBlobs.add(pointer.raw);
    }
  }
  const liveShards = new Set(baseline?.tree.root.shards);
  const blobs = [...candidate.blobs].filter((hash) => !liveBlobs.has(hash));
  const shards = [...candidate.shards].filter((hash) => !liveShards.has(hash));
  const total = blobs.length * 3 + shards.length + 1;
  let verified = 0;
  const settled = (): void => onProgress?.({ verified: (verified += 1), total });

  await runBounded(blobs, async (hash) => {
    const plain = await readCandidateFile(candidate, blobPath(hash, "identity"));
    if (plain.sha256 !== hash) throw new PublisherError("Candidate blob changed after validation.");
    const identity = { size: plain.bytes.byteLength, sha256: hash };
    for (const encoding of ["br", "gzip"] as const) {
      const key = blobPath(hash, encoding);
      const encoded = await readCandidateFile(candidate, key);
      await putImmutable(store, { key, ...encoded, encoded: { encoding, identity } }, sleep);
      settled();
    }
    // The plain bytes go last, as on disk: their presence means all three encodings are stored.
    await putImmutable(store, { key: blobPath(hash, "identity"), ...plain }, sleep);
    settled();
  });
  await runBounded(shards, async (hash) => {
    const shard = await readCandidateFile(candidate, shardPath(hash));
    if (shard.sha256 !== hash)
      throw new PublisherError("Candidate shard changed after validation.");
    await putImmutable(store, { key: shardPath(hash), ...shard }, sleep);
    settled();
  });
  if (sha256(candidate.rootBytes) !== diff.candidateDigest)
    throw new PublisherError("Candidate root does not match the reviewed digest.");
  await putImmutable(
    store,
    {
      key: snapshotRootPath(candidateSnapshot.id),
      bytes: candidate.rootBytes,
      sha256: diff.candidateDigest,
    },
    sleep,
  );
  settled();

  const merged = mergedMetadata(candidate.meta, remote?.body, readClock(clock));
  const identity = await uploadMetaVariants(store, merged.bytes, sleep);

  // Repeat the gate immediately before the only mutable write. A changed file or approval
  // cannot silently inherit the first decision. The baseline is immutable once read, and the
  // metadata check below proves the live snapshot is still the one it was read from.
  const finalCandidate = await validateCandidate(candidateRoot);
  const finalDiff = compareContentTrees(baseline?.tree ?? null, finalCandidate, approval);
  if (
    (finalDiff.blocked.length > 0 && !finalDiff.approved) ||
    finalDiff.baselineDigest !== diff.baselineDigest ||
    finalDiff.candidateDigest !== diff.candidateDigest ||
    !Buffer.from(finalCandidate.metaBytes).equals(candidate.metaBytes)
  ) {
    throw new PublisherError("Candidate or approval changed before metadata compare-and-swap.");
  }
  const current = await readMetadata(store);
  if (
    current?.object.etag !== remote?.object.etag ||
    current?.object.sha256 !== remote?.object.sha256
  ) {
    throw new PublisherError("Remote metadata changed before compare-and-swap.");
  }
  assertMonotonic(previous, candidateSnapshot, readClock(clock));
  let result: Awaited<ReturnType<PublicationStore["put"]>>;
  try {
    result = await store.put({
      key: META_KEY,
      body: identity.bytes,
      size: identity.size,
      sha256: identity.sha256,
      contentType: "application/json; charset=utf-8",
      metadata: { "tree-digest": diff.candidateDigest },
      ...(remote === null ? { ifNoneMatch: true } : { ifMatch: remote.object.etag }),
    });
  } catch {
    // The server may have committed before the connection failed, so `current` may have moved.
    throw new PublisherError(
      "Metadata compare-and-swap outcome is unknown; metadata may have committed. Rerun the same candidate to reconcile.",
    );
  }
  if (result.type === "precondition-failed") {
    throw new PublisherError("Metadata compare-and-swap lost a concurrent publication race.");
  }
  const committed = await readMetadata(store).catch(() => null);
  if (
    committed === null ||
    committed.object.sha256 !== identity.sha256 ||
    committed.object.metadata["tree-digest"] !== diff.candidateDigest
  ) {
    throw new PublisherError(
      "Metadata committed but readback verification failed; investigate before retry.",
    );
  }
  let pruned: CleanupResult;
  try {
    pruned = await pruneRetiredSnapshots(store, { clock, sleep });
  } catch {
    throw new PublisherError(
      "Metadata committed but retention cleanup failed; investigate before retry.",
    );
  }
  return {
    type: "published",
    candidateDigest: diff.candidateDigest,
    current: merged.body.current,
    metaSha256: identity.sha256,
    uploaded: { blobs: blobs.length, shards: shards.length, objects: total },
    pruned,
    operations: { ...counts },
  };
};
