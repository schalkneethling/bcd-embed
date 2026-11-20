// The default palette meets WCAG 2.2's contrast minimums against the page background, in light
// and in dark (Document 3 section 5): 4.5:1 for text (success criterion 1.4.3) and 3:1 for
// icons (1.4.11, non-text contrast). The ratios are computed here from the tokens'
// initial-values in properties.css, with the relative luminance formula WCAG 2.2 defines.
//
// Every declaration that uses a colour token is checked. A `color` on an icon class is an icon
// colour. A border colour is held to 3:1 as well, so cell boundaries stay visible, although WCAG
// does not require it of a table's borders. Any other colour would be text, so it needs 4.5:1.
import type { Declaration, Rule } from "postcss";
import { describe, expect, it } from "vitest";

import { CANVAS } from "./canvas.js";
import { readStylesheet, readStylesheets } from "./stylesheets.js";

type Role = "icon" | "border" | "text";

const MINIMUM: Readonly<Record<Role, number>> = { icon: 3, border: 3, text: 4.5 };

const initialValues = (() => {
  const found = new Map<string, string>();
  readStylesheet("properties.css").root.walkAtRules("property", (rule) => {
    rule.walkDecls("initial-value", (declaration) => {
      found.set(rule.params.trim(), declaration.value.trim());
    });
  });
  return found;
})();

/** WCAG 2.2's relative luminance of an sRGB colour written `#rrggbb`. */
const luminance = (hex: string): number => {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const [red = 0, green = 0, blue = 0] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

/** WCAG 2.2's contrast ratio of two colours, from 1 to 21. */
const contrastRatio = (first: string, second: string): number => {
  const [lighter = 0, darker = 0] = [luminance(first), luminance(second)].toSorted(
    (left, right) => right - left,
  );
  return (lighter + 0.05) / (darker + 0.05);
};

/** The two tokens of `light-dark(var(--a), var(--b))`, or null for any other value. */
const lightDarkTokens = (value: string): { light: string; dark: string } | null => {
  const match = /light-dark\(\s*var\((--[\w-]+)\)\s*,\s*var\((--[\w-]+)\)\s*\)/.exec(value);
  return match === null ? null : { light: match[1] ?? "", dark: match[2] ?? "" };
};

const roleOf = (declaration: Declaration): Role => {
  const rule = declaration.parent as Rule;
  if (declaration.prop.startsWith("border")) return "border";
  const iconsOnly = rule.selectors.every((selector) => /^\.bcd-icon-[\w-]+$/.test(selector));
  return declaration.prop === "color" && iconsOnly ? "icon" : "text";
};

type ColourUse = {
  readonly where: string;
  readonly role: Role;
  readonly light: string;
  readonly dark: string;
};

const colourUses: ColourUse[] = readStylesheets().flatMap(({ name, root }) => {
  const uses: ColourUse[] = [];
  root.walkDecls((declaration) => {
    if (declaration.parent?.type !== "rule") return;
    const tokens = lightDarkTokens(declaration.value);
    const isColour = declaration.prop === "color" || /color|^border$/.test(declaration.prop);
    if (tokens === null) {
      // A colour written without the palette's tokens would escape this check.
      if (declaration.prop === "color") throw new Error(`${name}: color without tokens`);
      return;
    }
    if (!isColour) throw new Error(`${name}: light-dark() in ${declaration.prop}`);
    uses.push({
      where: `${name}: ${(declaration.parent as Rule).selector} { ${declaration.prop} }`,
      role: roleOf(declaration),
      light: initialValues.get(tokens.light) ?? `missing ${tokens.light}`,
      dark: initialValues.get(tokens.dark) ?? `missing ${tokens.dark}`,
    });
  });
  return uses;
});

describe("contrastRatio", () => {
  it("gives WCAG's ratios for known pairs", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    // #767676 on white is the classic lightest grey at 4.5:1.
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });
});

describe("the default palette", () => {
  it("uses colour tokens for every state icon and for the borders", () => {
    expect(colourUses.filter(({ role }) => role === "icon")).toHaveLength(7);
    expect(colourUses.filter(({ role }) => role === "border")).toHaveLength(1);
  });

  it("colours no text, so every text colour stays the page's own", () => {
    expect(colourUses.filter(({ role }) => role === "text")).toEqual([]);
  });

  it.for(["light", "dark"] as const)(
    "meets each role's minimum against every engine's Canvas in %s",
    (scheme) => {
      const failures = colourUses.flatMap((use) =>
        Object.entries(CANVAS).flatMap(([engine, canvas]) => {
          const ratio = contrastRatio(use[scheme], canvas[scheme]);
          return ratio >= MINIMUM[use.role]
            ? []
            : [
                `${use.where} in ${engine}: ${use[scheme]} on ${canvas[scheme]} is ${ratio.toFixed(2)}:1`,
              ];
        }),
      );
      expect(failures).toEqual([]);
    },
  );
});
