import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { join } from "node:path";

import { compareOutputTrees, createRepresentations, type DiffApproval } from "@bcd-embed/generator";
import {
  generatedTimestampSchema,
  metaResponseSchema,
  releaseDateSchema,
  snapshotIdentifierSchema,
  type MetaResponse,
  type Snapshot,
} from "@bcd-embed/schema";
import { compare as compareVersions, valid as validVersion } from "semver";

import type { PublicationStore } from "./store.js";
import { putAndVerify, readMetadata, readVerified } from "./objects.js";
import { uploadCandidateControls } from "./archive.js";
import { runBounded } from "./concurrency.js";
import { PublisherError } from "./errors.js";
import { MAX_META_BYTES, validateCandidate } from "./validate.js";

const META_KEY = "v1/meta.json";
const RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1_000;
const PRUNE_PAGE_SIZE = 500;
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

const uploadMetaVariants = async (store: PublicationStore, bytes: Uint8Array) => {
  const representations = createRepresentations(META_KEY, bytes);
  await runBounded(
    representations.filter((item) => item.encoding !== "identity"),
    async (item) => {
      await putAndVerify(store, {
        key: item.path,
        body: item.bytes,
        size: item.size,
        sha256: item.sha256,
        contentType: "application/json; charset=utf-8",
        contentEncoding: item.encoding === "identity" ? undefined : item.encoding,
        ifNoneMatch: true,
      });
    },
  );
  return representations.find((item) => item.encoding === "identity")!;
};

/** Scheduled/no-change retention still needs a metadata CAS before physical cleanup. */
const retireExpiredMembership = async (store: PublicationStore, now: Date): Promise<void> => {
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
  const identity = await uploadMetaVariants(store, bytes);
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

const assertListingProgress = (
  keys: readonly string[],
  startAfter: string | undefined,
  prefix: string,
): void => {
  let previous = startAfter;
  for (const key of keys) {
    if (!key.startsWith(prefix) || (previous !== undefined && key <= previous)) {
      throw new PublisherError("R2 listing did not advance within its prefix.");
    }
    previous = key;
  }
};

/** Reentrant cleanup: metadata membership is removed by CAS before any snapshot bytes are deleted. */
export const pruneRetiredSnapshots = async (
  store: PublicationStore,
  clock: PublicationClock = wallClock,
): Promise<string[]> => {
  await retireExpiredMembership(store, readClock(clock));
  const pruned: string[] = [];
  const metadata = await readMetadata(store);
  if (metadata === null) throw new PublisherError("Canonical metadata disappeared during pruning.");
  const referenced = new Set(metadata.body.snapshots.map((snapshot) => snapshot.id));
  let markerStart: string | undefined;
  for (;;) {
    const page = await store.list("v1/_publication/", markerStart, PRUNE_PAGE_SIZE);
    assertListingProgress(page.keys, markerStart, "v1/_publication/");
    if (page.truncated && page.keys.length === 0)
      throw new PublisherError("R2 marker listing did not advance.");
    for (const key of page.keys) {
      if (!key.startsWith("v1/_publication/"))
        throw new PublisherError("R2 marker listing escaped its prefix.");
      const marker = await markerFor(store, key);
      if (marker === null) continue;
      if (referenced.has(marker.snapshotId)) continue;
      const now = readClock(clock);
      // Old incomplete publishes are safe to retire too; a current publish can
      // never reintroduce them because it must CAS newer metadata and be fresh.
      if (
        Date.parse(marker.generated) + RETENTION_DAYS * DAY_MS > now.getTime() ||
        Date.parse(marker.expires) > now.getTime()
      )
        continue;
      let deleted = 0;
      for (const prefix of [`v1/${marker.snapshotId}/`, `v1/_candidates/${marker.snapshotId}/`]) {
        let objectStart: string | undefined;
        for (;;) {
          const objects = await store.list(prefix, objectStart, PRUNE_PAGE_SIZE);
          assertListingProgress(objects.keys, objectStart, prefix);
          if (objects.truncated && objects.keys.length === 0) {
            throw new PublisherError("R2 snapshot listing did not advance.");
          }
          if (objects.keys.some((objectKey) => !objectKey.startsWith(prefix))) {
            throw new PublisherError("R2 snapshot listing escaped its prefix.");
          }
          const latest = await readMetadata(store);
          const deletionTime = readClock(clock).getTime();
          if (
            Date.parse(marker.generated) + RETENTION_DAYS * DAY_MS > deletionTime ||
            Date.parse(marker.expires) > deletionTime
          ) {
            throw new PublisherError("Snapshot is no longer eligible for pruning.");
          }
          if (
            latest === null ||
            latest.body.snapshots.some((snapshot) => snapshot.id === marker.snapshotId)
          ) {
            throw new PublisherError("Snapshot became referenced while pruning.");
          }
          if (objects.keys.length > 0) {
            await store.delete(objects.keys);
            deleted += objects.keys.length;
          }
          if (!objects.truncated) break;
          objectStart = objects.keys.at(-1);
        }
      }
      if (deleted > 0) pruned.push(marker.snapshotId);
    }
    if (!page.truncated) break;
    markerStart = page.keys.at(-1);
  }
  return pruned;
};

export type PublishOptions = {
  approval?: DiffApproval;
  baselineRoot: string;
  candidateRoot: string;
  clock?: PublicationClock;
  store: PublicationStore;
};

export type PublishResult =
  | { type: "unchanged"; candidateDigest: string; current: string; pruned: string[] }
  | {
      type: "published";
      candidateDigest: string;
      current: string;
      metaSha256: string;
      pruned: string[];
    };

/** Fail-closed publication: immutable verified objects, then one conditional canonical metadata PUT. */
export const publishCandidate = async ({
  approval,
  baselineRoot,
  candidateRoot,
  clock = wallClock,
  store,
}: PublishOptions): Promise<PublishResult> => {
  const now = readClock(clock);
  const candidate = await validateCandidate(candidateRoot);
  const diff = await compareOutputTrees({ baselineRoot, candidateRoot, approval });
  if (diff.blocked.length > 0 && !diff.approved) {
    throw new PublisherError(
      "Output diff blocked; review the local report and provide exact-digest approval.",
    );
  }
  const remote = await readMetadata(store);
  if (remote === null && !diff.bootstrap)
    throw new PublisherError("Remote metadata missing for non-bootstrap baseline.");
  if (
    remote !== null &&
    remote.object.metadata["tree-digest"] === diff.candidateDigest &&
    remote.body.current === candidate.meta.current
  ) {
    const pruned = await pruneRetiredSnapshots(store, clock);
    return {
      type: "unchanged",
      candidateDigest: diff.candidateDigest,
      current: remote.body.current,
      pruned,
    };
  }
  if (
    remote !== null &&
    (diff.bootstrap || remote.object.metadata["tree-digest"] !== diff.baselineDigest)
  ) {
    throw new PublisherError("Remote metadata does not correspond to the reviewed baseline tree.");
  }
  const previous = remote?.body.snapshots.find((snapshot) => snapshot.id === remote.body.current);
  if (remote !== null && previous === undefined)
    throw new PublisherError("Remote current snapshot is absent.");
  if (remote !== null && !diff.semanticChanged) {
    const pruned = await pruneRetiredSnapshots(store, clock);
    return {
      type: "unchanged",
      candidateDigest: diff.candidateDigest,
      current: remote.body.current,
      pruned,
    };
  }
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

  const immutable = candidate.manifest.artifacts.filter((item) => item.logicalPath !== META_KEY);
  await runBounded(immutable, async (item) => {
    await putAndVerify(store, {
      key: item.path,
      body: createReadStream(join(candidate.root, item.path)),
      size: item.size,
      sha256: item.sha256,
      contentType: "application/json; charset=utf-8",
      contentEncoding: item.encoding === "identity" ? undefined : item.encoding,
      ifNoneMatch: true,
    });
  });

  await uploadCandidateControls(store, candidate);

  const merged = mergedMetadata(candidate.meta, remote?.body, readClock(clock));
  const identity = await uploadMetaVariants(store, merged.bytes);

  // Repeat the trusted gate immediately before the only mutable write. A changed
  // file, approval, or baseline cannot silently inherit the preflight decision.
  const finalDiff = await compareOutputTrees({ baselineRoot, candidateRoot, approval });
  if (
    (finalDiff.blocked.length > 0 && !finalDiff.approved) ||
    finalDiff.baselineDigest !== diff.baselineDigest ||
    finalDiff.candidateDigest !== diff.candidateDigest
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
  const result = await store.put({
    key: META_KEY,
    body: identity.bytes,
    size: identity.size,
    sha256: identity.sha256,
    contentType: "application/json; charset=utf-8",
    metadata: { "tree-digest": diff.candidateDigest },
    ...(remote === null ? { ifNoneMatch: true } : { ifMatch: remote.object.etag }),
  });
  if (result.type === "precondition-failed") {
    throw new PublisherError("Metadata compare-and-swap lost a concurrent publication race.");
  }
  const verified = await readMetadata(store);
  if (
    verified === null ||
    verified.object.sha256 !== identity.sha256 ||
    verified.object.metadata["tree-digest"] !== diff.candidateDigest
  ) {
    throw new PublisherError(
      "Metadata committed but readback verification failed; investigate before retry.",
    );
  }
  let pruned: string[];
  try {
    pruned = await pruneRetiredSnapshots(store, clock);
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
    pruned,
  };
};
