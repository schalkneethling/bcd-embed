import { describe, expect, it } from "vitest";

import { normalizeVersion } from "../src/version.js";

describe("normalizeVersion", () => {
  it.each([
    ["46", { value: "46", approximate: false, preview: false }],
    ["≤15", { value: "15", approximate: true, preview: false }],
    ["preview", { value: "preview", approximate: false, preview: true }],
    [false, { value: false, approximate: false, preview: false }],
    [null, { value: null, approximate: false, preview: false }],
  ] as const)("normalizes %s without discarding meaning", (raw, expected) => {
    expect(normalizeVersion(raw)).toEqual(expected);
  });

  it("rejects an empty or bare approximate version", () => {
    expect(() => normalizeVersion("")).toThrow("non-empty");
    expect(() => normalizeVersion("≤")).toThrow("non-empty");
  });
});
