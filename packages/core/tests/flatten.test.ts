import bcd from "@mdn/browser-compat-data" with { type: "json" };
import type { Identifier } from "@mdn/browser-compat-data/types";
import { describe, expect, it } from "vitest";

import { flattenFeatureSubtree } from "../src/flatten.js";

describe("flattenFeatureSubtree", () => {
  it("emits an addressable parent before children in BCD document order", () => {
    const subtree = {
      __compat: { description: "root" },
      grouping: {
        child: { __compat: { description: "child" } },
      },
      sibling: { __compat: { description: "sibling" } },
    } as unknown as Identifier;

    expect(flattenFeatureSubtree("api.Example", subtree)).toEqual([
      expect.objectContaining({ key: "api.Example", name: "Example", depth: 0 }),
      expect.objectContaining({ key: "api.Example.grouping.child", name: "child", depth: 2 }),
      expect.objectContaining({ key: "api.Example.sibling", name: "sibling", depth: 1 }),
    ]);
  });

  it("flattens all 51 addressable Array nodes without synthetic keys", () => {
    const records = flattenFeatureSubtree(
      "javascript.builtins.Array",
      bcd.javascript.builtins!.Array!,
    );

    expect(records).toHaveLength(51);
    expect(records.slice(0, 6).map(({ key }) => key)).toEqual([
      "javascript.builtins.Array",
      "javascript.builtins.Array.@@iterator",
      "javascript.builtins.Array.@@species",
      "javascript.builtins.Array.@@unscopables",
      "javascript.builtins.Array.Array",
      "javascript.builtins.Array.at",
    ]);
    expect(records.find(({ key }) => key.endsWith(".fromAsync"))?.depth).toBe(1);
    expect(records.some(({ key }) => key.includes("async_iterable"))).toBe(false);
  });

  it("rejects non-addressable roots and malformed child nodes", () => {
    expect(() => flattenFeatureSubtree("api.grouping", { child: {} } as Identifier)).toThrow(
      "must contain __compat",
    );
    expect(() =>
      flattenFeatureSubtree("api.Example", {
        __compat: {},
        child: "invalid",
      } as unknown as Identifier),
    ).toThrow("api.Example.child");
  });
});
