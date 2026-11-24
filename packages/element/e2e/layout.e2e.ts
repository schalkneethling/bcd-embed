// The responsive layout of the base stylesheet (issue #201) in Chromium, Firefox, and WebKit: the
// scroll region and the sticky feature column in a narrow container, no sideways scroll in a wide
// one, table display values at every width, sticky borders, no query container, print, the
// keyboard, and axe. The page links the built `dist/base.css` (e2e/global-setup.ts builds it).
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const STYLED_PAGE = "/e2e/fixtures/data-mode.html";

/** The cells of the feature column: the feature header, which spans both header rows, and each row header. */
const FEATURE_COLUMN = "#table thead tr:first-child > :first-child, #table tbody th";

const open = async (page: Page): Promise<void> => {
  await page.goto(STYLED_PAGE);
  await page.locator("#table[loaded] table").waitFor();
};

/** Sets the inline size of the element, which the scroll region fills. */
const setContainerSize = (page: Page, size: string) =>
  page.locator("#table").evaluate((table, wanted) => {
    (table as HTMLElement).style.inlineSize = wanted;
  }, size);

/**
 * Shows six targets instead of the fixture's three, so the table is wider than a narrow container.
 * The three the payload does not describe show "No data" in every cell.
 */
const showSixTargets = async (page: Page): Promise<void> => {
  await page.locator("#table").evaluate((table) => {
    table.setAttribute("browsers", "chrome edge firefox opera safari nodejs");
  });
  await expect(page.locator("#table thead tr:nth-child(2) th")).toHaveCount(6);
};

/** How far the region can scroll on each axis. */
const overflowOf = (page: Page) =>
  page.locator("#table .bcd-scroller").evaluate((scroller) => ({
    inline: scroller.scrollWidth - scroller.clientWidth,
    block: scroller.scrollHeight - scroller.clientHeight,
  }));

/**
 * Scrolls the region to its inline end and returns how far it moved. In right-to-left text the
 * inline end is on the left, where scrollLeft counts down from 0.
 */
const scrollToEnd = (page: Page) =>
  page.locator("#table .bcd-scroller").evaluate((scroller) => {
    const rtl = getComputedStyle(scroller).direction === "rtl";
    scroller.scrollLeft = rtl ? -scroller.scrollWidth : scroller.scrollWidth;
    return Math.abs(scroller.scrollLeft);
  });

/**
 * How close the painted pixels on each physical side of an element come to its computed border
 * colour on that side: 0 is the colour exactly, and white on that border colour is more than 300
 * away. It reads a screenshot, so it sees what the engine painted, not what it computed: Firefox
 * computes a border it does not paint on a sticky cell with border-collapse: collapse (bug
 * 1727594). Each side is a strip 3 CSS pixels across, centred on the edge, so rounding a fractional
 * edge to a pixel cannot miss it.
 */
const paintedBorders = async (page: Page, selector: string) => {
  const cell = page.locator(selector).first();
  const box = await cell.boundingBox();
  if (box === null) throw new Error(`${selector} has no box`);
  const margin = 4;
  const clip = {
    x: box.x - margin,
    y: box.y - margin,
    width: box.width + 2 * margin,
    height: box.height + 2 * margin,
  };
  const png = (await page.screenshot({ clip })).toString("base64");
  const colours = await cell.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      left: style.borderLeftColor,
      right: style.borderRightColor,
      top: style.borderTopColor,
      bottom: style.borderBottomColor,
    };
  });

  return page.evaluate(
    async ({ png: data, outer, inner, wanted }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d") as CanvasRenderingContext2D;
      context.drawImage(image, 0, 0);
      const scale = image.naturalWidth / outer.width;
      const channels = (colour: string) => (colour.match(/\d+/g) ?? []).slice(0, 3).map(Number);
      const nearest = (colour: string, x0: number, y0: number, x1: number, y1: number) => {
        const [red = 0, green = 0, blue = 0] = channels(colour);
        const pixels = context.getImageData(
          Math.round(x0 * scale),
          Math.round(y0 * scale),
          Math.max(1, Math.round((x1 - x0) * scale)),
          Math.max(1, Math.round((y1 - y0) * scale)),
        ).data;
        let best = Number.POSITIVE_INFINITY;
        for (let index = 0; index < pixels.length; index += 4) {
          const distance =
            Math.abs((pixels[index] ?? 0) - red) +
            Math.abs((pixels[index + 1] ?? 0) - green) +
            Math.abs((pixels[index + 2] ?? 0) - blue);
          best = Math.min(best, distance);
        }
        return best;
      };
      const { left, top, right, bottom } = inner;
      const middleX = (left + right) / 2;
      const middleY = (top + bottom) / 2;
      return {
        left: nearest(wanted.left, left - 1.5, middleY, left + 1.5, middleY + 1),
        right: nearest(wanted.right, right - 1.5, middleY, right + 1.5, middleY + 1),
        top: nearest(wanted.top, middleX, top - 1.5, middleX + 1, top + 1.5),
        bottom: nearest(wanted.bottom, middleX, bottom - 1.5, middleX + 1, bottom + 1.5),
      };
    },
    {
      png,
      outer: clip,
      inner: { left: margin, top: margin, right: margin + box.width, bottom: margin + box.height },
      wanted: colours,
    },
  );
};

/** The physical border widths of the first element that matches `selector`. */
const borderWidths = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        left: style.borderLeftWidth,
        right: style.borderRightWidth,
        top: style.borderTopWidth,
        bottom: style.borderBottomWidth,
      };
    });

const expectNoViolations = async (page: Page): Promise<void> => {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(
    violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) })),
  ).toEqual([]);
};

test.describe("a container 30em wide", () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await showSixTargets(page);
    await setContainerSize(page, "30em");
  });

  test("scrolls the region sideways only", async ({ page }) => {
    const overflow = await overflowOf(page);

    expect(overflow.inline).toBeGreaterThan(0);
    expect(overflow.block).toBeLessThanOrEqual(0);
  });

  test("keeps the feature column in view, with nothing from other columns showing through it", async ({
    page,
  }) => {
    expect(await scrollToEnd(page)).toBeGreaterThan(0);

    const cells = await page.evaluate((selector) => {
      const scroller = document.querySelector("#table .bcd-scroller") as Element;
      const edge = scroller.getBoundingClientRect().left + scroller.clientLeft;
      return [...document.querySelectorAll(selector)].map((cell) => {
        // elementFromPoint sees only the viewport, so the page scrolls each cell into it first.
        const top = cell.getBoundingClientRect().top + window.scrollY;
        window.scrollTo(0, top - 100);
        const box = cell.getBoundingClientRect();
        // The middle of the cell, and a point just inside its inline end, where the content of the
        // next column would show first.
        const points = [
          [box.left + box.width / 2, box.top + box.height / 2],
          [box.right - 3, box.top + box.height / 2],
        ] as const;
        return {
          text: cell.textContent?.trim().slice(0, 30) ?? "",
          offset: box.left - edge,
          position: getComputedStyle(cell).position,
          background: getComputedStyle(cell).backgroundColor,
          covered: points.every(([x, y]) => {
            const hit = document.elementFromPoint(x, y);
            return hit !== null && cell.contains(hit);
          }),
        };
      });
    }, FEATURE_COLUMN);

    expect(cells.length).toBe(15);
    for (const cell of cells) {
      expect(cell.position, cell.text).toBe("sticky");
      expect(Math.abs(cell.offset), cell.text).toBeLessThanOrEqual(1);
      expect(cell.background, cell.text).not.toBe("rgba(0, 0, 0, 0)");
      expect(cell.covered, cell.text).toBe(true);
    }
  });

  test("keeps the borders of the feature column visible while the table scrolls", async ({
    page,
  }) => {
    expect(await scrollToEnd(page)).toBeGreaterThan(0);

    const sides = await paintedBorders(page, "#table tbody th");
    expect(sides.left).toBeLessThanOrEqual(30);
    expect(sides.right).toBeLessThanOrEqual(30);
    expect(sides.top).toBeLessThanOrEqual(30);
    expect(sides.bottom).toBeLessThanOrEqual(30);
  });

  test("scrolls the focused region with the arrow keys, and Tab reaches the region", async ({
    page,
  }) => {
    await page.locator("h1").click();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.className)).toBe("bcd-scroller");

    // The key is held for 200 ms, as a person holds it. WebKit animates keyboard scrolling and
    // stops when the key comes up, so a press with no delay often moved the region by nothing.
    await page.keyboard.press("ArrowRight", { delay: 200 });
    await expect
      .poll(() => page.locator("#table .bcd-scroller").evaluate((scroller) => scroller.scrollLeft))
      .toBeGreaterThan(0);
  });

  test("has no axe violations, at the start and scrolled to the end", async ({ page }) => {
    await expectNoViolations(page);
    await scrollToEnd(page);
    await expectNoViolations(page);
  });
});

test.describe("a container 60em wide", () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await setContainerSize(page, "60em");
  });

  test("scrolls in no direction", async ({ page }) => {
    const overflow = await overflowOf(page);

    expect(overflow.inline).toBeLessThanOrEqual(0);
    expect(overflow.block).toBeLessThanOrEqual(0);
  });

  test("keeps the feature column sticky, where it has nothing to stick against", async ({
    page,
  }) => {
    const positions = await page
      .locator(FEATURE_COLUMN)
      .evaluateAll((cells) => [...new Set(cells.map((cell) => getComputedStyle(cell).position))]);

    expect(positions).toEqual(["sticky"]);
  });

  test("has no axe violations", async ({ page }) => {
    await expectNoViolations(page);
  });
});

test("keeps the table display values at every width", async ({ page }) => {
  await open(page);
  const expected = {
    table: "table",
    caption: "table-caption",
    colgroup: "table-column-group",
    thead: "table-header-group",
    tbody: "table-row-group",
    tr: "table-row",
    th: "table-cell",
    td: "table-cell",
  };

  for (const size of ["15em", "30em", "39.9em", "40em", "60em", "100em"]) {
    await setContainerSize(page, size);
    const displays = await page
      .locator("#table table")
      .evaluate(
        (table, tags) =>
          Object.fromEntries(
            tags.map((tag) => [
              tag,
              [
                ...new Set(
                  [table, ...table.querySelectorAll(tag)]
                    .filter((element) => element.localName === tag)
                    .map((element) => getComputedStyle(element).display),
                ),
              ].join(" "),
            ]),
          ),
        Object.keys(expected),
      );
    expect(displays, size).toEqual(expected);
  }
});

// Many CSS resets make every svg a block. In a layer the page orders before bcd-embed.base, such
// a reset broke each compact status into three lines: the disclosure marker, the icon, and the
// version. An inline box that holds a block is split around it, so a status on one line has one
// box.
test("keeps each compact status on one line under a layered reset that makes svg a block", async ({
  page,
}) => {
  await page.goto(STYLED_PAGE);
  await page.evaluate(() => {
    const reset = document.createElement("style");
    reset.textContent =
      "@layer page-reset { svg { display: block; block-size: auto; max-inline-size: 100%; } }";
    document.head.prepend(reset);
  });
  await page.locator("#table[loaded] table").waitFor();

  const statuses = await page.locator('#table td [aria-hidden="true"]').evaluateAll((spans) =>
    spans.map((span) => ({
      icon: getComputedStyle(span.querySelector("svg") as Element).display,
      boxes: span.getClientRects().length,
    })),
  );

  expect(statuses.length).toBeGreaterThan(0);
  expect(statuses.filter(({ icon, boxes }) => icon !== "inline" || boxes !== 1)).toEqual([]);
});

// The history list takes no width of its own (#204), so without a floor the table squeezed the
// support columns to their compact status, and an open cell's notes wrapped every word or two.
test("keeps every data column at least 12em wide, and scrolls the region instead", async ({
  page,
}) => {
  await open(page);
  await showSixTargets(page);
  await setContainerSize(page, "50em");

  const narrow = await page.locator("#table tbody td").evaluateAll((cells) =>
    cells
      .map(
        (cell) =>
          cell.getBoundingClientRect().width / Number.parseFloat(getComputedStyle(cell).fontSize),
      )
      // Sub-pixel rounding can put a 12em cell a hair under 12.
      .filter((ems) => ems < 11.99),
  );

  expect(narrow).toEqual([]);
  expect((await overflowOf(page)).inline).toBeGreaterThan(0);
});

test("needs no scrolling in two directions in a 320 CSS pixel viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await open(page);
  await showSixTargets(page);

  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  const region = await overflowOf(page);

  // The page scrolls only down, and the region only sideways.
  expect(pageOverflow).toBeLessThanOrEqual(0);
  expect(region.inline).toBeGreaterThan(0);
  expect(region.block).toBeLessThanOrEqual(0);
});

// A query container applies style containment, and with it Chromium 159 laid out the table in time
// that grew with the square of the number of <summary> elements: 51 ms became 249 ms at 314 rows,
// and a synthetic 2,000-row table took about 10 seconds instead of 0.6 (Document 3 section 5,
// tests/styles/containment.test.ts). So nothing around the table may apply style containment.
test("applies style containment to no element around the table", async ({ page }) => {
  await open(page);

  const containers = await page.locator("#table table").evaluate((table) => {
    const found: string[] = [];
    for (let element: Element | null = table; element !== null; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (
        style.containerType !== "normal" ||
        /style|strict|content/.test(style.contain) ||
        style.contentVisibility !== "visible"
      ) {
        found.push(
          `${element.localName}: container-type ${style.containerType}, contain ${style.contain}, content-visibility ${style.contentVisibility}`,
        );
      }
    }
    return found;
  });

  expect(containers).toEqual([]);
});

/**
 * Whether each sticky cell in view covers the cells that scroll beneath it: a point in its middle
 * and one just inside its inline end both hit the cell itself.
 */
const stickyCellsCover = (page: Page) =>
  page.evaluate((selector) => {
    const rtl = getComputedStyle(document.querySelector("#table") as Element).direction === "rtl";
    return [...document.querySelectorAll(selector)].map((cell) => {
      // elementFromPoint sees only the viewport, so the page scrolls each cell into it first.
      window.scrollTo(0, cell.getBoundingClientRect().top + window.scrollY - 100);
      const box = cell.getBoundingClientRect();
      const middleY = box.top + box.height / 2;
      const end = rtl ? box.left + 3 : box.right - 3;
      return [box.left + box.width / 2, end].every((x) => {
        const hit = document.elementFromPoint(x, middleY);
        return hit !== null && cell.contains(hit);
      });
    });
  }, FEATURE_COLUMN);

test.describe("a long feature name, nested five levels deep, in a 320 CSS pixel viewport", () => {
  const LONG_NAME = "anExtremelyLongIdentifierWithNoBreakOpportunityAnywhereInsideIt";

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await open(page);
    // A family of six rows under `api.Deep`, the last at depth 5 with the long name. The other
    // fields come from the fixture's first feature, and no target has data.
    await page.evaluate((longName) => {
      const { payload } = window.bcdFixture;
      const [template] = payload.features;
      if (template === undefined) throw new Error("The fixture has no feature");
      const keys = ["Deep", "a", "b", "c", "d", longName].map((_, depth, names) =>
        ["api", ...names.slice(0, depth + 1)].join("."),
      );
      const deep = keys.map((key, depth) => ({
        ...template,
        key,
        name: key.split(".").at(-1) ?? key,
        depth,
        support: {},
      }));
      const table = document.querySelector("#table") as HTMLElementTagNameMap["bcd-compat-table"];
      table.data = { ...payload, features: [...payload.features, ...deep] };
    }, LONG_NAME);
    await showSixTargets(page);
    await expect(page.locator("#table .bcd-feature-depth-5")).toHaveCount(1);
  });

  test("lets every column scroll into view beside the sticky column, uncovered", async ({
    page,
  }) => {
    const columns = await page.evaluate(() => {
      const scroller = document.querySelector("#table .bcd-scroller") as HTMLElement;
      const row = document.querySelector("#table .bcd-feature-depth-5")?.closest("tr");
      if (row === null || row === undefined) throw new Error("No depth-5 row");
      const sticky = row.querySelector("th") as Element;
      const headers = [...document.querySelectorAll("#table thead tr:nth-child(2) th")];
      const cells = [...row.querySelectorAll("td"), ...headers];
      return cells.map((cell) => {
        scroller.scrollLeft = 0;
        // Scrolls the cell's start to the sticky column's end, as far as the region allows.
        scroller.scrollLeft =
          cell.getBoundingClientRect().left - sticky.getBoundingClientRect().right;
        window.scrollTo(0, cell.getBoundingClientRect().top + window.scrollY - 100);
        const box = cell.getBoundingClientRect();
        const stickyEnd = sticky.getBoundingClientRect().right;
        const regionEnd =
          scroller.getBoundingClientRect().left + scroller.clientLeft + scroller.clientWidth;
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return {
          text: cell.textContent?.trim().slice(0, 20) ?? "",
          clearOfSticky: box.left >= stickyEnd - 1,
          insideRegion: box.right <= regionEnd + 1,
          uncovered: hit !== null && cell.contains(hit),
        };
      });
    });

    expect(columns).toHaveLength(12);
    for (const column of columns) {
      expect(column, column.text).toMatchObject({
        clearOfSticky: true,
        insideRegion: true,
        uncovered: true,
      });
    }
  });

  test("keeps the whole name inside its row header, and the sticky cells covering", async ({
    page,
  }) => {
    const name = await page.locator("#table .bcd-feature-depth-5").evaluate((header) => {
      const code = header.querySelector("code") as Element;
      const own = header.getBoundingClientRect();
      const lines = [...code.getClientRects()];
      return {
        text: code.textContent,
        lines: lines.length,
        inside: lines.every((line) => line.left >= own.left - 0.5 && line.right <= own.right + 0.5),
      };
    });

    expect(name.text).toBe(LONG_NAME);
    expect(name.inside).toBe(true);
    expect(name.lines).toBeGreaterThan(1);
    await scrollToEnd(page);
    expect(await stickyCellsCover(page)).not.toContain(false);
  });
});

test.describe("right-to-left text in a container 30em wide", () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await page.locator("main").evaluate((main) => {
      main.setAttribute("dir", "rtl");
    });
    await showSixTargets(page);
    await setContainerSize(page, "30em");
  });

  test("sticks the feature column to the right of the region, covering what scrolls beneath it", async ({
    page,
  }) => {
    expect(await scrollToEnd(page)).toBeGreaterThan(0);

    const offsets = await page.evaluate((selector) => {
      const scroller = document.querySelector("#table .bcd-scroller") as HTMLElement;
      const edge =
        scroller.getBoundingClientRect().left + scroller.clientLeft + scroller.clientWidth;
      return [...document.querySelectorAll(selector)].map(
        (cell) => edge - cell.getBoundingClientRect().right,
      );
    }, FEATURE_COLUMN);

    expect(offsets).toHaveLength(15);
    for (const offset of offsets) expect(Math.abs(offset)).toBeLessThanOrEqual(1);
    expect(await stickyCellsCover(page)).not.toContain(false);
  });

  test("mirrors the borders, and keeps the sticky cell's borders painted while it scrolls", async ({
    page,
  }) => {
    // A support cell draws its inline-end border, which is on the left in right-to-left text.
    expect(await borderWidths(page, "#table tbody td")).toEqual({
      left: "1px",
      right: "0px",
      top: "0px",
      bottom: "1px",
    });
    expect(await borderWidths(page, "#table tbody th")).toEqual({
      left: "1px",
      right: "1px",
      top: "0px",
      bottom: "1px",
    });

    expect(await scrollToEnd(page)).toBeGreaterThan(0);
    const sides = await paintedBorders(page, "#table tbody th");
    expect(sides.left).toBeLessThanOrEqual(30);
    expect(sides.right).toBeLessThanOrEqual(30);
    expect(sides.top).toBeLessThanOrEqual(30);
    expect(sides.bottom).toBeLessThanOrEqual(30);
  });

  test("has no axe violations", async ({ page }) => {
    await expectNoViolations(page);
  });
});

test.describe("forced colours in a container 30em wide", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await open(page);
    // Matching the media query is not enough: WebKit matches it under this emulation but keeps
    // author colours, so the test runs only where an author colour is really replaced. On 21
    // November 2026, Chromium 159 and Firefox 159 replaced it, and WebKit 27.2 did not.
    const forced = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.backgroundColor = "rgb(1, 2, 3)";
      document.body.append(probe);
      const replaced = getComputedStyle(probe).backgroundColor !== "rgb(1, 2, 3)";
      probe.remove();
      return matchMedia("(forced-colors: active)").matches && replaced;
    });
    test.skip(!forced, "This engine does not force colours under Playwright 1.65.1's emulation");
    await showSixTargets(page);
    await setContainerSize(page, "30em");
  });

  test("paints the sticky cells with the Canvas colour and keeps their borders visible", async ({
    page,
  }) => {
    expect(await scrollToEnd(page)).toBeGreaterThan(0);

    const colours = await page
      .locator("#table tbody th")
      .first()
      .evaluate((cell) => {
        const probe = document.createElement("div");
        probe.style.backgroundColor = "Canvas";
        document.body.append(probe);
        const canvas = getComputedStyle(probe).backgroundColor;
        probe.remove();
        const style = getComputedStyle(cell);
        return { canvas, background: style.backgroundColor, border: style.borderBottomColor };
      });
    expect(colours.background).toBe(colours.canvas);
    expect(colours.border).not.toBe(colours.canvas);

    const sides = await paintedBorders(page, "#table tbody th");
    expect(sides.left).toBeLessThanOrEqual(30);
    expect(sides.right).toBeLessThanOrEqual(30);
    expect(sides.top).toBeLessThanOrEqual(30);
    expect(sides.bottom).toBeLessThanOrEqual(30);
    expect(await stickyCellsCover(page)).not.toContain(false);
  });
});

test.describe("print", () => {
  test("turns sticky positioning off, lets the region show the whole table, and keeps the header row in a thead", async ({
    page,
  }) => {
    await open(page);
    // A narrow container, where the screen layout makes the feature column sticky.
    await setContainerSize(page, "30em");
    await page.emulateMedia({ media: "print" });

    const printed = await page.locator("#table").evaluate((table) => {
      const scroller = table.querySelector(".bcd-scroller") as Element;
      const element = table.querySelector("table") as HTMLTableElement;
      return {
        positions: [
          ...new Set(
            [...table.querySelectorAll("thead tr:first-child > :first-child, tbody th")].map(
              (cell) => getComputedStyle(cell).position,
            ),
          ),
        ],
        overflowX: getComputedStyle(scroller).overflowX,
        overflowY: getComputedStyle(scroller).overflowY,
        headerRows: element.tHead?.rows.length ?? 0,
        columnHeadersOutsideThead: element.querySelectorAll('th[scope="col"]:not(thead th)').length,
      };
    });

    expect(printed).toEqual({
      positions: ["static"],
      overflowX: "visible",
      overflowY: "visible",
      headerRows: 2,
      columnHeadersOutsideThead: 0,
    });
  });
});
