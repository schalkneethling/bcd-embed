import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import bcd from "@mdn/browser-compat-data" with { type: "json" };
import { afterEach, describe, expect, it, vi } from "vitest";

const readMutation = vi.hoisted(() => ({
  enabled: false,
  path: "",
  replacement: "",
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      const bytes = await actual.readFile(...args);
      if (readMutation.enabled && args[0] === readMutation.path) {
        readMutation.enabled = false;
        await actual.writeFile(readMutation.path, readMutation.replacement);
      }
      return bytes;
    },
  };
});

import { blobPath, snapshotRootPath } from "@bcd-embed/schema";

import { emitContentTree, shardIndexOf } from "../src/content-tree.js";
import { compareOutputTrees, DiffApprovalMismatchError, parseDiffApproval } from "../src/diff.js";
import { generateSnapshot, type GeneratedArtifact } from "../src/generate.js";
import { BCD_VERSION } from "../src/input.js";
import { withRelease, writeContentTree } from "./support/write-content-tree.js";

const outputRoots: string[] = [];
const output = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "bcd-embed-output-diff-"));
  outputRoots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(
    outputRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const fixture = (
  features = 1,
  version: string | ((index: number) => string) = "1",
  namespace = "api",
) => ({
  ...Object.fromEntries(
    Object.keys(bcd)
      .filter((key) => key !== "__meta" && key !== "browsers")
      .map((key) => [key, {}]),
  ),
  __meta: { version: BCD_VERSION, timestamp: "2026-09-01T00:00:00Z" },
  browsers: {
    chrome: {
      name: "Chrome",
      type: "desktop",
      accepts_flags: true,
      accepts_webextensions: true,
      releases: { "1": { index: 0, status: "current" } },
    },
  },
  [namespace]: Object.fromEntries(
    Array.from({ length: features }, (_, index) => [
      `feature${index}`,
      {
        __compat: {
          source_file: `api/feature${index}.json`,
          support: {
            chrome: { version_added: typeof version === "string" ? version : version(index) },
          },
        },
      },
    ]),
  ),
});

const generate = (generated: string, data: unknown = fixture()) =>
  generateSnapshot({ generated, expires: "2026-12-31", data });

const emit = async (root: string, generated: string, data: unknown = fixture()) => {
  const generatedSnapshot = generate(generated, data);
  await emitContentTree({ outputRoot: root, generatedSnapshot });
  return generatedSnapshot.snapshot.id;
};

/** Writes a tree after `change` has altered its artifacts, bypassing the emitter's checks. */
const emitChanged = async (
  root: string,
  generated: string,
  change: (artifacts: GeneratedArtifact[]) => void,
): Promise<string> => {
  const generatedSnapshot = generate(generated);
  const artifacts = [...generatedSnapshot.artifacts];
  change(artifacts);
  await writeContentTree(root, generatedSnapshot.snapshot.id, artifacts);
  return generatedSnapshot.snapshot.id;
};

const blobOf = (artifacts: Iterable<GeneratedArtifact>, suffix: string): string => {
  const artifact = [...artifacts].find(({ path }) => path.endsWith(suffix))!;
  return blobPath(
    createHash("sha256")
      .update(`${JSON.stringify(artifact.data)}\n`)
      .digest("hex"),
    "identity",
  );
};

describe("compareOutputTrees", () => {
  it("accepts only exact-hash approvals with a human reason", () => {
    expect(
      parseDiffApproval({
        baselineDigest: "a".repeat(64),
        candidateDigest: "b".repeat(64),
        approved: true,
        reason: "Reviewed release change",
      }),
    ).toMatchObject({ approved: true });
    expect(() =>
      parseDiffApproval({
        baselineDigest: "a".repeat(64),
        candidateDigest: "b".repeat(64),
        approved: true,
        reason: "Reviewed release change",
        force: true,
      }),
    ).toThrow("Approval must contain");
  });

  it("ignores the release a snapshot belongs to when its data is the same", async () => {
    const baseline = await output();
    const candidate = await output();
    await emitContentTree({
      outputRoot: baseline,
      generatedSnapshot: withRelease(generate("2026-09-01T00:00:00Z"), {
        version: "8.1.2",
        generatorVersion: "0.0.1",
      }),
    });
    await emit(candidate, "2026-09-02T00:00:00Z");

    const report = await compareOutputTrees({ baselineRoot: baseline, candidateRoot: candidate });
    expect(report.baselineVersion).toBe("8.1.2");
    expect(report.candidateVersion).toBe(BCD_VERSION);
    expect(report.features).toEqual({
      baseline: 1,
      candidate: 1,
      added: 0,
      removed: 0,
      changed: 0,
    });
    expect(report.semanticChanged).toBe(false);
    expect(report.blocked).toEqual([]);
    expect(report.baselineDigest).not.toBe(report.candidateDigest);
  });

  // Hundreds of compressed fixture files need headroom on contended CI disks.
  it("counts a real raw and normalized feature data change", async () => {
    const baseline = await output();
    const candidate = await output();
    const baselineId = await emit(baseline, "2026-09-01T00:00:00Z", fixture(101));
    await emit(
      candidate,
      "2026-09-02T00:00:00Z",
      fixture(101, (index) => (index === 0 ? "2" : "1")),
    );
    const report = await compareOutputTrees({ baselineRoot: baseline, candidateRoot: candidate });
    expect(report.features).toEqual({
      baseline: 101,
      candidate: 101,
      added: 0,
      removed: 0,
      changed: 1,
    });
    expect(report.semanticChanged).toBe(true);
    expect(report.blocked).toEqual([]);
    expect(baselineId).toContain(`bcd-${BCD_VERSION}-gen-`);
  }, 30_000);

  it("uses the same bytes for exact and semantic digests when a file changes during reading", async () => {
    const baseline = await output();
    const candidate = await output();
    const id = await emit(baseline, "2026-09-01T00:00:00Z");
    await emit(candidate, "2026-09-02T00:00:00Z");
    const featurePath = join(
      candidate,
      blobOf(generate("2026-09-02T00:00:00Z").artifacts, "features/api.feature0.json"),
    );
    const changedFeature = JSON.parse(await readFile(featurePath, "utf8")) as {
      features: Array<{ support: { chrome: { version_added: string } } }>;
    };
    changedFeature.features[0]!.support.chrome.version_added = "2";
    expect(id).toContain(BCD_VERSION);

    const before = await compareOutputTrees({ baselineRoot: baseline, candidateRoot: candidate });
    readMutation.path = featurePath;
    readMutation.replacement = JSON.stringify(changedFeature);
    readMutation.enabled = true;
    try {
      const raced = await compareOutputTrees({ baselineRoot: baseline, candidateRoot: candidate });
      expect(readMutation.enabled).toBe(false);
      expect(raced.features.changed).toBe(0);
      expect(raced.candidateDigest).toBe(before.candidateDigest);
      expect(raced.semanticDigest).toBe(before.semanticDigest);
    } finally {
      readMutation.enabled = false;
    }
  });

  it("reports feature additions and removals from the emitted indexes", async () => {
    const baselineAdded = await output();
    const candidateAdded = await output();
    const baselineRemoved = await output();
    const candidateRemoved = await output();
    await emit(baselineAdded, "2026-09-01T00:00:00Z", fixture(2));
    await emit(candidateAdded, "2026-09-02T00:00:00Z", fixture(3));
    await emit(baselineRemoved, "2026-09-01T00:00:00Z", fixture(3));
    await emit(candidateRemoved, "2026-09-02T00:00:00Z", fixture(2));
    const added = await compareOutputTrees({
      baselineRoot: baselineAdded,
      candidateRoot: candidateAdded,
    });
    const removed = await compareOutputTrees({
      baselineRoot: baselineRemoved,
      candidateRoot: candidateRemoved,
    });
    expect(added.features).toMatchObject({
      baseline: 2,
      candidate: 3,
      added: 1,
      removed: 0,
      changed: 0,
    });
    expect(added.indexes.addedKeys).toBe(1);
    expect(removed.features).toMatchObject({
      baseline: 3,
      candidate: 2,
      added: 0,
      removed: 1,
      changed: 0,
    });
    expect(removed.indexes.removedKeys).toBe(1);
  });

  it("fails closed on schema/contract errors", async () => {
    const baseline = await output();
    const candidate = await output();
    await emit(baseline, "2026-09-01T00:00:00Z");
    await emitChanged(candidate, "2026-09-02T00:00:00Z", (artifacts) => {
      const feature = artifacts.find(({ kind }) => kind === "feature")!;
      (feature.data as { contract: string }).contract = "2.0.0";
    });
    const approval = {
      baselineDigest: "a".repeat(64),
      candidateDigest: "b".repeat(64),
      approved: true as const,
      reason: "Schema failures cannot be waived",
    };
    await expect(
      compareOutputTrees({ baselineRoot: baseline, candidateRoot: candidate, approval }),
    ).rejects.toThrow("Invalid input");
  });

  it("names the tree that is missing its metadata file", async () => {
    const baseline = await output();
    const candidate = await output();
    await emit(baseline, "2026-09-01T00:00:00Z");
    await emit(candidate, "2026-09-02T00:00:00Z");
    await rm(join(baseline, "v1/meta.json"));
    await expect(
      compareOutputTrees({ baselineRoot: baseline, candidateRoot: candidate }),
    ).rejects.toThrow(`Artifact tree '${baseline}' is missing 'v1/meta.json'.`);
  });

  it("rejects a tree whose files and pointers disagree", async () => {
    const baseline = await output();
    await emit(baseline, "2026-09-01T00:00:00Z");
    const artifacts = [...generate("2026-09-02T00:00:00Z").artifacts];
    const feature = blobOf(artifacts, "features/api.feature0.json");
    const damaged = async (damage: (root: string) => Promise<void>): Promise<string> => {
      const root = await output();
      await emit(root, "2026-09-02T00:00:00Z");
      await damage(root);
      return root;
    };
    const failure = (candidateRoot: string) =>
      compareOutputTrees({ baselineRoot: baseline, candidateRoot });

    await expect(
      failure(await damaged((root) => writeFile(join(root, "v1/blobs/extra.json"), "{}\n"))),
    ).rejects.toThrow("holds unexpected file 'v1/blobs/extra.json'");
    await expect(
      failure(await damaged((root) => writeFile(join(root, feature), "{}\n"))),
    ).rejects.toThrow(`'${feature}' does not hash to its name.`);
    await expect(
      failure(await damaged((root) => writeFile(join(root, `${feature}.gz`), "not gzip"))),
    ).rejects.toThrow(`'${feature}.gz' does not decode.`);
    await expect(failure(await damaged((root) => rm(join(root, `${feature}.br`))))).rejects.toThrow(
      `is missing '${feature}.br'.`,
    );
  });

  it("rejects a key stored in a shard its hash does not select", async () => {
    const baseline = await output();
    const candidate = await output();
    await emit(baseline, "2026-09-01T00:00:00Z");
    const id = await emit(candidate, "2026-09-02T00:00:00Z");
    const rootPath = join(candidate, snapshotRootPath(id));
    const root = JSON.parse(await readFile(rootPath, "utf8")) as { shards: string[] };
    const index = shardIndexOf("api.feature0");
    const other = (index + 1) % root.shards.length;
    [root.shards[index], root.shards[other]] = [root.shards[other]!, root.shards[index]!];
    await writeFile(rootPath, `${JSON.stringify(root)}\n`);
    await expect(
      compareOutputTrees({ baselineRoot: baseline, candidateRoot: candidate }),
    ).rejects.toThrow("which its hash does not select");
  });

  it("requires digest-bound approval for bootstrap and rejects stale approvals", async () => {
    const baseline = await output();
    const candidate = await output();
    await emit(candidate, "2026-09-02T00:00:00Z");
    const initial = await compareOutputTrees({ baselineRoot: baseline, candidateRoot: candidate });
    expect(initial.bootstrap).toBe(true);
    expect(initial.baselineSemanticDigest).toBeNull();
    expect(initial.blocked).toEqual(["Bootstrap has no approved baseline."]);
    const approval = {
      baselineDigest: initial.baselineDigest,
      candidateDigest: initial.candidateDigest,
      approved: true as const,
      reason: "Initial snapshot reviewed",
    };
    const accepted = await compareOutputTrees({
      baselineRoot: baseline,
      candidateRoot: candidate,
      approval,
    });
    expect(accepted.blocked).toEqual(["Bootstrap has no approved baseline."]);
    expect(accepted.semanticChanged).toBe(true);
    expect(accepted.approved).toBe(true);
    const changedCandidate = await output();
    await emit(changedCandidate, "2026-09-02T00:00:00Z", fixture(1, "2"));
    const stale = compareOutputTrees({
      baselineRoot: baseline,
      candidateRoot: changedCandidate,
      approval,
    });
    await expect(stale).rejects.toThrow("does not match these exact");
    await expect(stale).rejects.toBeInstanceOf(DiffApprovalMismatchError);
  });

  it("blocks large changes until an exact-output approval is provided", async () => {
    const baseline = await output();
    const candidate = await output();
    const baselineId = await emit(baseline, "2026-09-01T00:00:00Z", fixture(100, "1"));
    await emit(
      candidate,
      "2026-09-02T00:00:00Z",
      fixture(100, (index) => (index < 11 ? "2" : "1")),
    );
    const report = await compareOutputTrees({ baselineRoot: baseline, candidateRoot: candidate });
    expect(report.features).toMatchObject({ baseline: 100, candidate: 100, changed: 11 });
    expect(report.baselineSemanticDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(report.baselineSemanticDigest).not.toBe(report.semanticDigest);
    expect(report.blocked).toContain("Changed feature magnitude exceeds the reviewed policy.");
    const approval = {
      baselineDigest: report.baselineDigest,
      candidateDigest: report.candidateDigest,
      approved: true as const,
      reason: "Six feature changes reviewed",
    };
    const approved = await compareOutputTrees({
      baselineRoot: baseline,
      candidateRoot: candidate,
      approval,
    });
    expect(approved.blocked).toContain("Changed feature magnitude exceeds the reviewed policy.");
    expect(approved.approved).toBe(true);
    expect(baselineId).toBeTruthy();
  });

  it("permits the exact changed-percent boundary but blocks one point above it", async () => {
    const baseline = await output();
    const boundaryCandidate = await output();
    const overCandidate = await output();
    await emit(baseline, "2026-09-01T00:00:00Z", fixture(100, "1"));
    await emit(
      boundaryCandidate,
      "2026-09-02T00:00:00Z",
      fixture(100, (index) => (index < 10 ? "2" : "1")),
    );
    await emit(
      overCandidate,
      "2026-09-03T00:00:00Z",
      fixture(100, (index) => (index < 11 ? "2" : "1")),
    );

    const boundary = await compareOutputTrees({
      baselineRoot: baseline,
      candidateRoot: boundaryCandidate,
    });
    const over = await compareOutputTrees({ baselineRoot: baseline, candidateRoot: overCandidate });
    expect(boundary.features.changed).toBe(10);
    expect(boundary.blocked).toEqual([]);
    expect(over.features.changed).toBe(11);
    expect(over.blocked).toContain("Changed feature magnitude exceeds the reviewed policy.");
  });

  it("blocks a namespace add/remove even when feature magnitude is small", async () => {
    const baseline = await output();
    const candidate = await output();
    await emit(baseline, "2026-09-01T00:00:00Z");
    await emit(candidate, "2026-09-02T00:00:00Z", fixture(1, "1", "css"));
    const report = await compareOutputTrees({ baselineRoot: baseline, candidateRoot: candidate });
    expect(report.namespaces.added).toEqual(["css"]);
    expect(report.blocked).toContain("Namespace structure changes require explicit review.");
  });
});
