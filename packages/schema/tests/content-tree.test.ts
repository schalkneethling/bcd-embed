import { describe, expect, it } from "vitest";
import {
  blobPath,
  SHARD_COUNT,
  shardPath,
  shardSchema,
  snapshotRootPath,
  snapshotRootSchema,
} from "../src/index.js";

const sha256 = "a".repeat(64);
const other = "b".repeat(64);
const root = () => ({
  version: 1 as const,
  snapshot: "bcd-8.1.8-gen-0.0.0",
  shards: Array.from({ length: SHARD_COUNT }, () => sha256),
  structural: { "browsers.json": sha256, "index.json": other, "index/api.json": sha256 } as Record<
    string,
    string
  >,
});

describe("content tree paths", () => {
  it("names all three encodings of a blob by the hash of its plain bytes", () => {
    expect(blobPath(sha256, "identity")).toBe(`v1/blobs/${sha256}.json`);
    expect(blobPath(sha256, "gzip")).toBe(`v1/blobs/${sha256}.json.gz`);
    expect(blobPath(sha256, "br")).toBe(`v1/blobs/${sha256}.json.br`);
  });
  it("names shards by hash and roots by snapshot", () => {
    expect(shardPath(sha256)).toBe(`v1/shards/${sha256}.json`);
    expect(snapshotRootPath("bcd-8.1.8-gen-0.0.0")).toBe("v1/snapshots/bcd-8.1.8-gen-0.0.0.json");
  });
  it.each(["../meta", "A".repeat(64), "a".repeat(63)])("rejects the unsafe hash %s", (value) => {
    expect(() => blobPath(value, "identity")).toThrow();
    expect(() => shardPath(value)).toThrow();
  });
  it("rejects an unsafe snapshot identifier", () => {
    expect(() => snapshotRootPath("../meta")).toThrow();
  });
});

describe("shard", () => {
  const pointer = { feature: sha256, raw: other };
  it("accepts sorted keys, including keys that differ only in case", () => {
    const shard = { version: 1, pointers: { "api.Crypto": pointer, "api.crypto": pointer } };
    expect(shardSchema.parse(shard)).toEqual(shard);
    expect(shardSchema.parse({ version: 1, pointers: {} })).toEqual({ version: 1, pointers: {} });
  });
  it.each([
    ["unsorted keys", { version: 1, pointers: { "api.b": pointer, "api.a": pointer } }],
    ["a pointer without its raw hash", { version: 1, pointers: { "api.a": { feature: sha256 } } }],
    ["an unsafe key", { version: 1, pointers: { "../a": pointer } }],
    ["an unknown version", { version: 2, pointers: {} }],
  ])("rejects %s", (_name, shard) => {
    expect(shardSchema.safeParse(shard).success).toBe(false);
  });
});

describe("snapshot root", () => {
  it("accepts 256 shard hashes and sorted structural pointers", () => {
    expect(snapshotRootSchema.parse(root())).toEqual(root());
  });
  it.each([
    ["a missing shard", (value: ReturnType<typeof root>) => value.shards.pop()],
    [
      "a missing index",
      (value: ReturnType<typeof root>) => {
        delete value.structural["index.json"];
      },
    ],
    [
      "a per-feature path among the structural pointers",
      (value: ReturnType<typeof root>) => {
        value.structural["features/api.Foo.json"] = sha256;
      },
    ],
    [
      "unsorted structural pointers",
      (value: ReturnType<typeof root>) => {
        value.structural = { "index.json": sha256, "browsers.json": sha256 };
      },
    ],
  ])("rejects %s", (_name, change) => {
    const value = root();
    change(value);
    expect(snapshotRootSchema.safeParse(value).success).toBe(false);
  });
});
