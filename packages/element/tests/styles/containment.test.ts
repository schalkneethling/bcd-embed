// The base stylesheet applies no style containment and uses no container query length unit (issue
// #201).
//
// Why the ban exists: a query container (`container-type: inline-size` or `size`) applies style
// containment, as do `contain: style`, `content`, and `strict`. With a query container or
// `contain: style` on the table or an ancestor, Chromium 159 laid out the table's <summary>
// elements, which are display: list-item, in time that grows with the square of their number: 51
// ms became 249 ms at 314 rows, the largest real table, and a synthetic 2,000-row table took about
// 10 seconds instead of 0.6. `content-visibility: auto` and `hidden` also apply style containment
// (CSS Containment Module Level 2, `content-visibility`), so they are banned too, although a timing of `auto`
// was inconclusive, because it defers the layout of its contents. Document 3 section 5 ("What #201 built and found") has the
// measurements and the bare page that reproduces them. Before adding a container query, re-run that
// page in the current Chromium; if it lays out in linear time, this ban can go.
//
// `container-type: normal` and `content-visibility: visible` make no container and apply no
// containment, so they are allowed. The units are flagged by `stylelint-plugin-use-baseline` as
// well. e2e/layout.e2e.ts checks the computed styles around the rendered table.
import { describe, expect, it } from "vitest";

import { readStylesheets } from "./stylesheets.js";

/** The container query length units of CSS Containment Module Level 3, section 6. */
const CONTAINER_UNIT = /\d(?:cqw|cqh|cqi|cqb|cqmin|cqmax)\b/i;

/** Whether a declaration applies style containment, directly or by making a query container. */
const containsStyle = (prop: string, value: string): boolean => {
  const property = prop.toLowerCase();
  const words = value.toLowerCase();
  if (property === "container-type") return !/^\s*normal\s*$/.test(words);
  // `container: <name> / <type>`; with no type, or the type `normal`, it makes no query container.
  if (property === "container") {
    const type = words.split("/")[1]?.trim();
    return type !== undefined && type !== "normal";
  }
  if (property === "contain") return /\b(?:style|content|strict)\b/.test(words);
  if (property === "content-visibility") return /\b(?:auto|hidden)\b/.test(words);
  return false;
};

describe("the base stylesheet", () => {
  const sheets = readStylesheets();

  it("applies no style containment and makes no query container", () => {
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

  it("would catch each kind of declaration it forbids, and allow the harmless ones", () => {
    expect(containsStyle("container-type", "inline-size")).toBe(true);
    expect(containsStyle("container-type", "size")).toBe(true);
    expect(containsStyle("container", "bcd / inline-size")).toBe(true);
    expect(containsStyle("contain", "style")).toBe(true);
    expect(containsStyle("contain", "content")).toBe(true);
    expect(containsStyle("contain", "strict")).toBe(true);
    expect(containsStyle("content-visibility", "auto")).toBe(true);
    expect(containsStyle("content-visibility", "hidden")).toBe(true);

    expect(containsStyle("container-type", "normal")).toBe(false);
    expect(containsStyle("container", "bcd")).toBe(false);
    expect(containsStyle("container", "bcd / normal")).toBe(false);
    expect(containsStyle("contain", "inline-size")).toBe(false);
    expect(containsStyle("content-visibility", "visible")).toBe(false);

    expect(CONTAINER_UNIT.test("calc(100cqi - 1rem)")).toBe(true);
    expect(CONTAINER_UNIT.test("1em")).toBe(false);
  });
});
