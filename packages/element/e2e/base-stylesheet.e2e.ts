// The opt-in base stylesheet (issue #200) in Chromium, Firefox, and WebKit: its cascade layer,
// that unlayered author rules beat it, the palette in light and dark, forced colours, what shows
// with and without it, and axe. The pages link the built `dist/base.css`
// (e2e/global-setup.ts builds it).
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { CANVAS } from "../tests/styles/canvas.js";
import type { Engine } from "../tests/styles/canvas.js";

const STYLED_PAGE = "/e2e/fixtures/data-mode.html";
const UNSTYLED_PAGE = "/e2e/fixtures/unstyled.html";

const open = async (page: Page, path: string): Promise<void> => {
  await page.goto(path);
  await page.locator("#table[loaded] table").waitFor();
};

const expectNoViolations = async (page: Page): Promise<void> => {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(
    violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) })),
  ).toEqual([]);
};

const openEveryDisclosure = (page: Page) =>
  page
    .locator("#table details")
    .evaluateAll((disclosures) =>
      disclosures.forEach((disclosure) => disclosure.setAttribute("open", "")),
    );

/** `#rrggbb` as getComputedStyle writes it. */
const rgb = (hex: string): string => {
  const [red, green, blue] = [1, 3, 5].map((start) =>
    Number.parseInt(hex.slice(start, start + 2), 16),
  );
  return `rgb(${red}, ${green}, ${blue})`;
};

/** The icon classes the fixture renders, such as `bcd-icon-supported`, each once. */
const renderedIcons = (page: Page) =>
  page
    .locator("#table svg.bcd-icon")
    .evaluateAll((icons) => [
      ...new Set(
        icons.map(
          (icon) =>
            [...icon.classList].find((name) => name.startsWith("bcd-icon-")) ?? "(no state class)",
        ),
      ),
    ]);

test.describe("the stylesheet's cascade layer", () => {
  test("holds every style rule from base.css in bcd-embed.base, and leaves only @property outside", async ({
    page,
  }) => {
    await open(page, STYLED_PAGE);

    const structure = await page.evaluate(() => {
      const sheet = [...document.styleSheets].find((candidate) =>
        candidate.href?.endsWith("/dist/base.css"),
      );
      if (sheet === undefined) throw new Error("dist/base.css is not linked");
      const topLevel = [...sheet.cssRules].map((rule) => {
        if (rule instanceof CSSLayerStatementRule) return `@layer ${rule.nameList.join(", ")};`;
        if (rule instanceof CSSLayerBlockRule) return `@layer ${rule.name} {}`;
        if (rule instanceof CSSPropertyRule) return "@property";
        return rule.constructor.name;
      });
      // Every style rule, with the names of the layers around it.
      const styleRules: { selector: string; layers: string[] }[] = [];
      const walk = (rules: CSSRuleList, layers: string[]) => {
        for (const rule of rules) {
          // CSSStyleRule extends CSSGroupingRule in Firefox, for nested rules, so it is tested
          // first.
          if (rule instanceof CSSStyleRule)
            styleRules.push({ selector: rule.selectorText, layers });
          else if (rule instanceof CSSLayerBlockRule) walk(rule.cssRules, [...layers, rule.name]);
          else if (rule instanceof CSSGroupingRule) walk(rule.cssRules, layers);
        }
      };
      walk(sheet.cssRules, []);
      return { topLevel, styleRules };
    });

    expect(structure.topLevel[0]).toBe("@layer bcd-embed.base;");
    expect(new Set(structure.topLevel.slice(1).filter((entry) => entry !== "@property"))).toEqual(
      new Set(["@layer bcd-embed.base {}"]),
    );
    expect(structure.topLevel.filter((entry) => entry === "@property").length).toBeGreaterThan(0);
    expect(structure.styleRules.length).toBeGreaterThan(0);
    expect(
      structure.styleRules.filter(({ layers }) => layers.join(" ") !== "bcd-embed.base"),
    ).toEqual([]);
  });

  test("registers its custom properties from the document", async ({ page }) => {
    await open(page, STYLED_PAGE);

    // A registered property reports its initial value; an unregistered one reports "".
    const value = await page.evaluate(() =>
      getComputedStyle(document.body).getPropertyValue("--bcd-color-supported-light"),
    );
    expect(value).toBe(rgb("#1a7f37"));
  });
});

/**
 * A value to override `property` with, which differs from `current` and which getComputedStyle
 * reports exactly as written. Null for a property the table does not know, which fails the test,
 * so a new property in the stylesheet needs an entry here.
 */
const overrideFor = (property: string, current: string): string | null => {
  const pick = (...candidates: string[]) =>
    candidates.find((candidate) => candidate !== current) ?? null;
  if (/-color$|^color$/.test(property)) return pick("rgb(1, 2, 3)", "rgb(3, 2, 1)");
  if (property.endsWith("-style")) return pick("dashed", "dotted");
  // A table is never narrower than its content, so a size is larger than any the page renders.
  if (/-size$|^width$|^height$/.test(property)) return pick("2000px", "2100px");
  if (/^(?:padding|margin|inset)-|-width$|^outline-offset$/.test(property)) {
    return pick("7px", "9px");
  }
  const keywords: Record<string, string[]> = {
    display: ["block", "flex"],
    visibility: ["visible", "collapse"],
    position: ["relative", "static"],
    "overflow-x": ["scroll", "visible"],
    "overflow-y": ["scroll", "visible"],
    "overflow-inline": ["scroll", "visible"],
    "overflow-block": ["scroll", "visible"],
    "clip-path": ["none", "inset(1px)"],
    "white-space": ["pre", "normal"],
    "white-space-collapse": ["preserve", "collapse"],
    "text-wrap-mode": ["wrap", "nowrap"],
    cursor: ["text", "default"],
    "border-collapse": ["separate", "collapse"],
    "border-spacing": ["7px 9px", "9px 7px"],
    // Chromium and WebKit expand `border-spacing` into these two longhands.
    "-webkit-border-horizontal-spacing": ["7px", "9px"],
    "-webkit-border-vertical-spacing": ["7px", "9px"],
    "font-weight": ["100", "900"],
    "white-space-trim": ["discard-before", "none"],
    // The grid that keeps a bare text fallback from taking space.
    "grid-template-columns": ["7px", "9px"],
    "grid-template-rows": ["7px", "9px"],
    "grid-auto-rows": ["7px", "9px"],
    // The row headers' floor and the long names that wrap (#201).
    "box-sizing": ["content-box", "border-box"],
    "overflow-wrap": ["normal", "break-word"],
    "grid-row-start": ["2", "3"],
    "grid-row-end": ["span 2", "span 3"],
    "grid-column-start": ["2", "3"],
    "grid-column-end": ["span 2", "span 3"],
    // One engine expands `vertical-align` into these three longhands.
    "alignment-baseline": ["central", "middle"],
    "baseline-shift": ["7px", "9px"],
    "baseline-source": ["first", "last"],
    // The `border` shorthand also resets the border image.
    "border-image-source": ['url("data:,x")', "none"],
    "border-image-slice": ["50%", "40%"],
    "border-image-outset": ["1", "2"],
    "border-image-repeat": ["round", "space"],
    "text-align": ["end", "center"],
    "vertical-align": ["middle", "bottom"],
  };
  const candidates = keywords[property];
  return candidates === undefined ? null : pick(...candidates);
};

test.describe("an unlayered author rule", () => {
  test("with a single class selector beats every rule of the stylesheet, for every selector and property", async ({
    page,
  }) => {
    await open(page, STYLED_PAGE);
    await openEveryDisclosure(page);
    // The fixture nests rows two levels deep and has no full preview, so a small table outside
    // the element gives the rules for depths 3 and 4 and the preview icon something to match.
    await page.evaluate(() => {
      const table = document.createElement("table");
      table.className = "bcd-table";
      table.innerHTML =
        '<tbody><tr><th class="bcd-feature bcd-feature-depth-3">x</th>' +
        '<th class="bcd-feature bcd-feature-depth-4">y</th>' +
        '<td><svg class="bcd-icon bcd-icon-preview" viewBox="0 0 24 24"></svg></td></tr></tbody>';
      document.querySelector("main")?.append(table);
    });

    // Every selector of every style rule, with the longhands the rule sets, read from the sheet.
    const cases = await page.evaluate(() => {
      const sheet = [...document.styleSheets].find((candidate) =>
        candidate.href?.endsWith("/dist/base.css"),
      );
      if (sheet === undefined) throw new Error("dist/base.css is not linked");
      const found: { selector: string; properties: string[] }[] = [];
      const walk = (rules: CSSRuleList) => {
        for (const rule of rules) {
          // CSSStyleRule extends CSSGroupingRule in Firefox, so it is tested first.
          if (rule instanceof CSSStyleRule) {
            for (const selector of rule.selectorText.split(/,\s*/)) {
              found.push({ selector, properties: [...rule.style] });
            }
          } else if (rule instanceof CSSGroupingRule) walk(rule.cssRules);
        }
      };
      walk(sheet.cssRules);
      return found;
    });
    expect(cases.length).toBeGreaterThan(20);

    const failures: string[] = [];
    let checked = 0;
    for (const { selector, properties } of cases) {
      // A :focus-visible rule applies only to a focused element, so the element is focused after
      // a key press, which makes the browser treat the focus as keyboard focus.
      const focus = selector.includes(":focus-visible");
      if (focus) await page.keyboard.press("Shift");
      const target = await page.evaluate(
        ({ selector: wanted, focus: needsFocus }) => {
          const element = document.querySelector<HTMLElement>(
            needsFocus ? wanted.replaceAll(":focus-visible", "") : wanted,
          );
          if (element === null) return null;
          if (needsFocus) element.focus();
          element.dataset.override = "";
          return element.matches(wanted);
        },
        { selector, focus },
      );
      if (target !== true) {
        failures.push(`${selector}: no element on the page matches it`);
        continue;
      }
      for (const property of new Set(["color", ...properties])) {
        const current = await page.evaluate(
          (name) =>
            getComputedStyle(document.querySelector("[data-override]") as Element).getPropertyValue(
              name,
            ),
          property,
        );
        const value = overrideFor(property, current);
        if (value === null) {
          failures.push(`${selector}: no override value for ${property}`);
          continue;
        }
        const applied = await page.evaluate(
          ({ name, wanted }) => {
            const element = document.querySelector("[data-override]") as HTMLElement;
            element.classList.add("author-override");
            const style = document.createElement("style");
            style.textContent = `.author-override { ${name}: ${wanted}; }`;
            document.head.append(style);
            const result = getComputedStyle(element).getPropertyValue(name);
            style.remove();
            element.classList.remove("author-override");
            return result;
          },
          { name: property, wanted: value },
        );
        checked += 1;
        if (applied !== value)
          failures.push(`${selector} { ${property} }: ${applied}, not ${value}`);
      }
      await page.evaluate(() => {
        const element = document.querySelector<HTMLElement>("[data-override]");
        element?.blur();
        delete element?.dataset.override;
      });
    }

    expect(failures).toEqual([]);
    expect(checked).toBeGreaterThan(cases.length);
  });
});

test.describe("the palette", () => {
  // The colour each rendered icon computes to, by its state class.
  const iconColours = (page: Page) =>
    page
      .locator("#table svg.bcd-icon")
      .evaluateAll((icons) =>
        Object.fromEntries(
          icons.map((icon) => [
            [...icon.classList].find((name) => name.startsWith("bcd-icon-")),
            getComputedStyle(icon).color,
          ]),
        ),
      );
  // The colour each state's token gives for `scheme`, read from the registered properties.
  const tokenColours = (page: Page, icons: string[], scheme: "light" | "dark") =>
    page.evaluate(
      ({ names, wanted }) =>
        Object.fromEntries(
          names.map((name) => [
            name,
            getComputedStyle(document.body).getPropertyValue(
              `--bcd-color-${name.replace("bcd-icon-", "")}-${wanted}`,
            ),
          ]),
        ),
      { names: icons, wanted: scheme },
    );

  test("uses the light colours by default", async ({ page }) => {
    await open(page, STYLED_PAGE);
    const icons = await renderedIcons(page);

    expect(icons.length).toBeGreaterThanOrEqual(5);
    expect(await iconColours(page)).toEqual(await tokenColours(page, icons, "light"));
  });

  test("uses the dark colours under color-scheme: dark on an ancestor", async ({ page }) => {
    await open(page, STYLED_PAGE);
    // The supported setup: the element that sets the dark scheme also paints the dark background
    // the palette was checked against. light-dark() follows the inherited scheme even where no
    // dark background is painted, and the dark colours fail 3:1 on white.
    await page.locator("main").evaluate((main) => {
      main.style.colorScheme = "dark";
      main.style.backgroundColor = "Canvas";
    });
    const icons = await renderedIcons(page);

    expect(await iconColours(page)).toEqual(await tokenColours(page, icons, "dark"));
    expect(await iconColours(page)).not.toEqual(await tokenColours(page, icons, "light"));
  });

  test("draws each state's icon with its own pixels", async ({ page }) => {
    await open(page, STYLED_PAGE);
    const icons = await renderedIcons(page);

    // Two different path strings could draw the same shape, so the rendered icons are compared.
    const shots = new Map<string, string>();
    for (const state of icons) {
      const shot = await page.locator(`#table svg.${state}`).first().screenshot();
      shots.set(state, shot.toString("base64"));
    }
    expect(shots.size).toBeGreaterThanOrEqual(5);
    expect(new Set(shots.values()).size).toBe(shots.size);
  });

  test("follows prefers-color-scheme when the page declares color-scheme: light dark", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await open(page, STYLED_PAGE);
    const icons = await renderedIcons(page);

    // The stylesheet sets no color-scheme of its own, so a page that declares none stays light.
    expect(await iconColours(page)).toEqual(await tokenColours(page, icons, "light"));

    await page.evaluate(() => {
      document.documentElement.style.colorScheme = "light dark";
    });
    expect(await iconColours(page)).toEqual(await tokenColours(page, icons, "dark"));
  });

  test("is checked against the Canvas colours this engine really uses", async ({
    page,
    browserName,
  }) => {
    await open(page, STYLED_PAGE);
    const canvas = await page.evaluate(() =>
      (["light", "dark"] as const).map((scheme) => {
        const probe = document.createElement("div");
        probe.style.colorScheme = scheme;
        probe.style.backgroundColor = "Canvas";
        document.body.append(probe);
        const colour = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return colour;
      }),
    );

    const expected = CANVAS[browserName as Engine];
    expect(canvas).toEqual([rgb(expected.light), rgb(expected.dark)]);
  });
});

test.describe("forced colours", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await open(page, STYLED_PAGE);
    const active = await page.evaluate(() => matchMedia("(forced-colors: active)").matches);
    test.skip(!active, "This engine does not emulate forced colours in Playwright 1.65.1");
  });

  test("keep each state distinguishable by the shape of its icon", async ({ page }) => {
    const icons = await page.locator("#table svg.bcd-icon").evaluateAll((elements) =>
      elements.map((icon) => {
        const box = icon.getBoundingClientRect();
        const style = getComputedStyle(icon);
        const cell = icon.closest("td") as Element;
        return {
          state: [...icon.classList].find((name) => name.startsWith("bcd-icon-")) ?? "",
          path: icon.querySelector("path")?.getAttribute("d") ?? "",
          stroke: style.stroke,
          background: getComputedStyle(cell).backgroundColor,
          canvas: (() => {
            const probe = document.createElement("div");
            probe.style.backgroundColor = "Canvas";
            document.body.append(probe);
            const colour = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return colour;
          })(),
          width: box.width,
          height: box.height,
        };
      }),
    );

    // One path for each state, and a different path for each state.
    const pathByState = new Map(icons.map(({ state, path }) => [state, path]));
    expect(pathByState.size).toBeGreaterThanOrEqual(5);
    expect(new Set(pathByState.values()).size).toBe(pathByState.size);
    for (const icon of icons) {
      expect(icon.width, icon.state).toBeGreaterThan(8);
      expect(icon.height, icon.state).toBeGreaterThan(8);
      expect(icon.stroke, icon.state).not.toBe("none");
      expect(icon.stroke, icon.state).not.toBe(icon.canvas);
    }

    // The pixels differ too: a screenshot of the first icon of each state is unique.
    const shots = new Map<string, string>();
    for (const state of pathByState.keys()) {
      const shot = await page.locator(`#table svg.${state}`).first().screenshot();
      shots.set(state, shot.toString("base64"));
    }
    expect(new Set(shots.values()).size).toBe(shots.size);
  });

  test("keep focus visible on the region and on each summary", async ({ page }) => {
    const outlines: {
      stop: string;
      style: string;
      width: number;
      colour: string;
      canvas: string;
    }[] = [];
    for (let presses = 0; presses < 6; presses += 1) {
      await page.keyboard.press("Tab");
      outlines.push(
        await page.evaluate(() => {
          const active = document.activeElement as Element;
          const style = getComputedStyle(active);
          const probe = document.createElement("div");
          probe.style.backgroundColor = "Canvas";
          document.body.append(probe);
          const canvas = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return {
            stop: active.localName,
            style: style.outlineStyle,
            width: Number.parseFloat(style.outlineWidth),
            colour: style.outlineColor,
            canvas,
          };
        }),
      );
    }

    expect(outlines.map(({ stop }) => stop)).toEqual([
      "div",
      "summary",
      "summary",
      "summary",
      "summary",
      "summary",
    ]);
    for (const outline of outlines) {
      expect(outline.style, outline.stop).not.toBe("none");
      expect(outline.width, outline.stop).toBeGreaterThanOrEqual(2);
      expect(outline.colour, outline.stop).not.toBe(outline.canvas);
    }
  });
});

test.describe("with the stylesheet", () => {
  test("shows each cell's icon and version, and hides its sentence from sight", async ({
    page,
  }) => {
    await open(page, STYLED_PAGE);

    const cells = await page.locator("#table td").evaluateAll((elements) =>
      elements.map((cell) => {
        const compact = cell.querySelector('[aria-hidden="true"]') as Element;
        const sentence = cell.querySelector(".visually-hidden") as Element;
        const icon = compact.querySelector("svg") as Element;
        const box = (element: Element) => element.getBoundingClientRect();
        return {
          compactDisplay: getComputedStyle(compact).display,
          iconWidth: box(icon).width,
          sentenceWidth: box(sentence).width,
          sentenceHeight: box(sentence).height,
          sentenceClip: getComputedStyle(sentence).clipPath,
        };
      }),
    );

    expect(cells).toHaveLength(42);
    for (const cell of cells) {
      expect(cell.compactDisplay).toBe("inline");
      expect(cell.iconWidth).toBeGreaterThan(8);
      expect(cell.sentenceWidth).toBeLessThanOrEqual(1);
      expect(cell.sentenceHeight).toBeLessThanOrEqual(1);
      expect(cell.sentenceClip).toBe("inset(50%)");
    }
  });

  test("puts every icon, with no <title>, inside the aria-hidden span", async ({ page }) => {
    await open(page, STYLED_PAGE);

    const icons = await page.locator("#table svg").evaluateAll((elements) =>
      elements.map((icon) => ({
        parentHidden: icon.parentElement?.getAttribute("aria-hidden"),
        titles: icon.querySelectorAll("title").length,
      })),
    );

    expect(icons).toHaveLength(42);
    expect(
      icons.filter(({ parentHidden, titles }) => parentHidden !== "true" || titles !== 0),
    ).toEqual([]);
  });

  test("has no axe violations, closed and with every disclosure open", async ({ page }) => {
    await open(page, STYLED_PAGE);
    await expectNoViolations(page);

    await openEveryDisclosure(page);
    await expect(page.locator("#table details[open]")).toHaveCount(5);
    await expectNoViolations(page);
  });
});

test.describe("the fallback rule, with the stylesheet", () => {
  // Adds an element with the given fallback, assigns the fixture, and reports what a reader
  // sees: the fallback's display, whether its text is in innerText, and the offset of the render
  // container from the top of the element.
  const mountWithFallback = (page: Page, fallback: "element" | "text" | "both") =>
    page.evaluate(async (kind) => {
      const table = document.createElement("bcd-compat-table");
      table.id = `fallback-${kind}`;
      table.setAttribute("browsers", "chrome");
      if (kind !== "text") {
        const paragraph = document.createElement("p");
        paragraph.textContent = "Element fallback";
        table.append(paragraph);
      }
      if (kind !== "element") table.append("Text fallback, please wait…");
      document.querySelector("main")?.append(table);
      table.data = window.bcdFixture.payload;
      await new Promise((resolve) => setTimeout(resolve, 0));
      return table.id;
    }, fallback);

  const measure = (page: Page, id: string) =>
    page.evaluate((wanted) => {
      const table = document.getElementById(wanted) as HTMLElementTagNameMap["bcd-compat-table"];
      const container = table.querySelector(".bcd-render-container");
      const paragraph = table.querySelector(":scope > p");
      return {
        loaded: table.hasAttribute("loaded"),
        visibleText: table.innerText,
        paragraphDisplay: paragraph === null ? null : getComputedStyle(paragraph).display,
        // The space above the container, and the space the element takes beyond the container.
        offset:
          container === null
            ? null
            : container.getBoundingClientRect().top - table.getBoundingClientRect().top,
        extra:
          container === null
            ? null
            : table.getBoundingClientRect().height - container.getBoundingClientRect().height,
      };
    }, id);

  const clearData = (page: Page, id: string) =>
    page.evaluate(async (wanted) => {
      const table = document.getElementById(wanted) as HTMLElementTagNameMap["bcd-compat-table"];
      table.data = null;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }, id);

  for (const kind of ["element", "text", "both"] as const) {
    test(`hides the ${kind} fallback without leaving space, and shows it again when loaded goes`, async ({
      page,
    }) => {
      await open(page, STYLED_PAGE);
      const id = await mountWithFallback(page, kind);

      const loaded = await measure(page, id);
      expect(loaded.loaded).toBe(true);
      expect(loaded.visibleText).toContain("Supported since Chrome 46");
      expect(loaded.visibleText).not.toContain("Element fallback");
      expect(loaded.visibleText).not.toContain("Text fallback");
      if (kind !== "text") expect(loaded.paragraphDisplay).toBe("none");
      // The fallback takes no space: the container starts at the element's top, and the element
      // is no taller than the container.
      expect(Math.abs(loaded.offset ?? Number.NaN)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(loaded.extra ?? Number.NaN)).toBeLessThanOrEqual(0.5);

      await clearData(page, id);
      const cleared = await measure(page, id);
      expect(cleared.loaded).toBe(false);
      if (kind !== "text") {
        expect(cleared.paragraphDisplay).toBe("block");
        expect(cleared.visibleText).toContain("Element fallback");
      }
      if (kind !== "element") expect(cleared.visibleText).toContain("Text fallback");
      expect(cleared.visibleText).not.toContain("Supported since Chrome 46");
    });
  }

  // The grid that hides a bare text fallback must not collapse the row that holds the table:
  // before #201 fixed it, the element and its container were 0 pixels tall in all three engines,
  // so the page's next content was drawn over the table.
  test("keeps the element as tall as its table, so the content after it starts below it", async ({
    page,
  }) => {
    await open(page, STYLED_PAGE);
    const boxes = await page.evaluate(() => {
      const element = document.getElementById("table") as HTMLElement;
      const after = document.createElement("p");
      after.textContent = "After the table";
      element.after(after);
      const table = element.querySelector(".bcd-scroller") as Element;
      return {
        element: element.getBoundingClientRect().height,
        table: table.getBoundingClientRect().height,
        tableBottom: table.getBoundingClientRect().bottom,
        afterTop: after.getBoundingClientRect().top,
      };
    });

    expect(boxes.table).toBeGreaterThan(100);
    expect(Math.abs(boxes.element - boxes.table)).toBeLessThanOrEqual(0.5);
    expect(boxes.afterTop).toBeGreaterThanOrEqual(boxes.tableBottom - 0.5);
  });

  test("keeps the author's font size for the table, and an em token follows it", async ({
    page,
  }) => {
    await open(page, STYLED_PAGE);
    await page.evaluate(() => {
      const style = document.createElement("style");
      style.textContent = "main { font-size: 20px; }";
      document.head.append(style);
    });
    const id = await mountWithFallback(page, "both");

    const sizes = await page.evaluate((wanted) => {
      const table = document.getElementById(wanted) as Element;
      const cell = table.querySelector("td") as Element;
      const icon = table.querySelector("svg.bcd-icon") as Element;
      return {
        cellFontSize: getComputedStyle(cell).fontSize,
        iconWidth: icon.getBoundingClientRect().width,
      };
    }, id);
    expect(sizes.cellFontSize).toBe("20px");
    expect(sizes.iconWidth).toBeCloseTo(20, 0);
  });
});

test.describe("the visually hidden sentences", () => {
  // A positioned or inline-block sentence becomes an accessible object of its own: Chromium's tree
  // shows a "generic" node for an inline-block span and none for an inline one. In Firefox that
  // object gave NVDA an empty item in row headers, and Orca's Return stopped opening disclosures
  // it reached by table navigation. So each sentence stays an inline, unpositioned box of no size.
  test("stay inline boxes of no size", async ({ page }) => {
    await open(page, STYLED_PAGE);

    const sentences = await page.locator("#table .visually-hidden").evaluateAll((spans) =>
      spans.map((span) => {
        const style = getComputedStyle(span);
        const box = span.getBoundingClientRect();
        return {
          text: span.textContent ?? "",
          display: style.display,
          position: style.position,
          float: style.float,
          area: box.width * box.height,
        };
      }),
    );

    expect(sentences.length).toBeGreaterThan(40);
    expect(
      sentences.filter(
        ({ display, position, float, area }) =>
          display !== "inline" || position !== "static" || float !== "none" || area !== 0,
      ),
    ).toEqual([]);
  });

  // NVDA in Firefox read "from(part of Array)" when the sentence was positioned absolutely,
  // because the space before it became trailing white space and collapsed. The space must keep
  // its width, so the rendered text keeps it.
  test("keep the space before a row header's part-of text", async ({ page }) => {
    await open(page, STYLED_PAGE);

    const headers = await page.locator("#table tbody th").evaluateAll((cells) =>
      cells
        .filter((cell) => cell.querySelector(".visually-hidden") !== null)
        .map((cell) => {
          const space = [...cell.childNodes].find(
            (node) => node.nodeType === Node.TEXT_NODE && node.textContent === " ",
          );
          const range = document.createRange();
          if (space !== undefined) range.selectNodeContents(space);
          return {
            text: (cell as HTMLElement).innerText,
            spaceWidth: space === undefined ? 0 : range.getBoundingClientRect().width,
          };
        }),
    );

    expect(headers.length).toBeGreaterThan(0);
    for (const header of headers) {
      expect(header.text, header.text).toMatch(/^\S+ \(part of /);
      expect(header.spaceWidth, header.text).toBeGreaterThan(0);
    }
  });

  // Orca in Firefox stopped opening disclosures it reached by table navigation while the
  // sentence sat outside the flow of its summary. Each sentence stays inside its summary's box.
  test("stay inside their own summary", async ({ page }) => {
    await open(page, STYLED_PAGE);

    const strays = await page.locator("#table summary").evaluateAll((summaries) =>
      summaries.flatMap((summary) => {
        const sentence = summary.querySelector(".visually-hidden") as Element;
        const own = summary.getBoundingClientRect();
        const box = sentence.getBoundingClientRect();
        const inside =
          box.left >= own.left - 1 &&
          box.right <= own.right + 1 &&
          box.top >= own.top - 1 &&
          box.bottom <= own.bottom + 1;
        return inside ? [] : [sentence.textContent ?? ""];
      }),
    );

    expect(strays).toEqual([]);
  });

  test("stay inside their own cell when the table scrolls", async ({ page }) => {
    await open(page, STYLED_PAGE);
    // A narrow container, so the table is wider than its scroll region.
    await page.locator("#table").evaluate((table) => {
      (table as HTMLElement).style.inlineSize = "220px";
    });
    const scrolled = await page.locator("#table .bcd-scroller").evaluate((scroller) => {
      scroller.scrollLeft = 150;
      return scroller.scrollLeft;
    });
    expect(scrolled).toBeGreaterThan(0);

    const strays = await page.locator("#table td").evaluateAll((cells) =>
      cells.flatMap((cell) => {
        const span = cell.querySelector(".visually-hidden") as Element;
        const own = cell.getBoundingClientRect();
        const box = span.getBoundingClientRect();
        const inside =
          box.left >= own.left - 1 &&
          box.right <= own.right + 1 &&
          box.top >= own.top - 1 &&
          box.bottom <= own.bottom + 1;
        return inside ? [] : [`${cell.textContent?.trim().slice(0, 30)}`];
      }),
    );
    expect(strays).toEqual([]);
  });
});

test.describe("without the stylesheet", () => {
  test("hides each cell's icon and version, and shows its sentence", async ({ page }) => {
    await open(page, UNSTYLED_PAGE);

    const cells = await page.locator("#table td").evaluateAll((elements) =>
      elements.map((cell) => {
        const compact = cell.querySelector('[aria-hidden="true"]') as Element;
        const sentence = cell.querySelector(".visually-hidden") as Element;
        return {
          compactDisplay: getComputedStyle(compact).display,
          sentenceWidth: sentence.getBoundingClientRect().width,
        };
      }),
    );

    expect(cells).toHaveLength(42);
    for (const cell of cells) {
      expect(cell.compactDisplay).toBe("none");
      expect(cell.sentenceWidth).toBeGreaterThan(1);
    }
  });

  test("leaves the fallback visible next to the table, as the owner accepted", async ({ page }) => {
    await open(page, UNSTYLED_PAGE);

    await expect(page.locator("#table > p")).toBeVisible();
    await expect(page.locator("#table table")).toBeVisible();
  });

  test("has no axe violations on the loaded table", async ({ page }) => {
    await open(page, UNSTYLED_PAGE);
    await expectNoViolations(page);
  });
});
