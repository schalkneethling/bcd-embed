import { describe, expect, it } from "vitest";

import { contrastRatio, parseRgb } from "./contrast.js";

describe("contrastRatio", () => {
  it("gives 21 for black on white, in either order, and 1 for one colour", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5);
    expect(contrastRatio([18, 18, 18], [18, 18, 18])).toBe(1);
  });

  // #767676 on white is the lightest grey that reaches 4.5:1, a value WCAG practice documents as
  // 4.54:1. A formula that skipped the linearisation would give a very different number.
  it("matches the known ratio of #767676 on white", () => {
    expect(contrastRatio([118, 118, 118], [255, 255, 255])).toBeCloseTo(4.54, 2);
  });
});

describe("parseRgb", () => {
  it("reads rgb() and an opaque rgba()", () => {
    expect(parseRgb("rgb(18, 18, 18)")).toEqual([18, 18, 18]);
    expect(parseRgb("rgba(1, 2, 3, 1)")).toEqual([1, 2, 3]);
    expect(parseRgb("rgb(1 2 3 / 100%)")).toEqual([1, 2, 3]);
  });

  it("refuses a colour with transparency, and any other colour syntax", () => {
    expect(() => parseRgb("rgba(0, 0, 0, 0.5)")).toThrow(/opaque/);
    expect(() => parseRgb("rgba(0, 0, 0, 0)")).toThrow(/opaque/);
    expect(() => parseRgb("color(srgb 1 1 1)")).toThrow(/rgb\(\)/);
  });
});
