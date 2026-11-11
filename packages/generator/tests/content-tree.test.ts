import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";

import bcd from "@mdn/browser-compat-data" with { type: "json" };
import {
  blobPath,
  metaResponseSchema,
  SHARD_COUNT,
  shardSchema,
  snapshotRootPath,
  snapshotRootSchema,
} from "@bcd-embed/schema";
import { afterEach, describe, expect, it } from "vitest";

import {
  createPointerTree,
  emitContentTree,
  shardIndexOf,
  type ContentPointer,
} from "../src/content-tree.js";
import { BCD_VERSION, generateSnapshot } from "../src/index.js";

const generated = "2026-08-28T12:00:00Z";
const options = { generated, expires: "2026-11-26" };
const temporaryDirectories: string[] = [];
const snapshotId = "bcd-8.1.8-gen-0.0.0";
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

const compat = (versionAdded = "1") => ({
  source_file: "api/Test.json",
  support: { chrome: { version_added: versionAdded } },
});
/** `Crypto` and `crypto` differ only in case, as `api.Crypto` and `api.crypto` do in BCD. */
const fixture = (cryptoVersion = "1") => ({
  ...Object.fromEntries(
    Object.keys(bcd)
      .filter((key) => key !== "__meta" && key !== "browsers")
      .map((key) => [key, {}]),
  ),
  __meta: { version: BCD_VERSION, timestamp: generated },
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
  api: {
    Crypto: { __compat: compat() },
    crypto: { __compat: compat(cryptoVersion) },
    // Two keys with the same bytes in their raw files: one blob serves both.
    first: { __compat: compat() },
    second: { __compat: compat() },
  },
});

const outputRoot = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "bcd-content-tree-"));
  temporaryDirectories.push(directory);
  return directory;
};
const emit = (root: string, data: unknown = fixture()) =>
  emitContentTree({
    outputRoot: root,
    generatedSnapshot: generateSnapshot({ ...options, data }),
  });
const readJson = async (root: string, path: string): Promise<unknown> =>
  JSON.parse(await readFile(join(root, path), "utf8"));
const filesIn = async (root: string): Promise<string[]> =>
  (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1))
    .sort();

const pointersFor = (keys: Record<string, string>): ContentPointer[] => [
  { kind: "structural", path: "index.json", sha256: hash("index") },
  { kind: "structural", path: "browsers.json", sha256: hash("browsers") },
  { kind: "structural", path: "index/api.json", sha256: hash("index/api") },
  ...Object.entries(keys).flatMap(([key, content]): ContentPointer[] => [
    { kind: "feature", key, sha256: hash(`feature:${content}`) },
    { kind: "raw", key, sha256: hash(`raw:${content}`) },
  ]),
];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("shard selection", () => {
  it("uses the first byte of the SHA-256 hash of the key", () => {
    // Fixed vectors: the server must select the same shard for the same key.
    expect(shardIndexOf("api.Crypto")).toBe(239);
    expect(shardIndexOf("api.crypto")).toBe(43);
    expect(shardIndexOf("css.properties.gap")).toBe(10);
    expect(shardIndexOf("api.Element")).toBe(84);
  });
});

describe("pointer tree", () => {
  it("places every key in its shard with sorted keys and lists all shards in the root", () => {
    const keys = { "api.b": "1", "api.a": "1", "api.Crypto": "1", "api.crypto": "1" };
    const tree = createPointerTree(snapshotId, pointersFor(keys));

    expect(tree.shardFiles).toHaveLength(SHARD_COUNT);
    expect(tree.root.shards).toEqual(tree.shardFiles.map(({ sha256 }) => sha256));
    expect(Object.keys(tree.root.structural)).toEqual([
      "browsers.json",
      "index.json",
      "index/api.json",
    ]);
    for (const key of Object.keys(keys)) {
      const shard = shardSchema.parse(
        JSON.parse(Buffer.from(tree.shardFiles[shardIndexOf(key)]!.bytes).toString("utf8")),
      );
      expect(shard.pointers[key]).toEqual({
        feature: hash("feature:1"),
        raw: hash("raw:1"),
      });
    }
    expect(tree.rootFile.path).toBe(snapshotRootPath(snapshotId));
    expect(tree.rootFile.sha256).toBe(
      createHash("sha256").update(tree.rootFile.bytes).digest("hex"),
    );
  });

  it("produces the same bytes whatever order the pointers arrive in", () => {
    const pointers = pointersFor({ "api.a": "1", "api.b": "2", "api.c": "3" });
    const forward = createPointerTree(snapshotId, pointers);
    const backward = createPointerTree(snapshotId, pointers.toReversed());
    expect(backward.rootFile.sha256).toBe(forward.rootFile.sha256);
  });

  it("changes only the shard of a changed key between two snapshots", () => {
    const before = createPointerTree(
      "bcd-8.1.7-gen-0.0.0",
      pointersFor({ "api.a": "1", "api.b": "1", "css.properties.gap": "1" }),
    );
    const after = createPointerTree(
      snapshotId,
      pointersFor({ "api.a": "1", "api.b": "1", "css.properties.gap": "2" }),
    );
    const changed = before.root.shards.flatMap((sha256, index) =>
      sha256 === after.root.shards[index] ? [] : [index],
    );
    expect(changed).toEqual([shardIndexOf("css.properties.gap")]);
    expect(after.rootFile.sha256).not.toBe(before.rootFile.sha256);
  });

  it.each([
    ["a duplicate pointer", [...pointersFor({ "api.a": "1" }), pointersFor({ "api.a": "1" })[3]!]],
    ["a key without its raw pointer", pointersFor({ "api.a": "1" }).slice(0, 4)],
    ["a duplicate structural path", [...pointersFor({}), pointersFor({})[0]!]],
    ["a missing index", pointersFor({ "api.a": "1" }).slice(1)],
  ])("rejects %s", (_name, pointers) => {
    expect(() => createPointerTree(snapshotId, pointers)).toThrow();
  });
});

describe("content tree emission", () => {
  it("writes blobs, shards, a root and metadata that resolve every artifact", async () => {
    const root = await outputRoot();
    const result = await emit(root);
    const expected = [...generateSnapshot({ ...options, data: fixture() }).artifacts];

    const meta = metaResponseSchema.parse(await readJson(root, "v1/meta.json"));
    expect(meta.current).toBe(result.snapshotId);
    const snapshotRoot = snapshotRootSchema.parse(
      await readJson(root, snapshotRootPath(result.snapshotId)),
    );
    expect(snapshotRoot.snapshot).toBe(result.snapshotId);
    expect(result.rootSha256).toBe(
      createHash("sha256")
        .update(await readFile(join(root, snapshotRootPath(result.snapshotId))))
        .digest("hex"),
    );

    const prefix = `v1/${result.snapshotId}/`;
    for (const artifact of expected) {
      if (artifact.kind === "meta") continue;
      const relativePath = artifact.path.slice(prefix.length);
      let sha256: string | undefined;
      if (artifact.kind === "feature" || artifact.kind === "raw") {
        const key = relativePath.slice(relativePath.indexOf("/") + 1, -".json".length);
        const shard = shardSchema.parse(
          await readJson(root, `v1/shards/${snapshotRoot.shards[shardIndexOf(key)]}.json`),
        );
        sha256 = shard.pointers[key]?.[artifact.kind];
      } else {
        sha256 = snapshotRoot.structural[relativePath];
      }
      expect(sha256, artifact.path).toBeDefined();
      const plain = await readFile(join(root, blobPath(sha256!, "identity")));
      expect(createHash("sha256").update(plain).digest("hex")).toBe(sha256);
      expect(JSON.parse(plain.toString("utf8"))).toEqual(artifact.data);
      expect(
        brotliDecompressSync(await readFile(join(root, blobPath(sha256!, "br")))).equals(plain),
      ).toBe(true);
      expect(gunzipSync(await readFile(join(root, blobPath(sha256!, "gzip")))).equals(plain)).toBe(
        true,
      );
    }
    expect(result.artifacts).toBe(expected.length - 1);
  });

  it("keeps keys that differ only in case apart and stores shared bytes once", async () => {
    const root = await outputRoot();
    const result = await emit(root);
    const files = await filesIn(root);

    // 4 features and 4 raw files, browsers.json, index.json and index/api.json.
    expect(result.artifacts).toBe(11);
    // The four raw files have the same bytes, so they share one blob.
    expect(result.blobs).toBe(8);
    expect(files.filter((file) => file.startsWith("v1/blobs/"))).toHaveLength(result.blobs * 3);
    expect(files.some((file) => /crypto/i.test(file))).toBe(false);
    expect(files.filter((file) => !/^v1\/(blobs|shards|snapshots|_meta)\//.test(file))).toEqual([
      "v1/meta.json",
    ]);
    expect(result.filesWritten).toBe(files.length);
    expect(result.filesReused).toBe(0);
  });

  it("reuses every file when the same snapshot is emitted again", async () => {
    const root = await outputRoot();
    const first = await emit(root);
    const before = await filesIn(root);
    const second = await emit(root);

    expect(second.rootSha256).toBe(first.rootSha256);
    expect(second.filesWritten).toBe(0);
    expect(await filesIn(root)).toEqual(before);
  });

  it("refuses a blob whose bytes differ from its name", async () => {
    const root = await outputRoot();
    await emit(root);
    const blob = (await filesIn(root)).find((file) => /^v1\/blobs\/[a-f0-9]+\.json$/.test(file))!;
    await writeFile(join(root, blob), "{}\n");
    await expect(emit(root)).rejects.toThrow(/differs from the generated bytes/);
  });

  it("refuses to replace metadata that names other content", async () => {
    const root = await outputRoot();
    await emit(root);
    await expect(
      emitContentTree({
        outputRoot: root,
        generatedSnapshot: generateSnapshot({
          generated: "2026-08-29T12:00:00Z",
          expires: "2026-11-27",
          data: fixture(),
        }),
      }),
    ).rejects.toThrow(/refusing to replace/);
    expect((await filesIn(root)).some((file) => file.includes(".bcd-embed-"))).toBe(false);
  });
});
