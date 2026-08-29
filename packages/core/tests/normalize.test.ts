import bcd from "@mdn/browser-compat-data" with { type: "json" };
import type { Identifier } from "@mdn/browser-compat-data/types";
import { featureSchema, supportTargetSchema } from "@bcd-embed/schema";
import { describe, expect, it } from "vitest";

import { BcdNormalizationError, normalizeFeatureSubtree } from "../src/index.js";

describe("normalizeFeatureSubtree", () => {
  it("composes the full real Array subtree into contracted features and target metadata", () => {
    const normalized = normalizeFeatureSubtree({
      key: "javascript.builtins.Array",
      subtree: bcd.javascript.builtins!.Array!,
      browsers: bcd.browsers,
    });

    expect(normalized.features).toHaveLength(51);
    expect(normalized.features.slice(0, 3).map(({ key, depth }) => [key, depth])).toEqual([
      ["javascript.builtins.Array", 0],
      ["javascript.builtins.Array.@@iterator", 1],
      ["javascript.builtins.Array.@@species", 1],
    ]);
    expect(normalized.features.every((feature) => featureSchema.safeParse(feature).success)).toBe(
      true,
    );
    expect(
      Object.values(normalized.browsers).every(
        (target) => supportTargetSchema.safeParse(target).success,
      ),
    ).toBe(true);
    const referencedTargets = new Set(
      normalized.features.flatMap((feature) => Object.keys(feature.support)),
    );
    expect(new Set(Object.keys(normalized.browsers))).toEqual(referencedTargets);
  });

  it("normalizes feature metadata without inventing an omitted status block", () => {
    const subtree = {
      __compat: {
        description: "An example feature.",
        mdn_url: "https://developer.mozilla.org/docs/Web/API/Example",
        spec_url: "https://example.com/spec",
        source_file: "api/Example.json",
        support: { chrome: { version_added: "46" } },
      },
    } as Identifier;
    const normalized = normalizeFeatureSubtree({
      key: "api.Example",
      subtree,
      browsers: bcd.browsers,
    });

    expect(normalized.features[0]).toMatchObject({
      key: "api.Example",
      name: "Example",
      description: "An example feature.",
      mdnUrl: "https://developer.mozilla.org/docs/Web/API/Example",
      specUrls: ["https://example.com/spec"],
      status: null,
      tags: [],
    });
    expect(normalized.browsers.chrome).toEqual({
      name: "Chrome",
      type: "desktop",
      previewName: "Canary",
    });
  });

  it("reports the exact failing key for malformed source data", () => {
    const subtree = {
      __compat: {
        source_file: "api/Example.json",
        support: { missing_browser: { version_added: "1" } },
      },
    } as unknown as Identifier;

    expect(() =>
      normalizeFeatureSubtree({ key: "api.Example", subtree, browsers: bcd.browsers }),
    ).toThrow(BcdNormalizationError);
    try {
      normalizeFeatureSubtree({ key: "api.Example", subtree, browsers: bcd.browsers });
    } catch (error) {
      expect(error).toMatchObject({ key: "api.Example" });
    }
  });
});
