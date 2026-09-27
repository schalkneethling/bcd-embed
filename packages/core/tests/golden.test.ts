import type { Browsers } from "@mdn/browser-compat-data/types";
import { describe, expect, it } from "vitest";

import { featureSchema, supportTargetSchema } from "../../schema/src/index.js";
import { normalizeFeatureSubtree } from "../src/index.js";
import { goldenBrowsers, goldenExpected, goldenKey, goldenRawSubtree } from "./fixtures/golden.js";

describe("normalizeFeatureSubtree golden output", () => {
  it("matches the complete independently authored normalized subtree", () => {
    const normalized = normalizeFeatureSubtree({
      key: goldenKey,
      subtree: goldenRawSubtree,
      browsers: goldenBrowsers as unknown as Browsers,
    });

    expect(normalized).toEqual(goldenExpected);
  });

  it("keeps every golden feature and target conformant to the published schemas", () => {
    const normalized = normalizeFeatureSubtree({
      key: goldenKey,
      subtree: goldenRawSubtree,
      browsers: goldenBrowsers as unknown as Browsers,
    });

    for (const feature of normalized.features) {
      expect(featureSchema.safeParse(feature).success, feature.key).toBe(true);
    }
    for (const [target, metadata] of Object.entries(normalized.browsers)) {
      expect(supportTargetSchema.safeParse(metadata).success, target).toBe(true);
    }
  });
});
