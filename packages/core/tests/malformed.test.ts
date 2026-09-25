import bcd from "@mdn/browser-compat-data" with { type: "json" };
import type { Identifier } from "@mdn/browser-compat-data/types";
import { describe, expect, it } from "vitest";

import { BcdNormalizationError, normalizeFeatureSubtree } from "../src/index.js";

describe("malformed BCD boundaries", () => {
  it.each([
    ["empty support array", []],
    ["null support entry", null],
    ["numeric version", { version_added: 42 }],
    ["boolean true version", { version_added: true }],
    ["missing version", { notes: "Missing required version_added." }],
  ])("rejects %s with the failing feature key", (_label, support) => {
    const subtree = {
      __compat: {
        source_file: "api/Example.json",
        support: { chrome: { version_added: "1" } },
      },
      child: {
        __compat: { source_file: "api/Example.json", support: { chrome: support } },
      },
    } as unknown as Identifier;

    expect(() =>
      normalizeFeatureSubtree({ key: "api.Example", subtree, browsers: bcd.browsers }),
    ).toThrowError(
      expect.objectContaining({
        name: "BcdNormalizationError",
        key: "api.Example.child",
        cause: expect.any(Error),
      }),
    );
  });

  it("rejects an entirely non-addressable subtree", () => {
    expect(() =>
      normalizeFeatureSubtree({
        key: "api.namespace",
        subtree: { child: {} } as Identifier,
        browsers: bcd.browsers,
      }),
    ).toThrow(BcdNormalizationError);
  });
});
