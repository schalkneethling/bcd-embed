import { describe, expect, it } from "vitest";

import type { TableCell } from "../src/model/table-model.js";
import { ICON_PATHS, statusIcon } from "../src/render/status.js";
import type { StatusIcon } from "../src/render/status.js";
import { CODE_VALUES } from "../src/render/table.js";
import { en } from "../src/strings/en.js";
import { readStylesheet } from "./styles/stylesheets.js";

// The parts of the renderer that need no document. The markup itself is checked in a browser, in
// `browser/bcd-compat-table.browser.test.ts`.

type CellStatus = Pick<TableCell, "state" | "behindFlag" | "partialImplementation">;

const status = (state: CellStatus["state"], modifiers: Partial<CellStatus> = {}): CellStatus => ({
  state,
  behindFlag: false,
  partialImplementation: false,
  ...modifiers,
});

describe("statusIcon", () => {
  it.for([
    ["supported", status("supported"), "supported"],
    ["supported behind a flag", status("supported", { behindFlag: true }), "flagged"],
    ["partial", status("partial", { partialImplementation: true }), "partial"],
    [
      "partial behind a flag",
      status("partial", { partialImplementation: true, behindFlag: true }),
      "flagged",
    ],
    ["a full preview", status("preview"), "preview"],
    ["a preview behind a flag", status("preview", { behindFlag: true }), "flagged"],
    ["a partial preview", status("preview", { partialImplementation: true }), "partial"],
    [
      "a partial preview behind a flag",
      status("preview", { partialImplementation: true, behindFlag: true }),
      "partial",
    ],
    ["unsupported", status("unsupported"), "unsupported"],
    ["unknown", status("unknown"), "unknown"],
    ["no data", status("no-data"), "no-data"],
  ] as const)("shows %s with its icon", ([, cell, icon]) => {
    expect(statusIcon(cell)).toBe(icon);
  });

  it("gives every support state an icon of its own, and one more for support behind a flag", () => {
    const states = [
      "supported",
      "partial",
      "preview",
      "unsupported",
      "unknown",
      "no-data",
    ] as const;
    const icons = new Set<StatusIcon>(states.map((state) => statusIcon(status(state))));

    expect(icons.size).toBe(states.length);
    expect(icons.has("flagged")).toBe(false);
    expect(statusIcon(status("supported", { behindFlag: true }))).toBe("flagged");
  });
});

describe("the icon set", () => {
  it("draws no two icons with the same path", () => {
    const paths = Object.values(ICON_PATHS);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.length).toBe(7);
  });

  it("gives each icon a colour rule in tokens.css", () => {
    const selectors = new Set<string>();
    readStylesheet("tokens.css").root.walkRules((rule) => {
      for (const selector of rule.selectors) selectors.add(selector);
    });

    expect([...selectors].toSorted()).toEqual(
      Object.keys(ICON_PATHS)
        .map((icon) => `.bcd-icon-${icon}`)
        .toSorted(),
    );
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
