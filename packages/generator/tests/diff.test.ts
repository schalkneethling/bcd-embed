import { mkdtemp, opendir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

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

import { compareOutputTrees, parseDiffApproval } from "../src/diff.js";
import { emitGeneratedSnapshot } from "../src/emit.js";
import { generateSnapshot } from "../src/generate.js";
import { createRepresentations } from "../src/representations.js";

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
  __meta: { version: "8.1.3", timestamp: "2026-09-01T00:00:00Z" },
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

const emit = async (root: string, generated: string, data = fixture()) => {
  const generatedSnapshot = generateSnapshot({
    generated,
    expires: "2026-12-31",
    data,
  });
  await emitGeneratedSnapshot({ outputRoot: root, generatedSnapshot });
  return generatedSnapshot.snapshot.id;
};

const walkJsonFiles = async (root: string): Promise<string[]> => {
  const paths: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await opendir(directory);
    for await (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else paths.push(path);
    }
  };
  await visit(root);
  return paths;
};

const refreshRepresentations = async (root: string, snapshotId: string): Promise<void> => {
  const paths = await walkJsonFiles(root);
  for (const path of paths) {
    if (path.endsWith(".json.br") || path.endsWith(".json.gz")) await rm(path);
  }
  const identities = paths.filter(
    (path) => path.endsWith(".json") && !path.endsWith(".bcd-embed-manifest.json"),
  );
  const artifacts = [];
  for (const path of identities) {
    const logicalPath = relative(root, path).split("\\").join("/");
    for (const artifact of createRepresentations(logicalPath, await readFile(path))) {
      await writeFile(join(root, artifact.path), artifact.bytes);
      const { bytes: _bytes, ...entry } = artifact;
      artifacts.push(entry);
    }
  }
  await writeFile(
    join(root, ".bcd-embed-manifest.json"),
    `${JSON.stringify({ version: 1, snapshotId, artifacts })}\n`,
  );
};

const rewriteProvenance = async (
  root: string,
  originalId: string,
  next: { version: string; generatorVersion: string; generated: string },
): Promise<void> => {
  const newId = `bcd-${next.version}-gen-${next.generatorVersion}`;
  await rename(join(root, "v1", originalId), join(root, "v1", newId));
  const metaPath = join(root, "v1/meta.json");
  const meta = JSON.parse(await readFile(metaPath, "utf8")) as {
    current: string;
    generated: string;
    snapshots: Array<{
      id: string;
      generatorVersion: string;
      generated: string;
      source: { version: string };
    }>;
  };
  meta.current = newId;
  meta.generated = next.generated;
  for (const snapshot of meta.snapshots) {
    snapshot.id = newId;
    snapshot.generatorVersion = next.generatorVersion;
    snapshot.generated = next.generated;
    snapshot.source.version = next.version;
  }
  await writeFile(metaPath, `${JSON.stringify(meta)}\n`);
  for (const path of await walkJsonFiles(join(root, "v1", newId))) {
    if (!path.endsWith(".json") || path.includes("/raw/")) continue;
    const value = JSON.parse(await readFile(path, "utf8")) as {
      generated: string;
      source: { version: string };
    };
    value.generated = next.generated;
    value.source.version = next.version;
    await writeFile(path, `${JSON.stringify(value)}\n`);
  }
  await refreshRepresentations(root, newId);
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

  it("normalizes generated/source version provenance but preserves data", async () => {
    const baseline = await output();
    const candidate = await output();
    const baselineId = await emit(baseline, "2026-09-01T00:00:00Z");
    await rewriteProvenance(baseline, baselineId, {
      version: "8.1.2",
      generatorVersion: "0.0.1",
      generated: "2026-09-01T00:00:00Z",
    });
    await emit(candidate, "2026-09-02T00:00:00Z");

    const report = await compareOutputTrees({ baselineRoot: baseline, candidateRoot: candidate });
    expect(report.baselineVersion).toBe("8.1.2");
    expect(report.candidateVersion).toBe("8.1.3");
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
    expect(baselineId).toContain("bcd-8.1.3-gen-");
  }, 30_000);

  it("uses the same bytes for exact and semantic digests when a file changes during reading", async () => {
    const baseline = await output();
    const candidate = await output();
    const id = await emit(baseline, "2026-09-01T00:00:00Z");
    await emit(candidate, "2026-09-02T00:00:00Z");
    const featurePath = join(candidate, "v1", id, "features/api.feature0.json");
    const originalBytes = await readFile(featurePath);
    const changedFeature = JSON.parse(originalBytes.toString("utf8")) as {
      features: Array<{ support: { chrome: { version_added: string } } }>;
    };
    changedFeature.features[0]!.support.chrome.version_added = "2";

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
    const id = await emit(baseline, "2026-09-01T00:00:00Z");
    await emit(candidate, "2026-09-02T00:00:00Z");
    const featurePath = join(candidate, "v1", id, "features/api.feature0.json");
    const feature = JSON.parse(await readFile(featurePath, "utf8")) as { contract: string };
    feature.contract = "2.0.0";
    await writeFile(featurePath, `${JSON.stringify(feature)}\n`);
    await refreshRepresentations(candidate, id);
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

  it("rejects unlisted representation files and manifest byte mismatches", async () => {
    const baseline = await output();
    const extraRepresentation = await output();
    const forgedManifest = await output();
    await emit(baseline, "2026-09-01T00:00:00Z");
    const extraId = await emit(extraRepresentation, "2026-09-02T00:00:00Z");
    const manifestId = await emit(forgedManifest, "2026-09-03T00:00:00Z");

    const extraPath = join(extraRepresentation, "v1", extraId, "features/api.extra.json.gz");
    await writeFile(extraPath, "unlisted representation");
    await expect(
      compareOutputTrees({ baselineRoot: baseline, candidateRoot: extraRepresentation }),
    ).rejects.toThrow("Artifact manifest inventory does not match files");

    const manifestPath = join(forgedManifest, ".bcd-embed-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      artifacts: Array<{ path: string; size: number }>;
      snapshotId: string;
    };
    expect(manifest.snapshotId).toBe(manifestId);
    manifest.artifacts[0]!.size += 1;
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
    await expect(
      compareOutputTrees({ baselineRoot: baseline, candidateRoot: forgedManifest }),
    ).rejects.toThrow("Artifact manifest does not match file");
  });

  it("requires digest-bound approval for bootstrap and rejects stale approvals", async () => {
    const baseline = await output();
    const candidate = await output();
    const id = await emit(candidate, "2026-09-02T00:00:00Z");
    const initial = await compareOutputTrees({ baselineRoot: baseline, candidateRoot: candidate });
    expect(initial.bootstrap).toBe(true);
    expect(initial.blocked).toContain("Bootstrap has no approved baseline.");
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
    expect(accepted.blocked).toContain("Bootstrap has no approved baseline.");
    expect(accepted.semanticChanged).toBe(true);
    expect(accepted.approved).toBe(true);
    const rawPath = join(candidate, "v1", id, "raw/api.feature0.json");
    await writeFile(rawPath, `${await readFile(rawPath, "utf8")} `);
    await refreshRepresentations(candidate, id);
    await expect(
      compareOutputTrees({ baselineRoot: baseline, candidateRoot: candidate, approval }),
    ).rejects.toThrow("does not match these exact");
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
