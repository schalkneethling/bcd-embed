import bcd from "@mdn/browser-compat-data" with { type: "json" };
import type { Identifier } from "@mdn/browser-compat-data/types";
import { describe, expect, it } from "vitest";

import { featureSchema, supportTargetSchema } from "../../schema/src/index.js";
import { BcdNormalizationError, normalizeFeatureSubtree } from "../src/index.js";

const subtreeAt = (path: string): Identifier =>
  path
    .split(".")
    .reduce<Identifier>((value, segment) => value[segment]!, bcd as unknown as Identifier);

const rawFeatureInventory = (key: string, subtree: Identifier) => {
  const inventory: Array<{ key: string; targets: string[] }> = [];
  const visit = (nodeKey: string, node: Identifier) => {
    if (node.__compat !== undefined) {
      inventory.push({ key: nodeKey, targets: Object.keys(node.__compat.support) });
    }
    for (const [segment, child] of Object.entries(node)) {
      if (segment !== "__compat") visit(`${nodeKey}.${segment}`, child as Identifier);
    }
  };
  visit(key, subtree);
  return inventory;
};

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

    const rawInventory = rawFeatureInventory(
      "javascript.builtins.Array",
      bcd.javascript.builtins!.Array!,
    );
    expect(normalized.features.map(({ key }) => key)).toEqual(rawInventory.map(({ key }) => key));
    normalized.features.forEach((feature, index) => {
      expect(Object.keys(feature.support)).toEqual(rawInventory[index]!.targets);
    });
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

    const rawMissingStatus = normalizeFeatureSubtree({
      key: "webextensions.api.action",
      subtree: subtreeAt("webextensions.api.action"),
      browsers: bcd.browsers,
    });
    expect(rawMissingStatus.features[0]!.status).toBeNull();
  });

  it("composes exact source-backed support fields across the pinned fixture paths", () => {
    const normalize = (key: string) =>
      normalizeFeatureSubtree({ key, subtree: subtreeAt(key), browsers: bcd.browsers })
        .features[0]!;

    const fitContent = normalize("css.properties.width.fit-content").support.chrome!;
    expect(fitContent.summary).toMatchObject({ state: "supported", versionAdded: "46" });
    expect(fitContent.branches[0]!.statements[0]).toMatchObject({
      releaseDate: "2015-10-13",
    });
    expect(normalize("api.AudioTrackList").support.chrome?.summary).toMatchObject({
      state: "supported",
      behindFlag: true,
    });
    expect(normalize("api.Attr.localName").support.opera?.summary).toMatchObject({
      versionAdded: "12.1",
    });
    expect(normalize("api.Attr.localName").support.opera?.branches[0]!.statements[0]).toMatchObject(
      { versionAddedIsApproximate: true },
    );
    expect(
      normalize("api.AbortController.abort").support.nodejs?.branches[0]!.statements.map(
        ({ versionAdded }) => versionAdded,
      ),
    ).toEqual(["17.2.0", "17.0.0", "16.14.0", "14.17.0"]);
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
