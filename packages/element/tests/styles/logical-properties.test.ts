// Every property and value the base stylesheet sets is logical, not physical (Document 3 section 3),
// so the table lays out correctly in right-to-left and vertical writing modes. No installed
// Stylelint rule checks this: the root configuration has `stylelint-config-standard` and
// `stylelint-plugin-use-baseline` only. So this test scans each declaration in `src/styles`.
import type { Declaration } from "postcss";
import { describe, expect, it } from "vitest";

import { readStylesheets } from "./stylesheets.js";

/** Physical properties, each with the logical property to use instead. */
const PHYSICAL_PROPERTIES: Readonly<Record<string, string>> = {
  left: "inset-inline-start",
  right: "inset-inline-end",
  top: "inset-block-start",
  bottom: "inset-block-end",
  width: "inline-size",
  height: "block-size",
  "min-width": "min-inline-size",
  "min-height": "min-block-size",
  "max-width": "max-inline-size",
  "max-height": "max-block-size",
  "overflow-x": "overflow-inline",
  "overflow-y": "overflow-block",
};

/**
 * The `-top`, `-right`, `-bottom`, and `-left` forms of `margin`, `padding`, and `border`, and
 * every property that starts with one, such as `border-left-color` or `border-top-left-radius`.
 */
const PHYSICAL_SIDE = /^(?:margin|padding|border)-(?:top|right|bottom|left)(?:-|$)/;

/** Properties whose `left` or `right` value names a physical side. */
const PHYSICAL_SIDE_VALUES = new Set(["text-align", "float", "clear"]);

/**
 * Shorthands whose second, third, and fourth values follow the physical order top, right,
 * bottom, left. One value is the same on every side, so only more than one is physical.
 */
const PHYSICAL_ORDER_SHORTHANDS = new Set([
  "margin",
  "padding",
  "inset",
  "border-width",
  "border-style",
  "border-color",
  "border-radius",
  "scroll-margin",
  "scroll-padding",
]);

/**
 * Exceptions, keyed by `property: value` as the stylesheet writes it, each with a one-line reason.
 */
const ALLOWLIST: Readonly<Record<string, string>> = {
  "overflow-x: auto":
    "A fallback before overflow-inline, so the scroll region still scrolls in an engine below the floor (Safari 18 drops overflow-inline).",
};

/** The number of top-level values in a declaration, ignoring spaces inside functions. */
const countValues = (value: string): number => {
  let depth = 0;
  let count = 0;
  let inValue = false;
  for (const character of value) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    const separates = depth === 0 && /\s/.test(character);
    if (!separates && !inValue) count += 1;
    inValue = !separates;
  }
  return count;
};

/** Why a declaration is physical, or null when it is logical. */
const physicalReason = ({ prop, value }: Declaration): string | null => {
  const property = prop.toLowerCase();
  const logical = PHYSICAL_PROPERTIES[property];
  if (logical !== undefined) return `use ${logical}`;
  if (PHYSICAL_SIDE.test(property))
    return "use the -block-start, -block-end, -inline-start, or -inline-end form";
  if (PHYSICAL_SIDE_VALUES.has(property) && /\b(?:left|right)\b/i.test(value)) {
    return "use start, end, inline-start, or inline-end";
  }
  if (PHYSICAL_ORDER_SHORTHANDS.has(property) && countValues(value) > 1) {
    return "give one value, or use the -block and -inline forms";
  }
  return null;
};

describe("the base stylesheet's declarations", () => {
  const declarations = readStylesheets().flatMap(({ name, root }) => {
    const found: { file: string; line: number; declaration: Declaration }[] = [];
    root.walkDecls((declaration) => {
      // The descriptors of an @property rule are not properties.
      if (declaration.parent?.type === "atrule") return;
      found.push({ file: name, line: declaration.source?.start?.line ?? 0, declaration });
    });
    return found;
  });

  it("are read from every stylesheet file", () => {
    expect(new Set(declarations.map(({ file }) => file))).toEqual(
      new Set(["table.css", "tokens.css"]),
    );
  });

  it("use no physical property or value outside the allowlist", () => {
    const physical = declarations
      .map(({ file, line, declaration }) => ({
        where: `${file}:${line}`,
        declaration: `${declaration.prop}: ${declaration.value}`,
        reason: physicalReason(declaration),
      }))
      .filter(({ declaration, reason }) => reason !== null && !(declaration in ALLOWLIST));

    expect(physical).toEqual([]);
  });

  it("would catch each kind of physical declaration", () => {
    const check = (prop: string, value: string) =>
      physicalReason({ prop, value } as Declaration) !== null;

    expect(check("left", "0")).toBe(true);
    expect(check("width", "100%")).toBe(true);
    expect(check("max-height", "1px")).toBe(true);
    expect(check("margin-top", "0")).toBe(true);
    expect(check("border-left-color", "red")).toBe(true);
    expect(check("padding-right", "1rem")).toBe(true);
    expect(check("overflow-x", "auto")).toBe(true);
    expect(check("text-align", "left")).toBe(true);
    expect(check("text-align", "right")).toBe(true);
    expect(check("padding", "0.5rem 1rem")).toBe(true);
    expect(check("margin", "calc(1px + 2px) 0")).toBe(true);

    expect(check("inline-size", "100%")).toBe(false);
    expect(check("text-align", "start")).toBe(false);
    expect(check("padding", "var(--bcd-cell-padding, 0.5rem)")).toBe(false);
    expect(check("margin-block", "0.5rem 0")).toBe(false);
    expect(check("overflow-inline", "auto")).toBe(false);
  });

  it("keep every allowlist entry in use", () => {
    const written = new Set(
      declarations.map(({ declaration }) => `${declaration.prop}: ${declaration.value}`),
    );
    expect(Object.keys(ALLOWLIST).filter((entry) => !written.has(entry))).toEqual([]);
  });
});
