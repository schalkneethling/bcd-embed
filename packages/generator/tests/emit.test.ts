import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import bcd from "@mdn/browser-compat-data" with { type: "json" };
import {
  browsersResponseSchema,
  CONTRACT_VERSION,
  indexResponseSchema,
  metaResponseSchema,
  snapshotSchema,
} from "@bcd-embed/schema";
import { v1NormalizedFixture } from "../../schema/src/fixtures/v1.js";
import { afterEach, describe, expect, it } from "vitest";

import { emitGeneratedSnapshot } from "../src/emit.js";
import type { GeneratedArtifact, GeneratedSnapshot } from "../src/generate.js";

const snapshotId = "bcd-8.0.13-gen-0.0.0";
const generated = "2026-09-27T12:00:00Z";
const temporaryDirectories: string[] = [];

const snapshot = snapshotSchema.parse({
  id: snapshotId,
  source: { package: "@mdn/browser-compat-data", version: "8.0.13" },
  generatorVersion: "0.0.0",
  generated,
  expires: "2026-12-26",
});
const envelope = { contract: CONTRACT_VERSION, generated, source: snapshot.source };

const fixtureArtifacts = ({ metaGenerated = generated } = {}): GeneratedArtifact[] => [
  {
    kind: "browsers",
    path: `v1/${snapshotId}/browsers.json`,
    data: browsersResponseSchema.parse({
      ...envelope,
      browsers: {
        chrome: {
          name: "Chrome",
          type: "desktop",
          previewName: null,
          releases: [{ version: "1", releaseDate: "2008-12-11", status: "retired" }],
        },
      },
    }),
  },
  {
    kind: "index",
    path: `v1/${snapshotId}/index.json`,
    data: indexResponseSchema.parse({ ...envelope, namespace: null, keys: ["api.Foo"] }),
  },
  {
    kind: "index",
    path: `v1/${snapshotId}/index/api.json`,
    data: indexResponseSchema.parse({ ...envelope, namespace: "api", keys: ["api.Foo"] }),
  },
  {
    kind: "feature",
    path: `v1/${snapshotId}/features/api.Foo.json`,
    data: { ...v1NormalizedFixture, ...envelope, query: "api.Foo" },
  },
  { kind: "raw", path: `v1/${snapshotId}/raw/api.Foo.json`, data: bcd.api.AbortController! },
  {
    kind: "meta",
    path: "v1/meta.json",
    data: metaResponseSchema.parse({
      contract: CONTRACT_VERSION,
      generated: metaGenerated,
      current: snapshotId,
      snapshots: [snapshot],
      namespaces: ["api"],
    }),
  },
];

const fixtureSnapshot = (
  artifacts: Iterable<GeneratedArtifact> = fixtureArtifacts(),
): GeneratedSnapshot => ({
  snapshot,
  namespaces: ["api"],
  artifacts,
});

const artifactOfKind = <Kind extends GeneratedArtifact["kind"]>(
  artifacts: GeneratedArtifact[],
  kind: Kind,
  pathSuffix = "",
): Extract<GeneratedArtifact, { kind: Kind }> => {
  const artifact = artifacts.find(
    (candidate) => candidate.kind === kind && candidate.path.endsWith(pathSuffix),
  );
  if (artifact === undefined) throw new Error(`Missing ${kind} fixture artifact.`);
  return artifact as Extract<GeneratedArtifact, { kind: Kind }>;
};

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "bcd-embed-emission-"));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

const stagingDirectories = async (root: string): Promise<string[]> =>
  (await readdir(root)).filter((entry) => entry.startsWith(".bcd-embed-stage-"));

describe("emitGeneratedSnapshot", () => {
  it("rejects an empty output root", async () => {
    await expect(
      emitGeneratedSnapshot({ outputRoot: "   ", generatedSnapshot: fixtureSnapshot() }),
    ).rejects.toThrow("Output root must not be empty");
  });

  it("emits deterministic candidate files, preserving unrelated output", async () => {
    const outputRoot = await temporaryDirectory();
    await writeFile(join(outputRoot, "keep.txt"), "keep\n");

    await expect(
      emitGeneratedSnapshot({ outputRoot, generatedSnapshot: fixtureSnapshot() }),
    ).resolves.toMatchObject({ files: 19, snapshot: "created", meta: "created", snapshotId });

    await expect(readFile(join(outputRoot, "keep.txt"), "utf8")).resolves.toBe("keep\n");
    await expect(readFile(join(outputRoot, "v1", "meta.json"), "utf8")).resolves.toBe(
      `${JSON.stringify(fixtureArtifacts().at(-1)!.data)}\n`,
    );
    await expect(readFile(join(outputRoot, "v1", "current"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await stagingDirectories(outputRoot)).toEqual([]);
  });

  it("safely treats byte-identical runs as idempotent", async () => {
    const outputRoot = await temporaryDirectory();
    await emitGeneratedSnapshot({ outputRoot, generatedSnapshot: fixtureSnapshot() });

    await expect(
      emitGeneratedSnapshot({ outputRoot, generatedSnapshot: fixtureSnapshot() }),
    ).resolves.toMatchObject({ snapshot: "existing", meta: "existing" });
  });

  it("refuses a differing immutable snapshot and cleans staging", async () => {
    const outputRoot = await temporaryDirectory();
    await emitGeneratedSnapshot({ outputRoot, generatedSnapshot: fixtureSnapshot() });
    const artifacts = fixtureArtifacts();
    const feature = artifactOfKind(artifacts, "feature");
    artifacts[artifacts.indexOf(feature)] = {
      ...feature,
      data: { ...v1NormalizedFixture, ...envelope, query: "api.Foo", features: [] },
    };

    await expect(
      emitGeneratedSnapshot({ outputRoot, generatedSnapshot: fixtureSnapshot(artifacts) }),
    ).rejects.toThrow("Existing immutable snapshot differs");
    expect(await stagingDirectories(outputRoot)).toEqual([]);
  });

  it("refuses to replace differing candidate metadata", async () => {
    const outputRoot = await temporaryDirectory();
    await emitGeneratedSnapshot({ outputRoot, generatedSnapshot: fixtureSnapshot() });
    await writeFile(join(outputRoot, "v1", "meta.json"), '{"different":true}\n');

    await expect(
      emitGeneratedSnapshot({ outputRoot, generatedSnapshot: fixtureSnapshot() }),
    ).rejects.toThrow("candidate metadata differs");
    expect(await stagingDirectories(outputRoot)).toEqual([]);
  });

  it.each([
    [
      () => {
        const artifacts = fixtureArtifacts();
        const feature = artifactOfKind(artifacts, "feature");
        artifacts[artifacts.indexOf(feature)] = {
          ...feature,
          data: { ...v1NormalizedFixture, ...envelope, query: "api.Wrong" },
        };
        return artifacts;
      },
      "mismatched query",
    ],
    [
      () => {
        const artifacts = fixtureArtifacts();
        const index = artifactOfKind(artifacts, "index", "/api.json");
        artifacts[artifacts.indexOf(index)] = {
          ...index,
          data: indexResponseSchema.parse({ ...envelope, namespace: "css", keys: ["css.Foo"] }),
        };
        return artifacts;
      },
      "mismatched namespace",
    ],
    [
      () => {
        const artifacts = fixtureArtifacts();
        const otherSnapshot = snapshotSchema.parse({
          ...snapshot,
          id: "bcd-8.0.13-gen-0.0.1",
          generatorVersion: "0.0.1",
        });
        const meta = artifactOfKind(artifacts, "meta");
        artifacts[artifacts.indexOf(meta)] = {
          ...meta,
          data: metaResponseSchema.parse({
            contract: CONTRACT_VERSION,
            generated,
            current: otherSnapshot.id,
            snapshots: [otherSnapshot],
            namespaces: ["api"],
          }),
        };
        return artifacts;
      },
      "does not describe",
    ],
  ])(
    "rejects valid artifacts with mismatched orchestration identities",
    async (createArtifacts, message) => {
      const outputRoot = await temporaryDirectory();
      await expect(
        emitGeneratedSnapshot({
          outputRoot,
          generatedSnapshot: fixtureSnapshot(createArtifacts()),
        }),
      ).rejects.toThrow(message);
      expect(await readdir(outputRoot)).toEqual([]);
    },
  );

  it("refuses an occupied local-emission lock", async () => {
    const outputRoot = await temporaryDirectory();
    await writeFile(join(outputRoot, ".bcd-embed-emission.lock"), "another process\n");
    await expect(
      emitGeneratedSnapshot({ outputRoot, generatedSnapshot: fixtureSnapshot() }),
    ).rejects.toThrow("Another local artifact emission");
  });

  it("refuses a symlinked artifact root", async () => {
    const outputRoot = await temporaryDirectory();
    const externalRoot = join(outputRoot, "external");
    await mkdir(externalRoot);
    const sentinel = join(externalRoot, "sentinel");
    await writeFile(sentinel, "unchanged\n");
    await symlink(externalRoot, join(outputRoot, "v1"));
    await expect(
      emitGeneratedSnapshot({ outputRoot, generatedSnapshot: fixtureSnapshot() }),
    ).rejects.toThrow("artifact root");
    await expect(readFile(sentinel, "utf8")).resolves.toBe("unchanged\n");
  });

  it("removes staging when lazy generation throws mid-iteration", async () => {
    const outputRoot = await temporaryDirectory();
    const [first] = fixtureArtifacts();
    const artifacts: Iterable<GeneratedArtifact> = {
      *[Symbol.iterator]() {
        yield first!;
        throw new Error("simulated generator failure");
      },
    };

    await expect(
      emitGeneratedSnapshot({ outputRoot, generatedSnapshot: fixtureSnapshot(artifacts) }),
    ).rejects.toThrow("simulated generator failure");
    expect(await readdir(outputRoot)).toEqual([]);
  });

  it.each([
    [[...fixtureArtifacts(), fixtureArtifacts()[3]!], "collision"],
    // Deliberately malformed path is cast only to test the writer's boundary.
    [
      [{ kind: "feature", path: `v1/${snapshotId}/features/../../escape.json`, data: {} }],
      "Unsafe",
    ],
  ])("rejects unsafe input before publishing (%s)", async (artifacts, message) => {
    const outputRoot = await temporaryDirectory();
    await expect(
      emitGeneratedSnapshot({
        outputRoot,
        generatedSnapshot: fixtureSnapshot(artifacts as GeneratedArtifact[]),
      }),
    ).rejects.toThrow(message);
    expect(await readdir(outputRoot)).toEqual([]);
  });
});
