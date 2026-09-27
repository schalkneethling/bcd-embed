import bcd from "@mdn/browser-compat-data" with { type: "json" };
import { describe, expect, it } from "vitest";
import {
  generateSnapshot,
  BcdInputError,
  validateBcdInput,
  validateRawArtifact,
  GENERATOR_VERSION,
} from "../src/index.js";

const generated = "2026-08-28T12:00:00Z";
const options = { generated, expires: "2026-11-26" };
const compat = () => ({
  source_file: "api/Test.json",
  support: { chrome: { version_added: "1" } },
});
const fixture = () => ({
  ...Object.fromEntries(
    Object.keys(bcd)
      .filter((key) => key !== "__meta" && key !== "browsers")
      .map((key) => [key, {}]),
  ),
  __meta: { version: "8.0.13", timestamp: generated },
  browsers: {
    chrome: {
      name: "Chrome",
      type: "desktop",
      accepts_flags: true,
      accepts_webextensions: true,
      releases: {
        "1": { status: "retired", release_date: "2008-12-11" },
        "2": { status: "current" },
      },
    },
  },
  api: {
    group: { parent: { __compat: compat(), child: { __compat: compat() } }, empty: {} },
    second: { __compat: compat() },
  },
});

describe("generation foundation", () => {
  it("discovers only independently addressable nodes in document order", () => {
    const data = fixture();
    const before = JSON.stringify(data);
    const result = generateSnapshot({ ...options, data });
    const artifacts = [...result.artifacts];
    expect(result.snapshot.id).toBe(`bcd-8.0.13-gen-${GENERATOR_VERSION}`);
    expect(result.namespaces).toEqual(["api"]);
    expect(artifacts.map(({ kind }) => kind)).toEqual([
      "feature",
      "raw",
      "feature",
      "raw",
      "feature",
      "raw",
      "browsers",
      "index",
      "index",
      "meta",
    ]);
    const features = artifacts.filter((artifact) => artifact.kind === "feature");
    expect(features.map(({ data: response }) => response.query)).toEqual([
      "api.group.parent",
      "api.group.parent.child",
      "api.second",
    ]);
    expect(features[0]!.data.features.map(({ key, depth }) => [key, depth])).toEqual([
      ["api.group.parent", 0],
      ["api.group.parent.child", 1],
    ]);
    const raw = artifacts.find((artifact) => artifact.kind === "raw");
    expect(raw!.data).toBe(data.api.group.parent);
    expect(raw!.path).toBe(`v1/${result.snapshot.id}/raw/api.group.parent.json`);
    const indexes = artifacts.filter((artifact) => artifact.kind === "index");
    expect(indexes.map(({ data: index }) => index.namespace)).toEqual([null, "api"]);
    expect(indexes[0]!.data.keys).toEqual(features.map(({ data: response }) => response.query));
    const browsers = artifacts.find((artifact) => artifact.kind === "browsers")!;
    expect(browsers.data.browsers.chrome!.releases).toEqual([
      { version: "1", releaseDate: "2008-12-11", status: "retired" },
      { version: "2", releaseDate: null, status: "current" },
    ]);
    expect(artifacts.at(-1)).toMatchObject({
      kind: "meta",
      path: "v1/meta.json",
      data: { current: result.snapshot.id, namespaces: ["api"], snapshots: [result.snapshot] },
    });
    expect(JSON.stringify(data)).toBe(before);
  });

  it("is deterministic with caller-supplied time and single-use iteration", () => {
    expect([...generateSnapshot({ ...options, data: fixture() }).artifacts]).toEqual([
      ...generateSnapshot({ ...options, data: fixture() }).artifacts,
    ]);
    const generation = generateSnapshot({ ...options, data: fixture() });
    const iterator = generation.artifacts[Symbol.iterator]();
    expect(iterator.next().value?.kind).toBe("feature");
    expect(() => generation.artifacts[Symbol.iterator]()).toThrow("single-use");
  });

  it.each(["2026-08-27", "2026-08-28"])(
    "rejects expiry %s not later than generation",
    (expires) => {
      expect(() => generateSnapshot({ ...options, expires, data: fixture() })).toThrow("Expiry");
    },
  );

  it("rejects malformed timestamps and retention dates", () => {
    expect(() => generateSnapshot({ ...options, generated: "today", data: fixture() })).toThrow();
    expect(() =>
      generateSnapshot({ ...options, expires: "2026-02-30", data: fixture() }),
    ).toThrow();
  });

  it("rejects empty feature datasets", () => {
    const data = fixture();
    data.api = {} as typeof data.api;
    expect(() => generateSnapshot({ ...options, data })).toThrow("no addressable");
  });

  it("throws with feature path and cause when upstream-valid output cannot conform", () => {
    const data = fixture();
    Object.assign(data.api.group.parent.__compat.support.chrome, { notes: "" });
    const iterator = generateSnapshot({ ...options, data }).artifacts[Symbol.iterator]();
    try {
      iterator.next();
      throw new Error("Expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(BcdInputError);
      expect((error as Error).message).toContain("features/api.group.parent.json");
      expect((error as Error).cause).toBeInstanceOf(Error);
    }
  });
});

describe("published BCD input schema", () => {
  it("matches upstream Unicode URI policy while rejecting malformed URIs", () => {
    const data = fixture();
    Object.assign(data.api.group.parent.__compat, {
      spec_url: "https://dom.spec.whatwg.org/#ref-for-dom-abortcontroller-abortcontroller①",
    });
    expect(() => validateBcdInput(data)).not.toThrow();
    Object.assign(data.api.group.parent.__compat, { spec_url: "not a URI" });
    expect(() => validateBcdInput(data)).toThrow("uri");
  });
  it("accepts the actual pinned aggregate without adapting or mutating it", () => {
    expect(() => validateBcdInput(bcd)).not.toThrow();
  });

  it("rejects mismatched versions even when the structural schema passes", () => {
    const data = fixture();
    data.__meta.version = "8.0.14";
    expect(() => validateBcdInput(data)).toThrow("Expected pinned BCD");
  });

  it.each([[], null, "mirror", { version_added: 42 }, { version_added: null }])(
    "rejects malformed published support %j",
    (support) => {
      const data = fixture();
      Object.assign(data.api.group.parent.__compat.support, { chrome: support });
      expect(() => generateSnapshot({ ...options, data })).toThrow(BcdInputError);
    },
  );

  it("requires aggregate metadata and generated source_file; raw must be addressable", () => {
    expect(() => validateBcdInput({ api: {} })).toThrow();
    expect(() => validateRawArtifact({ __compat: { support: {} } })).toThrow("schema");
    expect(() => validateRawArtifact({ group: { __compat: compat() } })).toThrow("addressable");
  });

  it("rejects malformed feature-node keys before constructing paths", () => {
    const data = fixture();
    Object.assign(data.api, { "../escape": { __compat: compat() } });
    expect(() => generateSnapshot({ ...options, data })).toThrow();
  });
});
