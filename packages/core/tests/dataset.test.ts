import bcd from "@mdn/browser-compat-data" with { type: "json" };
import type { Identifier } from "@mdn/browser-compat-data/types";
import { expect, it } from "vitest";

import { featureSchema, supportTargetSchema } from "../../schema/src/index.js";
import { normalizeFeatureSubtree } from "../src/index.js";

it("normalizes every feature in the pinned BCD dataset without losing support targets", () => {
  let count = 0;
  const visit = (key: string, node: Identifier) => {
    if (node.__compat !== undefined) {
      // Normalize each record once. Subtree composition has separate tests;
      // repeated normalization of overlapping descendants would add avoidable work.
      const normalized = normalizeFeatureSubtree({
        key,
        subtree: { __compat: node.__compat } as Identifier,
        browsers: bcd.browsers,
      });
      const feature = normalized.features[0];
      expect(normalized.features, key).toHaveLength(1);
      expect(featureSchema.safeParse(feature).success, key).toBe(true);
      expect(Object.keys(feature!.support), key).toEqual(Object.keys(node.__compat.support));
      expect(Object.keys(normalized.browsers), key).toEqual(Object.keys(node.__compat.support));
      for (const target of Object.values(normalized.browsers)) {
        expect(supportTargetSchema.safeParse(target).success, key).toBe(true);
      }
      count += 1;
    }
    for (const [segment, child] of Object.entries(node)) {
      if (segment !== "__compat") visit(`${key}.${segment}`, child as Identifier);
    }
  };

  for (const [namespace, tree] of Object.entries(bcd)) {
    if (namespace !== "__meta" && namespace !== "browsers") {
      visit(namespace, tree as Identifier);
    }
  }
  expect(count).toBe(20_359);
}, 30_000);
