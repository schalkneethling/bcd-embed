import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { gunzipSync, gzipSync } from "node:zlib";

import publicSchema from "../../generator/src/upstream/public.schema.json" with { type: "json" };
import { withRelease } from "../../generator/tests/support/write-content-tree.js";
import {
  BCD_VERSION,
  DiffApprovalMismatchError,
  EMPTY_TREE_DIGEST,
  emitContentTree,
  generateSnapshot,
  type DiffApproval,
} from "@bcd-embed/generator";
import { blobPath, shardPath, snapshotRootPath } from "@bcd-embed/schema";
import { afterEach, describe, expect, it } from "vitest";

import { parsePublishCommand } from "../src/cli.js";
import { formatPublisherError } from "../src/errors.js";
import {
  comparePublication,
  publishCandidate,
  pruneRetiredSnapshots,
  readPublicationReservation,
} from "../src/publish.js";
import type { PublicationStore, PutObject, PutResult, StoredObject } from "../src/store.js";
import { readPublishedTree } from "../src/tree.js";
import { hashDecodedStream, validateCandidate } from "../src/validate.js";

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const directories: string[] = [];
const noSleep = async (): Promise<void> => {};

afterEach(async () => {
  for (const root of directories.splice(0)) await rm(root, { recursive: true, force: true });
});

/** `features` maps a name below `api` to the Chrome version that added it. */
const fixture = (features: Record<string, string>) => ({
  ...Object.fromEntries(
    publicSchema.required
      .filter((key) => key !== "__meta" && key !== "browsers")
      .map((key) => [key, {}]),
  ),
  __meta: { version: BCD_VERSION, timestamp: "2026-01-01T12:00:00Z" },
  browsers: {
    chrome: {
      name: "Chrome",
      type: "desktop",
      accepts_flags: true,
      accepts_webextensions: true,
      releases: {
        "1": { index: 0, status: "retired", release_date: "2008-12-11" },
        "2": { index: 1, status: "current" },
      },
    },
  },
  api: Object.fromEntries(
    Object.entries(features).map(([name, versionAdded]) => [
      name,
      {
        __compat: {
          source_file: `api/${name}.json`,
          support: { chrome: { version_added: versionAdded } },
        },
      },
    ]),
  ),
});

// Releases after the pinned one, derived so a BCD update never invalidates them.
const [major, minor, patch] = BCD_VERSION.split(".").map(Number);
const laterVersion = (steps: number): string => `${major}.${minor}.${patch! + steps}`;

/** Twenty features, so that one change is 5% and stays inside the review policy's 10%. */
const featuresWith = (changes: Record<string, string>): Record<string, string> => ({
  ...Object.fromEntries(Array.from({ length: 18 }, (_, index) => [`Filler${index}`, "1"])),
  Test: "1",
  Other: "1",
  ...changes,
});

type Release = {
  version?: string;
  generated: string;
  expires: string;
  features?: Record<string, string>;
};
const emit = async ({
  version = BCD_VERSION,
  generated,
  expires,
  features = featuresWith({}),
}: Release): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "bcd-embed-publish-"));
  directories.push(root);
  const snapshot = generateSnapshot({ generated, expires, data: fixture(features) });
  await emitContentTree({
    outputRoot: root,
    // The generator pins one BCD release, so a later release is the same data renamed.
    generatedSnapshot: version === BCD_VERSION ? snapshot : withRelease(snapshot, { version }),
  });
  return root;
};

const FIRST: Release = { generated: "2026-01-01T12:00:00Z", expires: "2026-04-01" };
const SECOND: Release = {
  version: laterVersion(1),
  generated: "2026-01-08T12:00:00Z",
  expires: "2026-04-08",
  features: featuresWith({ Test: "2" }),
};
const at = (date: string) => () => new Date(date);

class MemoryStore implements PublicationStore {
  objects = new Map<
    string,
    { bytes: Buffer; etag: string; metadata: Record<string, string>; modified: Date }
  >();
  puts: string[] = [];
  gets = 0;
  lists = 0;
  /** The date new objects are stamped with. */
  now = new Date("2026-01-01T12:00:00Z");
  failAfter: number | undefined;
  /** Throws this many times on PUT, as a dropped connection would, then works. */
  transientPutFailures = 0;
  corruptKey: string | undefined;
  raceOnMeta = false;
  failDelete = false;
  throwOnMetaPutAfterWrite = false;
  throwOnMetaGetAfterPut = false;
  repeatedPage = false;
  onDelete: (() => void) | undefined;

  async get(key: string): Promise<StoredObject | null> {
    this.gets += 1;
    if (this.throwOnMetaGetAfterPut && key === "v1/meta.json" && this.puts.includes(key)) {
      throw new Error("Simulated readback failure");
    }
    const object = this.objects.get(key);
    if (object === undefined) return null;
    return {
      body: Readable.from([object.bytes]),
      dispose: () => {},
      etag: object.etag,
      lastModified: object.modified,
      metadata: object.metadata,
      sha256: object.metadata.sha256,
      size: object.bytes.byteLength,
    };
  }

  async put(input: PutObject): Promise<PutResult> {
    if (this.transientPutFailures > 0) {
      this.transientPutFailures -= 1;
      throw new Error("Simulated dropped connection");
    }
    if (this.failAfter !== undefined && this.puts.length >= this.failAfter) {
      throw new Error("Simulated interrupted upload");
    }
    const old = this.objects.get(input.key);
    if (this.raceOnMeta && input.key === "v1/meta.json") return { type: "precondition-failed" };
    if (
      (input.ifNoneMatch && old !== undefined) ||
      (input.ifMatch && old?.etag !== input.ifMatch)
    ) {
      return { type: "precondition-failed" };
    }
    if (!(input.body instanceof Uint8Array)) throw new Error("Test store expects buffers.");
    const bytes = Buffer.from(input.body);
    if (this.corruptKey === input.key) bytes[0] = (bytes[0] ?? 0) ^ 1;
    const etag = `"${createHash("md5").update(bytes).digest("hex")}"`;
    this.objects.set(input.key, {
      bytes,
      etag,
      metadata: { ...input.metadata, sha256: input.sha256 },
      modified: this.now,
    });
    this.puts.push(input.key);
    if (this.throwOnMetaPutAfterWrite && input.key === "v1/meta.json") {
      throw new Error("Simulated connection loss after commit");
    }
    return { type: "stored", etag };
  }

  async list(prefix: string, startAfter: string | undefined, limit: number) {
    this.lists += 1;
    const all = [...this.objects.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([key, { modified }]) => ({ key, lastModified: modified }));
    if (this.repeatedPage) return { objects: all.slice(0, 1), truncated: true };
    const remaining = all.filter(({ key }) => startAfter === undefined || key > startAfter);
    return { objects: remaining.slice(0, limit), truncated: remaining.length > limit };
  }

  async delete(keys: readonly string[]) {
    if (this.failDelete) throw new Error("Simulated cleanup interruption");
    this.onDelete?.();
    for (const key of keys) this.objects.delete(key);
  }

  keys(prefix: string): string[] {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
  }
}

const approvalFor = async (store: MemoryStore, candidateRoot: string): Promise<DiffApproval> => {
  const { report } = await comparePublication({ store, candidateRoot });
  return {
    baselineDigest: report.baselineDigest,
    candidateDigest: report.candidateDigest,
    approved: true,
    reason: "Reviewed exact test fixture output",
  };
};

/** Publishes the first release, which needs a bootstrap approval, and returns its folder. */
const publishFirst = async (store: MemoryStore, release: Release = FIRST): Promise<string> => {
  const candidateRoot = await emit(release);
  const result = await publishCandidate({
    candidateRoot,
    store,
    approval: await approvalFor(store, candidateRoot),
    clock: at("2026-01-02"),
    sleep: noSleep,
  });
  expect(result.type).toBe("published");
  return candidateRoot;
};

describe("command line grammar", () => {
  it("compares locally against a baseline folder by default", () => {
    expect(parsePublishCommand(["--baseline-root", "a", "--candidate-root", "b"])).toEqual({
      baselineRoot: "a",
      candidateRoot: "b",
      approvalFile: undefined,
    });
    expect(() => parsePublishCommand(["--candidate-root", "b"])).toThrow("--baseline-root");
  });

  it("requires explicit remote-write opt-in with both account and bucket", () => {
    expect(() =>
      parsePublishCommand(["--baseline-root", "a", "--candidate-root", "b", "--bucket", "x"]),
    ).toThrow("explicit");
    expect(() =>
      parsePublishCommand([
        "--candidate-root",
        "b",
        "--execute-remote-write",
        "--account-id",
        "0".repeat(32),
      ]),
    ).toThrow("explicit");
  });

  it("takes the remote baseline from R2, so it refuses a baseline folder", () => {
    const remote = ["--execute-remote-write", "--account-id", "0".repeat(32), "--bucket", "x"];
    expect(parsePublishCommand(["--candidate-root", "b", ...remote])).toEqual({
      candidateRoot: "b",
      approvalFile: undefined,
      remote: { accountId: "0".repeat(32), bucket: "x" },
    });
    expect(() =>
      parsePublishCommand(["--baseline-root", "a", "--candidate-root", "b", ...remote]),
    ).toThrow("not accepted");
  });
});

describe("first publication", () => {
  it("blocks an unapproved bootstrap before any remote write", async () => {
    const store = new MemoryStore();
    const candidateRoot = await emit(FIRST);
    await expect(
      publishCandidate({ candidateRoot, store, clock: at("2026-01-02"), sleep: noSleep }),
    ).rejects.toThrow("Output diff blocked");
    expect(store.puts).toEqual([]);
  });

  it("reports the digests an approval must name without writing anything", async () => {
    const store = new MemoryStore();
    const candidateRoot = await emit(FIRST);
    const { report, candidate } = await comparePublication({ store, candidateRoot });
    expect(report.bootstrap).toBe(true);
    expect(report.baselineDigest).toBe(EMPTY_TREE_DIGEST);
    expect(report.candidateDigest).toBe(sha256(candidate.rootBytes));
    expect(store.puts).toEqual([]);
  });

  it("uploads every object, verifies it, then makes the snapshot current once", async () => {
    const store = new MemoryStore();
    const candidateRoot = await emit(FIRST);
    const candidate = await validateCandidate(candidateRoot);
    const approval = await approvalFor(store, candidateRoot);
    const progress: number[] = [];
    const result = await publishCandidate({
      candidateRoot,
      store,
      approval,
      clock: at("2026-01-02"),
      onProgress: ({ verified }) => progress.push(verified),
      sleep: noSleep,
    });

    if (result.type !== "published") throw new Error("Expected a publication.");
    const objects = candidate.blobs.size * 3 + candidate.shards.size + 1;
    expect(result.uploaded).toEqual({
      blobs: candidate.blobs.size,
      shards: candidate.shards.size,
      objects,
    });
    expect(progress.at(-1)).toBe(objects);
    expect(store.keys("v1/blobs/")).toHaveLength(candidate.blobs.size * 3);
    expect(store.keys("v1/shards/")).toHaveLength(candidate.shards.size);
    expect(store.keys("v1/snapshots/")).toEqual([snapshotRootPath(candidate.snapshotId)]);
    expect(store.puts.filter((key) => key === "v1/meta.json")).toHaveLength(1);
    expect(store.puts.at(-1)).toBe("v1/meta.json");

    const meta = store.objects.get("v1/meta.json")!;
    expect(meta.metadata["tree-digest"]).toBe(candidate.digest);
    expect(result.candidateDigest).toBe(candidate.digest);
    for (const [key, object] of store.objects) {
      expect(sha256(object.bytes), key).toBe(object.metadata.sha256);
    }
    const published = await readPublishedTree(store, candidate.meta.snapshots[0]!);
    expect(published.digest).toBe(candidate.digest);
    expect(published.features.size).toBe(20);
    expect(published.features.has("api.Test")).toBe(true);

    // Writes and listings are Class A; reads are Class B. Every write is one put.
    expect(result.operations.classA).toBe(store.puts.length + store.lists);
    expect(result.operations.classB).toBeGreaterThan(objects);
    expect(result.pruned).toEqual({
      dryRun: false,
      deleted: { blobs: 0, shards: 0, roots: 0, metaCopies: 0 },
    });
  });
});

describe("a later publication", () => {
  it("uploads only what the live snapshot does not have", async () => {
    const store = new MemoryStore();
    const first = await validateCandidate(await publishFirst(store));
    const firstPuts = store.puts.length;

    const candidateRoot = await emit(SECOND);
    const second = await validateCandidate(candidateRoot);
    const result = await publishCandidate({
      candidateRoot,
      store,
      clock: at("2026-01-09"),
      sleep: noSleep,
    });

    if (result.type !== "published") throw new Error("Expected a publication.");
    const newBlobs = [...second.blobs].filter((hash) => !first.blobs.has(hash));
    const newShards = [...second.shards].filter((hash) => !first.shards.has(hash));
    // One feature changed: its normalized file and its raw file. Everything else is shared.
    expect(newBlobs).toHaveLength(2);
    expect(newShards).toHaveLength(1);
    expect(result.uploaded).toEqual({ blobs: 2, shards: 1, objects: 2 * 3 + 1 + 1 });

    const puts = store.puts.slice(firstPuts);
    expect(puts.filter((key) => key.startsWith("v1/blobs/")).sort()).toEqual(
      newBlobs
        .flatMap((hash) => [
          blobPath(hash, "identity"),
          blobPath(hash, "br"),
          blobPath(hash, "gzip"),
        ])
        .sort(),
    );
    expect(puts.filter((key) => key.startsWith("v1/shards/"))).toEqual(newShards.map(shardPath));

    const meta = JSON.parse(store.objects.get("v1/meta.json")!.bytes.toString()) as {
      current: string;
      snapshots: Array<{ id: string }>;
    };
    expect(meta.current).toBe(second.snapshotId);
    expect(meta.snapshots.map(({ id }) => id)).toEqual([second.snapshotId, first.snapshotId]);
    // The first snapshot is still complete, so pinned URLs keep working.
    expect((await readPublishedTree(store, first.meta.snapshots[0]!)).digest).toBe(first.digest);
  });

  it("is unchanged when the data is the same under a new release name", async () => {
    const store = new MemoryStore();
    await publishFirst(store);
    const before = store.puts.length;
    const candidateRoot = await emit({ ...SECOND, features: undefined });
    const result = await publishCandidate({
      candidateRoot,
      store,
      clock: at("2026-01-09"),
      sleep: noSleep,
    });
    expect(result.type).toBe("unchanged");
    expect(store.puts).toHaveLength(before);
  });

  it("names a stale approval instead of reporting an unknown error", async () => {
    const store = new MemoryStore();
    const firstRoot = await emit(FIRST);
    const stale = await approvalFor(store, firstRoot);
    await publishFirst(store);
    const failure = publishCandidate({
      candidateRoot: await emit(SECOND),
      store,
      approval: stale,
      clock: at("2026-01-09"),
      sleep: noSleep,
    });
    await expect(failure).rejects.toBeInstanceOf(DiffApprovalMismatchError);
    expect(formatPublisherError(await failure.catch((error: unknown) => error))).toContain(
      "does not match these exact",
    );
  });

  it("rejects live metadata whose recorded digest is not its root's hash", async () => {
    const store = new MemoryStore();
    await publishFirst(store);
    store.objects.get("v1/meta.json")!.metadata["tree-digest"] = "0".repeat(64);
    await expect(
      publishCandidate({
        candidateRoot: await emit(SECOND),
        store,
        clock: at("2026-01-09"),
        sleep: noSleep,
      }),
    ).rejects.toThrow("does not correspond to its snapshot's root");
  });

  it("rejects a live shard that does not hash to the name its root gives it", async () => {
    const store = new MemoryStore();
    await publishFirst(store);
    const shard = store.objects.get(store.keys("v1/shards/")[0]!)!;
    shard.bytes = Buffer.from('{"version":1,"pointers":{}}\n');
    shard.metadata.sha256 = sha256(shard.bytes);
    await expect(
      publishCandidate({
        candidateRoot: await emit(SECOND),
        store,
        clock: at("2026-01-09"),
        sleep: noSleep,
      }),
    ).rejects.toThrow("root and shards do not agree");
  });

  it("refuses a candidate that is older than, or not newer than, the live snapshot", async () => {
    const store = new MemoryStore();
    await publishFirst(store);
    await expect(
      publishCandidate({
        candidateRoot: await emit({
          ...SECOND,
          generated: FIRST.generated,
          expires: FIRST.expires,
        }),
        store,
        clock: at("2026-01-09"),
        sleep: noSleep,
      }),
    ).rejects.toThrow("must be later than published current");
    await expect(
      publishCandidate({
        candidateRoot: await emit(SECOND),
        store,
        clock: () => new Date(Number.NaN),
        sleep: noSleep,
      }),
    ).rejects.toThrow("finite Date");
  });
});

describe("interrupted and failing uploads", () => {
  it("keeps metadata absent after a partial upload, then resumes and verifies what exists", async () => {
    const store = new MemoryStore();
    const candidateRoot = await emit(FIRST);
    const approval = await approvalFor(store, candidateRoot);
    const options = { candidateRoot, store, approval, clock: at("2026-01-02"), sleep: noSleep };
    store.failAfter = 5;
    await expect(publishCandidate(options)).rejects.toThrow("Simulated interrupted upload");
    expect(store.objects.has("v1/meta.json")).toBe(false);
    const stored = new Set(store.puts);
    expect(stored.size).toBe(5);

    store.failAfter = undefined;
    await expect(publishCandidate(options)).resolves.toMatchObject({ type: "published" });
    // Nothing that the first run stored was written again.
    expect(store.puts.filter((key) => stored.has(key))).toHaveLength(5);

    const reservation = await readPublicationReservation(
      store,
      (await validateCandidate(candidateRoot)).snapshotId,
    );
    expect(reservation).toMatchObject({ generated: FIRST.generated, expires: FIRST.expires });
  });

  it("retries a request that failed in transit, sending the same bytes", async () => {
    const store = new MemoryStore();
    const candidateRoot = await emit(FIRST);
    const approval = await approvalFor(store, candidateRoot);
    const waits: number[] = [];
    // The reservation marker is not retried, so start failing after it is stored.
    const put = store.put.bind(store);
    let failures = 2;
    store.put = async (input) => {
      if (input.key.startsWith("v1/blobs/") && failures > 0) {
        failures -= 1;
        throw new Error("Simulated dropped connection");
      }
      return put(input);
    };
    await expect(
      publishCandidate({
        candidateRoot,
        store,
        approval,
        clock: at("2026-01-02"),
        sleep: async (milliseconds) => void waits.push(milliseconds),
      }),
    ).resolves.toMatchObject({ type: "published" });
    expect(waits).toHaveLength(2);
  });

  it("does not retry an object that was stored with the wrong bytes", async () => {
    const store = new MemoryStore();
    const candidateRoot = await emit(FIRST);
    const approval = await approvalFor(store, candidateRoot);
    const candidate = await validateCandidate(candidateRoot);
    store.corruptKey = blobPath([...candidate.blobs][0]!, "identity");
    const waits: number[] = [];
    await expect(
      publishCandidate({
        candidateRoot,
        store,
        approval,
        clock: at("2026-01-02"),
        sleep: async (milliseconds) => void waits.push(milliseconds),
      }),
    ).rejects.toThrow("do not match expected content");
    expect(waits).toEqual([]);
    expect(store.objects.has("v1/meta.json")).toBe(false);
  });

  it("accepts an existing compressed copy with other bytes only if it decodes to the blob", async () => {
    const candidateRoot = await emit(FIRST);
    const candidate = await validateCandidate(candidateRoot);
    const hash = [...candidate.blobs][0]!;
    const key = blobPath(hash, "gzip");
    const plain = await readFile(join(candidateRoot, blobPath(hash, "identity")));
    const preload = (store: MemoryStore, bytes: Buffer): void => {
      store.objects.set(key, {
        bytes,
        etag: '"other"',
        metadata: { sha256: sha256(bytes) },
        modified: store.now,
      });
    };

    const accepting = new MemoryStore();
    // Another zlib build: different bytes, same content.
    const otherBuild = gzipSync(plain, { level: 1 });
    expect(gunzipSync(otherBuild).equals(plain)).toBe(true);
    preload(accepting, otherBuild);
    await expect(
      publishCandidate({
        candidateRoot,
        store: accepting,
        approval: await approvalFor(accepting, candidateRoot),
        clock: at("2026-01-02"),
        sleep: noSleep,
      }),
    ).resolves.toMatchObject({ type: "published" });
    expect(accepting.objects.get(key)!.bytes.equals(otherBuild)).toBe(true);

    const rejecting = new MemoryStore();
    preload(rejecting, gzipSync(Buffer.from("something else")));
    await expect(
      publishCandidate({
        candidateRoot,
        store: rejecting,
        approval: await approvalFor(rejecting, candidateRoot),
        clock: at("2026-01-02"),
        sleep: noSleep,
      }),
    ).rejects.toThrow("does not decode to the expected bytes");
  });

  it("stops when the candidate changes on disk after it was validated", async () => {
    const store = new MemoryStore();
    const candidateRoot = await emit(FIRST);
    const approval = await approvalFor(store, candidateRoot);
    const candidate = await validateCandidate(candidateRoot);
    const put = store.put.bind(store);
    let damaged = false;
    store.put = async (input) => {
      if (!damaged && input.key.startsWith("v1/snapshots/")) {
        damaged = true;
        await writeFile(
          join(candidateRoot, blobPath([...candidate.blobs][0]!, "identity")),
          "{}\n",
        );
      }
      return put(input);
    };
    await expect(
      publishCandidate({ candidateRoot, store, approval, clock: at("2026-01-02"), sleep: noSleep }),
    ).rejects.toThrow("does not hash to its name");
    expect(store.objects.has("v1/meta.json")).toBe(false);
  });
});

describe("the metadata switch", () => {
  const prepared = async () => {
    const store = new MemoryStore();
    const candidateRoot = await emit(FIRST);
    const approval = await approvalFor(store, candidateRoot);
    return {
      store,
      options: { candidateRoot, store, approval, clock: at("2026-01-02"), sleep: noSleep },
    };
  };

  it("reports a lost compare-and-swap race", async () => {
    const { store, options } = await prepared();
    store.raceOnMeta = true;
    await expect(publishCandidate(options)).rejects.toThrow("lost a concurrent publication race");
  });

  it("reports an unknown outcome, then a rerun reconciles as unchanged", async () => {
    const { store, options } = await prepared();
    store.throwOnMetaPutAfterWrite = true;
    await expect(publishCandidate(options)).rejects.toThrow("outcome is unknown");
    store.throwOnMetaPutAfterWrite = false;
    await expect(publishCandidate({ ...options, approval: undefined })).resolves.toMatchObject({
      type: "unchanged",
    });
  });

  it("reports failed read-back verification when the read after the switch throws", async () => {
    const { store, options } = await prepared();
    store.throwOnMetaGetAfterPut = true;
    await expect(publishCandidate(options)).rejects.toThrow("readback verification failed");
  });

  it("refuses a candidate that expires before the switch", async () => {
    const { options } = await prepared();
    let calls = 0;
    await expect(
      publishCandidate({
        ...options,
        clock: () => new Date((calls += 1) === 1 ? "2026-01-02" : "2026-05-01"),
      }),
    ).rejects.toThrow("not publishable now");
  });
});

describe("cleanup of unreferenced files", () => {
  /** Publishes two releases, then a third after the first has expired. */
  const threeReleases = async () => {
    const store = new MemoryStore();
    const first = await validateCandidate(await publishFirst(store));
    store.now = new Date("2026-01-08T12:00:00Z");
    const secondRoot = await emit(SECOND);
    await publishCandidate({
      candidateRoot: secondRoot,
      store,
      clock: at("2026-01-09"),
      sleep: noSleep,
    });
    const second = await validateCandidate(secondRoot);
    return { store, first, second };
  };
  const THIRD: Release = {
    version: laterVersion(2),
    generated: "2026-04-02T12:00:00Z",
    expires: "2026-06-30",
    features: featuresWith({ Test: "2", Other: "2" }),
  };

  it("deletes what only an expired snapshot used and keeps what a live one shares", async () => {
    const { store, first, second } = await threeReleases();
    store.now = new Date("2026-04-02T12:00:00Z");
    const thirdRoot = await emit(THIRD);
    const result = await publishCandidate({
      candidateRoot: thirdRoot,
      store,
      clock: at("2026-04-03"),
      sleep: noSleep,
    });
    const third = await validateCandidate(thirdRoot);

    // The first release expired on 2026-04-01; the second is retained until 2026-04-08.
    const meta = JSON.parse(store.objects.get("v1/meta.json")!.bytes.toString()) as {
      snapshots: Array<{ id: string }>;
    };
    expect(meta.snapshots.map(({ id }) => id)).toEqual([third.snapshotId, second.snapshotId]);

    const live = new Set([...second.blobs, ...third.blobs]);
    const onlyFirst = [...first.blobs].filter((hash) => !live.has(hash));
    expect(onlyFirst.length).toBeGreaterThan(0);
    for (const hash of onlyFirst) expect(store.objects.has(blobPath(hash, "identity"))).toBe(false);
    for (const hash of live) {
      for (const encoding of ["identity", "br", "gzip"] as const)
        expect(store.objects.has(blobPath(hash, encoding))).toBe(true);
    }
    expect(store.objects.has(snapshotRootPath(first.snapshotId))).toBe(false);
    expect(store.objects.has(snapshotRootPath(second.snapshotId))).toBe(true);
    if (result.type !== "published") throw new Error("Expected a publication.");
    expect(result.pruned.deleted).toEqual({
      blobs: onlyFirst.length * 3,
      shards: [...first.shards].filter(
        (hash) => !second.shards.has(hash) && !third.shards.has(hash),
      ).length,
      roots: 1,
      metaCopies: 0,
    });
    expect(result.operations.deletes).toBe(3);
    // The reservation outlives the snapshot, so its identifier can never be reused.
    expect(store.objects.has(`v1/_publication/${first.snapshotId}.json`)).toBe(true);
  });

  it("keeps an unreferenced file until the grace period has passed", async () => {
    const { store } = await threeReleases();
    const orphan = blobPath("f".repeat(64), "identity");
    const put = (date: string): void => {
      store.objects.set(orphan, {
        bytes: Buffer.from("{}\n"),
        etag: '"orphan"',
        metadata: { sha256: sha256(Buffer.from("{}\n")) },
        modified: new Date(date),
      });
    };
    // Six days old: a publication in progress may still be about to point to it.
    put("2026-01-14T12:00:00Z");
    await pruneRetiredSnapshots(store, { clock: at("2026-01-20T11:00:00Z"), sleep: noSleep });
    expect(store.objects.has(orphan)).toBe(true);

    const dryRun = await pruneRetiredSnapshots(store, {
      clock: at("2026-01-22"),
      dryRun: true,
      sleep: noSleep,
    });
    expect(dryRun).toEqual({
      dryRun: true,
      deleted: { blobs: 1, shards: 0, roots: 0, metaCopies: 0 },
    });
    expect(store.objects.has(orphan)).toBe(true);

    const real = await pruneRetiredSnapshots(store, { clock: at("2026-01-22"), sleep: noSleep });
    expect(real).toEqual({
      dryRun: false,
      deleted: { blobs: 1, shards: 0, roots: 0, metaCopies: 0 },
    });
    expect(store.objects.has(orphan)).toBe(false);
  });

  it("deletes copies of superseded metadata once the current metadata has settled", async () => {
    const { store } = await threeReleases();
    const current = store.objects.get("v1/meta.json")!.metadata.sha256!;
    const copies = (): string[] => store.keys("v1/_meta/");
    const isCurrent = (key: string): boolean => key.startsWith(`v1/_meta/${current}.json`);
    // One pair per publication: written on 2026-01-01 and on 2026-01-08.
    expect(copies()).toHaveLength(4);
    expect(copies().filter(isCurrent)).toHaveLength(2);

    // The switch was twelve hours ago: a request that read the first metadata may still be open.
    const early = await pruneRetiredSnapshots(store, {
      clock: at("2026-01-09"),
      sleep: noSleep,
    });
    expect(early.deleted.metaCopies).toBe(0);
    expect(copies()).toHaveLength(4);

    const dryRun = await pruneRetiredSnapshots(store, {
      clock: at("2026-01-10"),
      dryRun: true,
      sleep: noSleep,
    });
    expect(dryRun.deleted.metaCopies).toBe(2);
    expect(copies()).toHaveLength(4);

    const real = await pruneRetiredSnapshots(store, { clock: at("2026-01-10"), sleep: noSleep });
    expect(real.deleted.metaCopies).toBe(2);
    expect(copies().every(isCurrent)).toBe(true);
    expect(copies()).toHaveLength(2);
  });

  it("deletes nothing when a retained snapshot cannot be read completely", async () => {
    const { store, second } = await threeReleases();
    const orphan = blobPath("f".repeat(64), "identity");
    store.objects.set(orphan, {
      bytes: Buffer.from("{}\n"),
      etag: '"orphan"',
      metadata: {},
      modified: new Date("2025-01-01"),
    });
    store.objects.delete(shardPath([...second.shards][0]!));
    await expect(
      pruneRetiredSnapshots(store, { clock: at("2026-01-22"), sleep: noSleep }),
    ).rejects.toThrow("missing a shard");
    expect(store.objects.has(orphan)).toBe(true);
  });

  it("stops when metadata changes during the run, or a listing does not advance", async () => {
    const { store } = await threeReleases();
    const orphan = blobPath("f".repeat(64), "identity");
    store.objects.set(orphan, {
      bytes: Buffer.from("{}\n"),
      etag: '"orphan"',
      metadata: {},
      modified: new Date("2025-01-01"),
    });
    const meta = store.objects.get("v1/meta.json")!;
    const list = store.list.bind(store);
    store.list = async (...args) => {
      const page = await list(...args);
      meta.etag = '"changed-by-another-publication"';
      return page;
    };
    await expect(
      pruneRetiredSnapshots(store, { clock: at("2026-01-22"), sleep: noSleep }),
    ).rejects.toThrow("Metadata changed while pruning");
    expect(store.objects.has(orphan)).toBe(true);

    store.list = list;
    store.repeatedPage = true;
    await expect(
      pruneRetiredSnapshots(store, { clock: at("2026-01-22"), sleep: noSleep }),
    ).rejects.toThrow("did not advance");
  });

  it("reports committed metadata when cleanup fails after the switch", async () => {
    const { store } = await threeReleases();
    store.now = new Date("2026-04-02T12:00:00Z");
    store.failDelete = true;
    await expect(
      publishCandidate({
        candidateRoot: await emit(THIRD),
        store,
        clock: at("2026-04-03"),
        sleep: noSleep,
      }),
    ).rejects.toThrow("Metadata committed but retention cleanup failed");
  });
});

describe("candidate validation", () => {
  it("rejects an empty folder and a folder with a file the snapshot does not name", async () => {
    const empty = await mkdtemp(join(tmpdir(), "bcd-embed-publish-"));
    directories.push(empty);
    await expect(validateCandidate(empty)).rejects.toThrow("must not be empty");

    const extra = await emit(FIRST);
    await writeFile(join(extra, "v1/blobs/extra.json"), "{}\n");
    await expect(validateCandidate(extra)).rejects.toThrow("unexpected file");
  });

  it("rejects a decompression bomb without exceeding identity size", async () => {
    await expect(
      hashDecodedStream(Readable.from([gzipSync(Buffer.alloc(1024 * 1024))]), "gzip", 16),
    ).rejects.toThrow("exceeds its declared identity size");
  });

  it("propagates malformed compressed data", async () => {
    await expect(
      hashDecodedStream(Readable.from([Buffer.from("no")]), "gzip", 16),
    ).rejects.toThrow();
  });
});
