// The disclosure interaction of issue #204 in Chromium, Firefox, and WebKit: the keyboard path,
// focus kept across a re-render, no motion, and a hover that reveals nothing. The page links the
// built `dist/base.css`. The component calls `focus()` nowhere (tests/no-focus-call.test.ts), so
// every focus assertion here shows what the browser's own `<details>` does.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import postcss, { AtRule } from "postcss";

const FIXTURE_PAGE = "/e2e/fixtures/data-mode.html";

const BASE_CSS = fileURLToPath(new URL("../dist/base.css", import.meta.url));

/**
 * The elements and pseudo-elements of the table that declare a transition or an animation. It
 * reads computed values, so it sees motion from any stylesheet on the page. "0s" is the initial
 * value of both durations, so a longer one is a declared motion. The pseudo-elements are the ones a
 * disclosure draws or reveals: the marker, the content part, and generated content.
 */
const declaredMotion = (page: Page) =>
  page.locator("#table").evaluate((table) => {
    const pseudos = ["::before", "::after", "::marker"];
    // An engine that does not know ::details-content would read the element's own values.
    if (CSS.supports("selector(::details-content)")) pseudos.push("::details-content");
    const found = new Set<string>();
    for (const element of table.querySelectorAll("details, summary, ul, li, td, tr, th")) {
      for (const pseudo of [null, ...pseudos]) {
        const style = getComputedStyle(element, pseudo);
        const label = `${element.localName}${pseudo ?? ""}`;
        for (const duration of [style.transitionDuration, style.animationDuration]) {
          for (const part of duration.split(",")) {
            if (Number.parseFloat(part) > 0) found.add(`${label}: ${part}`);
          }
        }
        if (style.animationName !== "none") found.add(`${label}: ${style.animationName}`);
      }
    }
    return [...found];
  });

/**
 * The selectors that contain `:hover` in one style sheet, at any depth. A style rule is a
 * grouping rule too, so a nested rule such as `td { &:hover {} }` is found as well. `sheet` is
 * the built stylesheet, or the style element with the id `injected`.
 */
const hoverSelectors = (page: Page, sheet: "base" | "injected") =>
  page.evaluate((which) => {
    const target = [...document.styleSheets].find((candidate) =>
      which === "base"
        ? candidate.href?.endsWith("/dist/base.css")
        : (candidate.ownerNode as Element | null)?.id === "injected",
    );
    if (target === undefined) throw new Error(`no ${which} stylesheet`);
    const found: string[] = [];
    const walk = (rules: CSSRuleList) => {
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule && rule.selectorText.includes(":hover")) {
          found.push(rule.selectorText);
        }
        // Any rule with child rules: @media, @supports, @layer, and a style rule with nesting.
        const children = (rule as { cssRules?: CSSRuleList }).cssRules;
        if (children !== undefined) walk(children);
      }
    };
    walk(target.cssRules);
    return found;
  }, sheet);

const open = async (page: Page): Promise<void> => {
  await page.goto(FIXTURE_PAGE);
  await page.locator("#table[loaded] table").waitFor();
};

/** The text that names the focused element: "region", a summary's sentence, or "body". */
const describeFocus = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement;
    if (active === null || active === document.body) return "body";
    if (active.localName === "summary") {
      return `summary: ${active.querySelector(".visually-hidden")?.textContent ?? ""}`;
    }
    return active.getAttribute("role") ?? active.localName;
  });

/** The sentence of the first summary, which names the Chrome cell of `fit-content`. */
const FIRST_SUMMARY = "summary: Supported since Chrome 46. History for fit-content in Chrome";

/** Tabs to the first disclosure, past the region. */
const focusFirstSummary = async (page: Page): Promise<void> => {
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  expect(await describeFocus(page)).toBe(FIRST_SUMMARY);
};

test.describe("the keyboard path", () => {
  test("Tab stops on the region and the five disclosures, in order, and then leaves the table", async ({
    page,
  }) => {
    await open(page);
    const stops: string[] = [];
    for (let presses = 0; presses < 7; presses += 1) {
      await page.keyboard.press("Tab");
      stops.push(await describeFocus(page));
    }

    expect(stops.slice(0, 6)).toEqual([
      "region",
      FIRST_SUMMARY,
      "summary: Supported since Chrome 18. History for abort in Chrome",
      "summary: Supported since Chrome 37 behind a flag. Flag details for AudioTrackList in Chrome",
      "summary: Supported from Chrome 11.1, then removed in Chrome 12.1. History and notes for removed_partial in Chrome",
      "summary: Supported since Chrome 20. Notes for notes_only in Chrome",
    ]);
    // The seventh press leaves the table: nothing else inside it is a tab stop.
    const inside = await page
      .locator("#table")
      .evaluate((table) => table.contains(document.activeElement));
    expect(inside).toBe(false);
  });

  for (const key of ["Enter", "Space"]) {
    test(`${key} opens and closes the focused disclosure, and focus stays on its summary`, async ({
      page,
    }) => {
      await open(page);
      await focusFirstSummary(page);

      const disclosure = page.locator("#table details").first();
      await expect(disclosure).not.toHaveAttribute("open");
      await page.keyboard.press(key);
      await expect(disclosure).toHaveAttribute("open", "");
      expect(await describeFocus(page)).toBe(FIRST_SUMMARY);

      await page.keyboard.press(key);
      await expect(disclosure).not.toHaveAttribute("open");
      expect(await describeFocus(page)).toBe(FIRST_SUMMARY);
    });
  }
});

test.describe("a re-render", () => {
  test("keeps an open disclosure open and focused when a column is added on each side of it", async ({
    page,
  }) => {
    await open(page);
    await focusFirstSummary(page);
    await page.keyboard.press("Enter");
    const disclosure = page.locator("#table details").first();
    await expect(disclosure).toHaveAttribute("open", "");
    await disclosure.evaluate((node) => {
      (window as unknown as { kept: Element }).kept = node;
    });

    // The fixture shows chrome, opera, and nodejs. Firefox joins before opera, and Safari after
    // nodejs, so a neighbour appears on each side of the Chrome cell's column.
    await page.locator("#table").evaluate((table) => {
      table.setAttribute("browsers", "chrome firefox opera nodejs safari");
    });
    await expect(page.locator("#table thead tr:nth-child(2) th")).toHaveCount(5);

    // Lit kept the very same element, so the open state and the focus are the browser's own.
    const same = await page.evaluate(
      () =>
        (window as unknown as { kept: Element }).kept === document.querySelector("#table details"),
    );
    expect(same).toBe(true);
    await expect(page.locator("#table details").first()).toHaveAttribute("open", "");
    expect(await describeFocus(page)).toBe(FIRST_SUMMARY);
  });

  test("keeps the open disclosure when the other columns are removed", async ({ page }) => {
    await open(page);
    await focusFirstSummary(page);
    await page.keyboard.press("Enter");

    await page.locator("#table").evaluate((table) => {
      table.setAttribute("browsers", "chrome");
    });
    await expect(page.locator("#table thead tr:nth-child(2) th")).toHaveCount(1);

    await expect(page.locator("#table details").first()).toHaveAttribute("open", "");
    expect(await describeFocus(page)).toBe(FIRST_SUMMARY);
  });

  test("does not move focus to another summary when the focused cell's column goes", async ({
    page,
  }) => {
    await open(page);
    await focusFirstSummary(page);

    await page.locator("#table").evaluate((table) => {
      table.setAttribute("browsers", "opera nodejs");
    });
    await expect(page.locator("#table thead tr:nth-child(2) th")).toHaveCount(2);
    // This records what the browser does when it removes the focused element, which the component
    // does not control. It fails only if the component starts moving focus to another element.
    expect(await describeFocus(page)).toBe("body");
  });
});

test.describe("motion", () => {
  for (const reducedMotion of ["reduce", "no-preference"] as const) {
    test(`runs no transition or animation when a disclosure opens, with ${reducedMotion}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion });
      await open(page);

      const declared = await declaredMotion(page);
      expect(declared).toEqual([]);

      // Running animations, as the browser reports them, after a disclosure opens and closes.
      const disclosure = page.locator("#table details").first();
      await page.locator("#table summary").first().click();
      await expect(disclosure).toHaveAttribute("open", "");
      expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
      await page.locator("#table summary").first().click();
      await expect(disclosure).not.toHaveAttribute("open");
      expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    });
  }

  test("dist/base.css declares motion only inside prefers-reduced-motion: no-preference", async () => {
    const root = postcss.parse(await readFile(BASE_CSS, "utf8"));
    const unguarded: string[] = [];
    root.walkDecls(/^(?:transition|animation)/i, (declaration) => {
      let guarded = false;
      for (
        let node: postcss.Container | postcss.Document | undefined = declaration.parent;
        node;
        node = node.parent
      ) {
        if (
          node instanceof AtRule &&
          node.name === "media" &&
          /prefers-reduced-motion\s*:\s*no-preference/.test(node.params)
        ) {
          guarded = true;
        }
      }
      if (!guarded) unguarded.push(`${declaration.prop}: ${declaration.value}`);
    });
    expect(unguarded).toEqual([]);
  });

  test("the motion scan sees motion on elements and pseudo-elements", async ({ page }) => {
    await open(page);
    await page.addStyleTag({
      content: `
        details { transition: opacity 1s; }
        summary::marker { transition: color 1s; }
        td::after { content: ""; animation: spin 1s; }
        details::details-content { transition: opacity 1s; }
        @keyframes spin { to { opacity: 0.5; } }`,
    });
    const declared = await declaredMotion(page);
    expect(declared).toContain("details: 1s");
    expect(declared).toContain("summary::marker: 1s");
    expect(declared).toContain("td::after: spin");
    const hasPart = await page.evaluate(() => CSS.supports("selector(::details-content)"));
    if (hasPart) expect(declared).toContain("details::details-content: 1s");
  });

  test("opening a disclosure changes only its own row's height", async ({ page }) => {
    await open(page);
    const rowBoxes = () =>
      page.locator("#table tbody tr").evaluateAll((rows) =>
        rows.map((row) => {
          const { top, height } = row.getBoundingClientRect();
          return { top, height };
        }),
      );
    const before = await rowBoxes();

    await page.locator("#table summary").first().click();
    await expect(page.locator("#table details").first()).toHaveAttribute("open", "");
    const after = await rowBoxes();

    // Rows above the opened one keep their place, rows below move down by exactly the height it
    // gained, and no other row changes height.
    const grown = after.findIndex(
      (row, index) => Math.abs(row.height - (before[index]?.height ?? 0)) >= 1,
    );
    expect(grown).toBeGreaterThanOrEqual(0);
    const gained = (after[grown]?.height ?? 0) - (before[grown]?.height ?? 0);
    expect(gained).toBeGreaterThan(0);
    after.forEach((row, index) => {
      const old = before[index];
      if (old === undefined) throw new Error(`no row ${index}`);
      // Fractional layout means the values agree to within a pixel, not exactly.
      if (index !== grown) expect(Math.abs(row.height - old.height)).toBeLessThan(1);
      expect(Math.abs(row.top - (old.top + (index > grown ? gained : 0)))).toBeLessThan(1);
    });
  });

  test("opening a disclosure moves no cell sideways and changes no cell's width", async ({
    page,
  }) => {
    await open(page);
    const inlineBoxes = () =>
      page.locator("#table td, #table th").evaluateAll((cells) =>
        cells.map((cell) => {
          const { left, width } = cell.getBoundingClientRect();
          return { left, width };
        }),
      );
    const before = await inlineBoxes();
    expect(before.length).toBeGreaterThan(20);

    const drift: string[] = [];
    for (let which = 0; which < 5; which += 1) {
      const summary = page.locator("#table summary").nth(which);
      await summary.click();
      await expect(page.locator("#table details[open]")).toHaveCount(1);
      const after = await inlineBoxes();
      after.forEach((box, index) => {
        const old = before[index];
        if (old === undefined) throw new Error(`no cell ${index}`);
        if (Math.abs(box.left - old.left) >= 1 || Math.abs(box.width - old.width) >= 1) {
          drift.push(
            `open ${which}, cell ${index}: ${old.left},${old.width} -> ${box.left},${box.width}`,
          );
        }
      });
      await summary.click();
      await expect(page.locator("#table details[open]")).toHaveCount(0);
    }
    expect(drift).toEqual([]);
  });
});

test.describe("hover", () => {
  test("reveals nothing: no title, no hover rule, and no change in the table's text or boxes", async ({
    page,
  }) => {
    await open(page);

    const hoverRules = await hoverSelectors(page, "base");
    expect(hoverRules).toEqual([]);
    await expect(page.locator("#table [title], #table [popover]")).toHaveCount(0);

    const snapshot = () =>
      page.locator("#table").evaluate((table) => ({
        text: (table as HTMLElement).innerText,
        html: table.innerHTML,
        boxes: [...table.querySelectorAll("td, th")].map((cell) => {
          const { width, height } = cell.getBoundingClientRect();
          return `${Math.round(width)}x${Math.round(height)}`;
        }),
      }));
    const before = await snapshot();
    for (const cell of await page.locator("#table tbody td").all()) {
      await cell.hover();
      expect(await snapshot()).toEqual(before);
    }
  });
});

test.describe("the hover scan", () => {
  test("finds a :hover selector at the top level, in @media, and nested in a style rule", async ({
    page,
  }) => {
    await open(page);
    await page.evaluate(() => {
      const style = document.createElement("style");
      style.id = "injected";
      style.textContent = `
        td:hover { color: red; }
        @media screen { th:hover { color: red; } }
        tr { &:hover { color: red; } }`;
      document.head.append(style);
    });
    const found = await hoverSelectors(page, "injected");
    expect(found).toHaveLength(3);
  });
});
