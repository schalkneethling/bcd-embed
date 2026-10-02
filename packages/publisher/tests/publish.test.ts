import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import publicSchema from "../../generator/src/upstream/public.schema.json" with { type: "json" };
import {
  compareOutputTrees,
  createRepresentations,
  emitGeneratedSnapshot,
  generateSnapshot,
  type DiffApproval,
} from "@bcd-embed/generator";
import { ARTIFACT_MANIFEST_PATH, type ArtifactRepresentation } from "@bcd-embed/schema";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parsePublishCommand } from "../src/cli.js";
import {
  publishCandidate,
  readPublicationReservation,
  pruneRetiredSnapshots,
} from "../src/publish.js";
import { restorePublishedBaseline } from "../src/archive.js";
import {
  hashDecodedStream,
  validateCandidate,
  MAX_IDENTITY_BYTES,
  MAX_TOTAL_BYTES,
} from "../src/validate.js";
import type { PublicationStore, PutObject, PutResult, StoredObject } from "../src/store.js";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const directories: string[] = [];

const temporary = async () => {
  const root = await mkdtemp(join(tmpdir(), "bcd-embed-publish-"));
  directories.push(root);
  return root;
};

afterEach(async () => {
  for (const root of directories.splice(0)) await rm(root, { recursive: true, force: true });
});

const fixture = (version: string, name = "api.Test") => ({
  ...Object.fromEntries(
    publicSchema.required
      .filter((key) => key !== "__meta" && key !== "browsers")
      .map((key) => [key, {}]),
  ),
  __meta: { version, timestamp: "2026-01-01T12:00:00Z" },
  browsers: {
    chrome: {
      name: "Chrome",
      type: "desktop",
      accepts_flags: true,
      accepts_webextensions: true,
      releases: { "1": { index: 0, status: "retired", release_date: "2008-12-11" } },
    },
  },
  api: {
    [name.slice(4)]: {
      __compat: { source_file: "api/Test.json", support: { chrome: { version_added: "1" } } },
    },
  },
});

const emit = async (version: string, generated: string, expires: string, name?: string) => {
  const root = await temporary();
  await emitGeneratedSnapshot({
    outputRoot: root,
    generatedSnapshot: generateSnapshot({ generated, expires, data: fixture("8.1.3", name) }),
  });
  if (version === "8.1.3") return root;
  // The generator deliberately pins one BCD release. Exercise later-version
  // publication using transformed *real emitted* artifacts and its encoder.
  const original = await validateCandidate(root);
  const nextRoot = await temporary();
  const oldId = original.meta.current;
  const nextId = oldId.replace("bcd-8.1.3-", `bcd-${version}-`);
  const artifacts: ArtifactRepresentation[] = [];
  for (const entry of original.manifest.artifacts) {
    if (entry.encoding !== "identity") continue;
    const logicalPath = entry.logicalPath.replace(oldId, nextId);
    const data = JSON.parse(await readFile(join(root, entry.path), "utf8"));
    if (entry.logicalPath === "v1/meta.json") {
      data.current = nextId;
      data.snapshots[0].id = nextId;
      data.snapshots[0].source.version = version;
    } else if (
      entry.logicalPath.includes("/features/") ||
      entry.logicalPath.includes("/index") ||
      entry.logicalPath.endsWith("/browsers.json")
    ) {
      data.source.version = version;
    }
    const bytes = Buffer.from(`${JSON.stringify(data)}\n`, "utf8");
    for (const representation of createRepresentations(logicalPath, bytes)) {
      artifacts.push({
        logicalPath: representation.logicalPath,
        encoding: representation.encoding,
        path: representation.path,
        size: representation.size,
        sha256: representation.sha256,
        etag: representation.etag,
      });
      const target = join(nextRoot, representation.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, representation.bytes);
    }
  }
  await writeFile(
    join(nextRoot, ARTIFACT_MANIFEST_PATH),
    `${JSON.stringify({ version: 1, snapshotId: nextId, artifacts })}\n`,
  );
  return nextRoot;
};

const approvalFor = async (baselineRoot: string, candidateRoot: string): Promise<DiffApproval> => {
  const report = await compareOutputTrees({ baselineRoot, candidateRoot });
  return {
    baselineDigest: report.baselineDigest,
    candidateDigest: report.candidateDigest,
    approved: true,
    reason: "Reviewed exact test fixture output",
  };
};

class MemoryStore implements PublicationStore {
  objects = new Map<string, { bytes: Buffer; etag: string; metadata: Record<string, string> }>();
  puts: string[] = [];
  failAfter: number | undefined;
  corruptKey: string | undefined;
  raceOnMeta = false;
  failDelete = false;
  repeatedPage = false;
  onPut: ((key: string) => void) | undefined;
  disposed = 0;

  async get(key: string): Promise<StoredObject | null> {
    const object = this.objects.get(key);
    if (object === undefined) return null;
    return {
      body: Readable.from([object.bytes]),
      dispose: () => {
        this.disposed++;
      },
      etag: object.etag,
      metadata: object.metadata,
      sha256: object.metadata.sha256,
      size: object.bytes.byteLength,
    };
  }

  async put(input: PutObject): Promise<PutResult> {
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
    const chunks: Uint8Array[] = [];
    if (input.body instanceof Uint8Array) {
      chunks.push(input.body);
    } else {
      for await (const chunk of input.body) chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (this.corruptKey === input.key) bytes[0] = (bytes[0] ?? 0) ^ 1;
    const etag = `"${createHash("md5").update(bytes).digest("hex")}"`;
    this.objects.set(input.key, {
      bytes,
      etag,
      metadata: { ...input.metadata, sha256: input.sha256 },
    });
    this.puts.push(input.key);
    this.onPut?.(input.key);
    return { type: "stored", etag };
  }

  async list(prefix: string, startAfter: string | undefined, limit: number) {
    const all = [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
    if (this.repeatedPage && prefix === "v1/_publication/")
      return { keys: all.slice(0, 1), truncated: true };
    const remaining = all.filter((key) => startAfter === undefined || key > startAfter);
    return { keys: remaining.slice(0, limit), truncated: remaining.length > limit };
  }

  async delete(keys: readonly string[]) {
    if (this.failDelete) throw new Error("Simulated cleanup interruption");
    for (const key of keys) this.objects.delete(key);
  }
}

describe("publication state machine", () => {
  it("resumes interrupted private control upload without relaxing candidate identity", async () => {
    const baselineRoot = await temporary();
    const candidateRoot = await emit("8.1.3", "2026-01-01T12:00:00Z", "2026-04-01");
    const store = new MemoryStore();
    const approval = await approvalFor(baselineRoot, candidateRoot);
    store.onPut = (key) => {
      if (key.startsWith("v1/_candidates/")) throw new Error("control interruption");
    };
    await expect(
      publishCandidate({
        baselineRoot,
        candidateRoot,
        store,
        approval,
        clock: () => new Date("2026-01-02"),
      }),
    ).rejects.toThrow("control interruption");
    expect(store.objects.has("v1/meta.json")).toBe(false);
    store.onPut = undefined;
    await expect(
      publishCandidate({
        baselineRoot,
        candidateRoot,
        store,
        approval,
        clock: () => new Date("2026-01-02"),
      }),
    ).resolves.toMatchObject({ type: "published" });
    const candidate = await validateCandidate(candidateRoot);
    const marker = store.objects.get(`v1/_publication/${candidate.meta.current}.json`)!;
    const altered = { ...JSON.parse(marker.bytes.toString()), unexpected: true };
    marker.bytes = Buffer.from(JSON.stringify(altered));
    marker.metadata.sha256 = sha256(marker.bytes);
    await expect(readPublicationReservation(store, candidate.meta.current)).rejects.toThrow(
      "Invalid publication marker",
    );
  });

  it("rejects corrupt, oversized, and missing restoration bodies and remote-current races", async () => {
    const baselineRoot = await temporary();
    const candidateRoot = await emit("8.1.3", "2026-01-01T12:00:00Z", "2026-04-01");
    const store = new MemoryStore();
    await publishCandidate({
      baselineRoot,
      candidateRoot,
      store,
      approval: await approvalFor(baselineRoot, candidateRoot),
      clock: () => new Date("2026-01-02"),
    });
    const candidate = await validateCandidate(candidateRoot);
    const key = candidate.manifest.artifacts.find(
      (item) => item.logicalPath !== "v1/meta.json",
    )!.path;
    const original = store.get.bind(store);
    for (const mode of ["corrupt", "oversized", "missing", "race"] as const) {
      const outputRoot = await temporary();
      let metadataReads = 0;
      const spy = vi.spyOn(store, "get").mockImplementation(async (requested) => {
        const object = await original(requested);
        if (
          mode === "race" &&
          requested === "v1/meta.json" &&
          object !== null &&
          ++metadataReads === 2
        )
          object.etag = '"different"';
        if (requested !== key || object === null || mode === "race") return object;
        if (mode === "missing") {
          object.dispose();
          return null;
        }
        return {
          ...object,
          body: Readable.from([
            mode === "oversized" ? Buffer.alloc(object.size + 1) : Buffer.alloc(object.size),
          ]),
        };
      });
      await expect(restorePublishedBaseline({ store, outputRoot })).rejects.toThrow(
        mode === "race"
          ? "changed during restoration"
          : mode === "missing"
            ? "missing"
            : mode === "oversized"
              ? "exceeds"
              : "byte verification",
      );
      spy.mockRestore();
    }
  });

  it("restores the exact original candidate and reads the strict timestamp reservation", async () => {
    const baselineRoot = await temporary();
    const candidateRoot = await emit("8.1.3", "2026-01-01T12:00:00Z", "2026-04-01");
    const store = new MemoryStore();
    const approval = await approvalFor(baselineRoot, candidateRoot);
    await publishCandidate({
      baselineRoot,
      candidateRoot,
      store,
      approval,
      clock: () => new Date("2026-01-02"),
    });
    const candidate = await validateCandidate(candidateRoot);
    const reservation = await readPublicationReservation(store, candidate.meta.current);
    expect(reservation).toEqual({
      version: 1,
      snapshotId: candidate.meta.current,
      candidateDigest: approval.candidateDigest,
      generated: "2026-01-01T12:00:00Z",
      expires: "2026-04-01",
    });
    const outputRoot = await temporary();
    const result = await restorePublishedBaseline({ store, outputRoot });
    expect(result).toMatchObject({
      candidateDigest: approval.candidateDigest,
      snapshotId: candidate.meta.current,
    });
    const report = await compareOutputTrees({
      baselineRoot: candidateRoot,
      candidateRoot: outputRoot,
    });
    expect(report.candidateDigest).toBe(report.baselineDigest);
    await expect(restorePublishedBaseline({ store, outputRoot })).rejects.toThrow("empty");
    await expect(readPublicationReservation(store, "../secret")).rejects.toThrow();
    expect(await readPublicationReservation(store, "bcd-8.1.4-gen-0.0.0")).toBeNull();
  });

  it("rejects an invalid clock before any storage I/O and fresh expiry before final CAS", async () => {
    const baselineRoot = await temporary();
    const candidateRoot = await emit("8.1.3", "2026-01-01T12:00:00Z", "2026-04-01");
    const store = new MemoryStore();
    const approval = await approvalFor(baselineRoot, candidateRoot);
    await expect(
      publishCandidate({
        baselineRoot,
        candidateRoot,
        store,
        approval,
        clock: () => new Date(Number.NaN),
      }),
    ).rejects.toThrow("finite Date");
    expect(store.disposed).toBe(0);
    expect(store.puts).toEqual([]);
    let now = new Date("2026-01-02");
    store.onPut = (key) => {
      if (key.startsWith("v1/_candidates/")) now = new Date("2026-04-02");
    };
    await expect(
      publishCandidate({ baselineRoot, candidateRoot, store, approval, clock: () => now }),
    ).rejects.toThrow("publishable now");
    expect(store.objects.has("v1/meta.json")).toBe(false);
  });

  it("fails closed on nonadvancing nonempty listing pages", async () => {
    const baselineRoot = await temporary();
    const candidateRoot = await emit("8.1.3", "2026-01-01T12:00:00Z", "2026-04-01");
    const store = new MemoryStore();
    await publishCandidate({
      baselineRoot,
      candidateRoot,
      store,
      approval: await approvalFor(baselineRoot, candidateRoot),
      clock: () => new Date("2026-01-02"),
    });
    store.repeatedPage = true;
    await expect(pruneRetiredSnapshots(store, () => new Date("2026-01-02"))).rejects.toThrow(
      "did not advance",
    );
  });

  it("enforces reviewed identity and aggregate caps before reading artifact bodies", async () => {
    const root = await emit("8.1.3", "2026-01-01T12:00:00Z", "2026-04-01");
    const path = join(root, ARTIFACT_MANIFEST_PATH);
    const original = JSON.parse(await readFile(path, "utf8"));
    const oversized = structuredClone(original);
    const identity = oversized.artifacts.find(
      (artifact: ArtifactRepresentation) => artifact.encoding === "identity",
    );
    identity.size = MAX_IDENTITY_BYTES + 1;
    await writeFile(path, JSON.stringify(oversized));
    await expect(validateCandidate(root)).rejects.toThrow("16 MiB");
    const aggregate = structuredClone(original);
    // Use an encoded entry so the independent aggregate gate is exercised.
    const encoded = aggregate.artifacts.find(
      (artifact: ArtifactRepresentation) => artifact.encoding !== "identity",
    );
    encoded.size = MAX_TOTAL_BYTES + 1;
    await writeFile(path, JSON.stringify(aggregate));
    await expect(validateCandidate(root)).rejects.toThrow("2 GiB");
  });

  it("requires explicit remote-write CLI opt-in", () => {
    expect(parsePublishCommand(["--baseline-root", "a", "--candidate-root", "b"])).toMatchObject({
      remote: undefined,
    });
    expect(() =>
      parsePublishCommand(["--baseline-root", "a", "--candidate-root", "b", "--bucket", "x"]),
    ).toThrow("explicit");
    expect(() =>
      parsePublishCommand([
        "--baseline-root",
        "a",
        "--candidate-root",
        "b",
        "--execute-remote-write",
        "--account-id",
        "0".repeat(32),
      ]),
    ).toThrow("explicit");
  });

  it("blocks unapproved bootstrap before any remote write", async () => {
    const baselineRoot = await temporary();
    const candidateRoot = await emit("8.1.3", "2026-01-01T12:00:00Z", "2026-04-01");
    const store = new MemoryStore();
    await expect(
      publishCandidate({
        baselineRoot,
        candidateRoot,
        store,
        clock: () => new Date("2026-01-02"),
      }),
    ).rejects.toThrow("Output diff blocked");
    expect(store.puts).toEqual([]);
  });

  it("publishes a complete generated tree, verifies bytes, then flips metadata once", async () => {
    const baselineRoot = await temporary();
    const candidateRoot = await emit("8.1.3", "2026-01-01T12:00:00Z", "2026-04-01");
    const approval = await approvalFor(baselineRoot, candidateRoot);
    const store = new MemoryStore();
    const result = await publishCandidate({
      baselineRoot,
      candidateRoot,
      approval,
      store,
      clock: () => new Date("2026-01-02T12:00:00Z"),
    });
    expect(result.type).toBe("published");
    expect(store.puts.at(-1)).toBe("v1/meta.json");
    expect(store.objects.get("v1/meta.json")?.metadata["tree-digest"]).toBe(
      approval.candidateDigest,
    );
    const candidate = await validateCandidate(candidateRoot);
    const feature = candidate.manifest.artifacts.find(
      (item) => item.logicalPath.includes("features/") && item.encoding === "identity",
    )!;
    expect(store.objects.get(feature.path)?.metadata.sha256).toBe(feature.sha256);
    expect(store.objects.get(feature.path)?.etag).not.toBe(feature.etag);

    const originalPuts = store.puts.length;
    const repeated = await publishCandidate({
      baselineRoot,
      candidateRoot,
      approval,
      store,
      clock: () => new Date("2026-01-02T12:00:00Z"),
    });
    expect(repeated.type).toBe("unchanged");
    expect(store.puts.length).toBe(originalPuts);
  });

  it("keeps canonical metadata absent after a partial immutable upload and resumes identical objects", async () => {
    const baselineRoot = await temporary();
    const candidateRoot = await emit("8.1.3", "2026-01-01T12:00:00Z", "2026-04-01");
    const approval = await approvalFor(baselineRoot, candidateRoot);
    const store = new MemoryStore();
    store.failAfter = 3;
    await expect(
      publishCandidate({
        baselineRoot,
        candidateRoot,
        approval,
        store,
        clock: () => new Date("2026-01-02"),
      }),
    ).rejects.toThrow("Simulated");
    expect(store.objects.has("v1/meta.json")).toBe(false);
    expect(store.puts.length).toBeGreaterThan(0);
    store.failAfter = undefined;
    await expect(
      publishCandidate({
        baselineRoot,
        candidateRoot,
        approval,
        store,
        clock: () => new Date("2026-01-02"),
      }),
    ).resolves.toMatchObject({ type: "published" });
  });

  it("rejects a remote baseline that differs from the exact reviewed tree", async () => {
    const baselineRoot = await temporary();
    const firstRoot = await emit("8.1.3", "2026-01-01T12:00:00Z", "2026-04-01");
    const secondRoot = await emit("8.1.4", "2026-03-01T12:00:00Z", "2026-05-30", "api.Changed");
    const store = new MemoryStore();
    await publishCandidate({
      baselineRoot,
      candidateRoot: firstRoot,
      approval: await approvalFor(baselineRoot, firstRoot),
      store,
      clock: () => new Date("2026-01-02"),
    });
    store.objects.get("v1/meta.json")!.metadata["tree-digest"] = "0".repeat(64);
    const putsBefore = store.puts.length;
    await expect(
      publishCandidate({
        baselineRoot: firstRoot,
        candidateRoot: secondRoot,
        approval: await approvalFor(firstRoot, secondRoot),
        store,
        clock: () => new Date("2026-03-02"),
      }),
    ).rejects.toThrow("reviewed baseline");
    expect(store.puts).toHaveLength(putsBefore);
  });

  it("rejects corrupted stored bytes and a conditional metadata race", async () => {
    const baselineRoot = await temporary();
    const candidateRoot = await emit("8.1.3", "2026-01-01T12:00:00Z", "2026-04-01");
    const approval = await approvalFor(baselineRoot, candidateRoot);
    const store = new MemoryStore();
    const candidate = await validateCandidate(candidateRoot);
    store.corruptKey = candidate.manifest.artifacts.find(
      (item) => item.encoding === "identity" && item.logicalPath !== "v1/meta.json",
    )!.path;
    await expect(
      publishCandidate({
        baselineRoot,
        candidateRoot,
        approval,
        store,
        clock: () => new Date("2026-01-02"),
      }),
    ).rejects.toThrow("checksum");
    expect(store.objects.has("v1/meta.json")).toBe(false);
    store.corruptKey = undefined;
    store.objects.delete(
      candidate.manifest.artifacts.find(
        (item) => item.encoding === "identity" && item.logicalPath !== "v1/meta.json",
      )!.path,
    );
    store.raceOnMeta = true;
    await expect(
      publishCandidate({
        baselineRoot,
        candidateRoot,
        approval,
        store,
        clock: () => new Date("2026-01-02"),
      }),
    ).rejects.toThrow("race");
    expect(store.objects.has("v1/meta.json")).toBe(false);
  });

  it("reports committed metadata after cleanup failure, then resumes retirement without repeated IDs", async () => {
    const baselineRoot = await temporary();
    const firstRoot = await emit("8.1.3", "2026-01-01T12:00:00Z", "2026-04-01");
    const secondRoot = await emit("8.1.4", "2026-04-02T12:00:00Z", "2026-07-01", "api.Changed");
    const store = new MemoryStore();
    await publishCandidate({
      baselineRoot,
      candidateRoot: firstRoot,
      approval: await approvalFor(baselineRoot, firstRoot),
      store,
      clock: () => new Date("2026-01-02"),
    });
    const firstId = (await validateCandidate(firstRoot)).meta.current;
    const secondId = (await validateCandidate(secondRoot)).meta.current;
    const secondApproval = await approvalFor(firstRoot, secondRoot);
    store.failDelete = true;
    await expect(
      publishCandidate({
        baselineRoot: firstRoot,
        candidateRoot: secondRoot,
        approval: secondApproval,
        store,
        clock: () => new Date("2026-04-03"),
      }),
    ).rejects.toThrow("Metadata committed but retention cleanup failed; investigate before retry.");
    expect(JSON.parse(store.objects.get("v1/meta.json")!.bytes.toString()).current).toBe(secondId);
    expect([...store.objects.keys()].some((key) => key.startsWith(`v1/${firstId}/`))).toBe(true);
    store.failDelete = false;
    const second = await publishCandidate({
      baselineRoot: firstRoot,
      candidateRoot: secondRoot,
      approval: secondApproval,
      store,
      clock: () => new Date("2026-04-03"),
    });
    expect(second).toMatchObject({ type: "unchanged", pruned: [firstId] });
    expect([...store.objects.keys()].some((key) => key.startsWith(`v1/${firstId}/`))).toBe(false);
    expect([...store.objects.keys()].some((key) => key.startsWith(`v1/${secondId}/`))).toBe(true);
    expect(JSON.parse(store.objects.get("v1/meta.json")!.bytes.toString()).current).toBe(secondId);
    expect(await pruneRetiredSnapshots(store, () => new Date("2026-04-03"))).toEqual([]);
  });

  it("retains snapshots during publish, then no-change cleanup CAS removes membership before retryable deletion", async () => {
    const baselineRoot = await temporary();
    const firstRoot = await emit("8.1.3", "2026-01-01T12:00:00Z", "2026-04-01");
    const secondRoot = await emit("8.1.4", "2026-03-01T12:00:00Z", "2026-05-30", "api.Changed");
    const store = new MemoryStore();
    const firstApproval = await approvalFor(baselineRoot, firstRoot);
    const secondApproval = await approvalFor(firstRoot, secondRoot);
    await publishCandidate({
      baselineRoot,
      candidateRoot: firstRoot,
      approval: firstApproval,
      store,
      clock: () => new Date("2026-01-02"),
    });
    await publishCandidate({
      baselineRoot: firstRoot,
      candidateRoot: secondRoot,
      approval: secondApproval,
      store,
      clock: () => new Date("2026-03-02"),
    });
    const firstId = (await validateCandidate(firstRoot)).meta.current;
    const before = JSON.parse(store.objects.get("v1/meta.json")!.bytes.toString());
    expect(before.snapshots).toHaveLength(2);
    const outputRoot = await temporary();
    await restorePublishedBaseline({ store, outputRoot });
    const restored = await compareOutputTrees({
      baselineRoot: secondRoot,
      candidateRoot: outputRoot,
    });
    expect(restored.candidateDigest).toBe(restored.baselineDigest);

    store.failDelete = true;
    await expect(
      publishCandidate({
        baselineRoot: firstRoot,
        candidateRoot: secondRoot,
        approval: secondApproval,
        store,
        clock: () => new Date("2026-04-03"),
      }),
    ).rejects.toThrow("cleanup interruption");
    const retired = JSON.parse(store.objects.get("v1/meta.json")!.bytes.toString());
    expect(retired.snapshots).toHaveLength(1);
    expect(retired.current).not.toBe(firstId);
    expect([...store.objects.keys()].some((key) => key.startsWith(`v1/${firstId}/`))).toBe(true);

    store.failDelete = false;
    const deleteObjects = store.delete.bind(store);
    const interruptedControls = vi.spyOn(store, "delete").mockImplementation(async (keys) => {
      if (keys.some((key) => key.startsWith(`v1/_candidates/${firstId}/`))) {
        throw new Error("Simulated control cleanup interruption");
      }
      await deleteObjects(keys);
    });
    await expect(pruneRetiredSnapshots(store, () => new Date("2026-04-03"))).rejects.toThrow(
      "control cleanup interruption",
    );
    interruptedControls.mockRestore();
    expect([...store.objects.keys()].some((key) => key.startsWith(`v1/${firstId}/`))).toBe(false);
    expect(
      [...store.objects.keys()].some((key) => key.startsWith(`v1/_candidates/${firstId}/`)),
    ).toBe(true);

    const resumed = await publishCandidate({
      baselineRoot: firstRoot,
      candidateRoot: secondRoot,
      approval: secondApproval,
      store,
      clock: () => new Date("2026-04-03"),
    });
    expect(resumed).toMatchObject({ type: "unchanged", pruned: [firstId] });
    expect([...store.objects.keys()].some((key) => key.startsWith(`v1/${firstId}/`))).toBe(false);
    expect(
      [...store.objects.keys()].some((key) => key.startsWith(`v1/_candidates/${firstId}/`)),
    ).toBe(false);
    expect(store.objects.has(`v1/_publication/${firstId}.json`)).toBe(true);
    expect(await pruneRetiredSnapshots(store, () => new Date("2026-04-03"))).toEqual([]);
  });
});

describe("candidate compression validation", () => {
  it("rejects a decompression bomb without exceeding identity size", async () => {
    const compressed = gzipSync(Buffer.alloc(100_000, 65));
    await expect(hashDecodedStream(Readable.from([compressed]), "gzip", 16)).rejects.toThrow(
      "exceeds",
    );
  });

  it("propagates malformed compressed data and source stream failures", async () => {
    await expect(
      hashDecodedStream(Readable.from([Buffer.from("bad")]), "gzip", 100),
    ).rejects.toThrow();
    const source = new Readable({
      read() {
        this.destroy(new Error("source failed"));
      },
    });
    await expect(hashDecodedStream(source, "gzip", 100)).rejects.toThrow("source failed");
    expect(source.destroyed).toBe(true);
  });

  it("rejects missing manifest inventory and variant corruption", async () => {
    const root = await emit("8.1.3", "2026-01-01T12:00:00Z", "2026-04-01");
    const candidate = await validateCandidate(root);
    const variant = candidate.manifest.artifacts.find((item) => item.encoding === "gzip")!;
    const path = join(root, variant.path);
    const bytes = await readFile(path);
    await writeFile(path, Buffer.from("corrupt"));
    await expect(validateCandidate(root)).rejects.toThrow("manifest");
    await writeFile(path, bytes);
    await mkdir(join(root, "extra"));
    await writeFile(join(root, "extra", "unexpected.json"), "{}\n");
    await expect(validateCandidate(root)).rejects.toThrow("inventory");
    expect(sha256(bytes)).toBe(variant.sha256);
  });

  it("rejects a self-consistent manifest that omits the generated snapshot", async () => {
    const generatedRoot = await emit("8.1.3", "2026-01-01T12:00:00Z", "2026-04-01");
    const generated = await validateCandidate(generatedRoot);
    const forgedRoot = await temporary();
    const metaOnly = generated.manifest.artifacts.filter(
      (item) => item.logicalPath === "v1/meta.json",
    );
    for (const item of metaOnly) {
      const target = join(forgedRoot, item.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, await readFile(join(generatedRoot, item.path)));
    }
    await writeFile(
      join(forgedRoot, ARTIFACT_MANIFEST_PATH),
      `${JSON.stringify({ version: 1, snapshotId: generated.meta.current, artifacts: metaOnly })}\n`,
    );
    await expect(validateCandidate(forgedRoot)).rejects.toThrow("missing required identity");
  });
});
