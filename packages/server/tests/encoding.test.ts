import { describe, expect, it } from "vitest";
import { negotiateEncoding, representationPath } from "../src/encoding.js";

describe("representation negotiation", () => {
  it.each([
    [null, "identity"],
    ["", "identity"],
    ["br, gzip", "br"],
    ["gzip", "gzip"],
    ["BR;q=0.5, gzip;q=0.9", "gzip"],
    ["br;q=0, gzip;q=0", "identity"],
    ["*", "br"],
    ["*;q=0", null],
    ["*;q=0, identity;q=1", "identity"],
    ["br;q=0, *;q=1", "gzip"],
    ["identity;q=1, br;q=0.5", "identity"],
    ["compress, identity;q=0", null],
    ["br;q=1.001", null],
    ["br;q=.5", null],
    ["br;q=0.1234", null],
    ["br;level=4", null],
    ["br;q=0, br;q=1", null],
    [", gzip, ,", "gzip"],
  ])("selects %s as %s", (header, expected) => {
    expect(negotiateEncoding(header)).toBe(expected);
  });

  it("constructs only internal representation paths", () => {
    expect(representationPath("v1/snapshot/index.json", "gzip")).toBe("v1/snapshot/index.json.gz");
    expect(representationPath("v1/meta.json", "br", "a".repeat(64))).toBe(
      `v1/_meta/${"a".repeat(64)}.json.br`,
    );
    expect(() => representationPath("v1/meta.json", "br", "../private")).toThrow();
  });
});
