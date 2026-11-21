// The base stylesheet makes no query container and uses no container query length unit (issue
// #201). A query container applies style containment, and with it Chromium 159 slowed down with the
// square of the number of <summary> elements in the table: 2,000 rows took about 10 seconds to lay
// out instead of 0.6 (Document 3 section 5). The units are flagged by
// `stylelint-plugin-use-baseline` as well. e2e/layout.e2e.ts checks the computed styles.
import { describe, expect, it } from "vitest";

import { readStylesheets } from "./stylesheets.js";

/** The container query length units of CSS Containment Module Level 3, section 6. */
const CONTAINER_UNIT = /\d(?:cqw|cqh|cqi|cqb|cqmin|cqmax)\b/i;

/** Declarations that make a query container or apply style containment. */
const containsStyle = (prop: string, value: string): boolean =>
  /^container(?:-type)?$/.test(prop) || (prop === "contain" && /style|strict|content/.test(value));

describe("the base stylesheet", () => {
  const sheets = readStylesheets();

  it("makes no query container and applies no style containment", () => {
    const found: string[] = [];
    for (const { name, root } of sheets) {
      root.walkDecls((declaration) => {
        if (containsStyle(declaration.prop, declaration.value))
          found.push(`${name}: ${declaration.toString()}`);
      });
      root.walkAtRules("container", (rule) => {
        found.push(`${name}: @container ${rule.params}`);
      });
    }
    expect(found).toEqual([]);
  });

  it("uses no container query length unit", () => {
    const found: string[] = [];
    for (const { name, root } of sheets) {
      root.walkDecls((declaration) => {
        if (CONTAINER_UNIT.test(declaration.value))
          found.push(`${name}: ${declaration.toString()}`);
      });
    }
    expect(found).toEqual([]);
  });

  it("would catch each kind of declaration it forbids", () => {
    expect(containsStyle("container-type", "inline-size")).toBe(true);
    expect(containsStyle("container", "bcd / inline-size")).toBe(true);
    expect(containsStyle("contain", "style")).toBe(true);
    expect(containsStyle("contain", "content")).toBe(true);
    expect(containsStyle("contain", "inline-size")).toBe(false);
    expect(CONTAINER_UNIT.test("calc(100cqi - 1rem)")).toBe(true);
    expect(CONTAINER_UNIT.test("1em")).toBe(false);
  });
});
