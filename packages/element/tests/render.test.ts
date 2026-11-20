import { describe, expect, it } from "vitest";

import type { TableCell } from "../src/model/table-model.js";
import { statusGlyph } from "../src/render/status.js";
import { CODE_VALUES } from "../src/render/table.js";
import { en } from "../src/strings/en.js";

// The parts of the renderer that need no document. The markup itself is checked in a browser, in
// `browser/bcd-compat-table.browser.test.ts`.

type CellStatus = Pick<TableCell, "state" | "behindFlag" | "partialImplementation">;

const status = (state: CellStatus["state"], modifiers: Partial<CellStatus> = {}): CellStatus => ({
  state,
  behindFlag: false,
  partialImplementation: false,
  ...modifiers,
});

describe("statusGlyph", () => {
  it.for([
    ["supported", status("supported"), "✓"],
    ["supported behind a flag", status("supported", { behindFlag: true }), "⚑"],
    ["partial", status("partial", { partialImplementation: true }), "◐"],
    [
      "partial behind a flag",
      status("partial", { partialImplementation: true, behindFlag: true }),
      "⚑",
    ],
    ["a full preview", status("preview"), "✓"],
    ["a preview behind a flag", status("preview", { behindFlag: true }), "⚑"],
    ["a partial preview", status("preview", { partialImplementation: true }), "◐"],
    [
      "a partial preview behind a flag",
      status("preview", { partialImplementation: true, behindFlag: true }),
      "◐",
    ],
    ["unsupported", status("unsupported"), "✕"],
    ["unknown", status("unknown"), "?"],
    ["no data", status("no-data"), "—"],
  ] as const)("shows %s as its Phase 1 glyph", ([, cell, glyph]) => {
    expect(statusGlyph(cell)).toBe(glyph);
  });
});

describe("the values a history line marks up as code", () => {
  it("number at most two in any message, which the bound on the rendered tree relies on", () => {
    const counts = Object.entries(en).map(([id, text]) => ({
      id,
      count: [...text.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].filter(([, name = ""]) =>
        CODE_VALUES.has(name),
      ).length,
    }));

    expect(Math.max(...counts.map(({ count }) => count))).toBe(2);
    expect(counts.filter(({ count }) => count > 2)).toEqual([]);
  });
});
