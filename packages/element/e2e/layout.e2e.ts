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

/** Scrolls the region to its inline end and returns how far it moved. */
const scrollToEnd = (page: Page) =>
  page.locator("#table .bcd-scroller").evaluate((scroller) => {
    scroller.scrollLeft = scroller.scrollWidth;
    return scroller.scrollLeft;
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
    const cell = page.locator("#table tbody th").first();
    const box = await cell.boundingBox();
    if (box === null) throw new Error("The first row header has no box");
    // One border-width strip on each side of the cell, read from a screenshot so the test sees
    // what the engine painted, not what it computed. Firefox computes a border it does not paint
    // on a sticky cell with border-collapse: collapse (bug 1727594).
    const margin = 4;
    const clip = {
      x: box.x - margin,
      y: box.y - margin,
      width: box.width + 2 * margin,
      height: box.height + 2 * margin,
    };
    const shot = (await page.screenshot({ clip })).toString("base64");

    const sides = await page.evaluate(
      async ({ png, inner, outer }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${png}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d") as CanvasRenderingContext2D;
        context.drawImage(image, 0, 0);
        const scale = image.naturalWidth / outer.width;
        const probe = document.createElement("div");
        probe.style.color = getComputedStyle(
          document.querySelector("#table tbody th") as Element,
        ).borderInlineEndColor;
        document.body.append(probe);
        const [red, green, blue] = (getComputedStyle(probe).color.match(/\d+/g) ?? []).map(Number);
        probe.remove();
        // The smallest distance from the border colour among the pixels of a strip 3 CSS pixels
        // across, centred on the edge, so rounding a fractional edge to a pixel cannot miss it.
        const nearest = (x0: number, y0: number, x1: number, y1: number): number => {
          const data = context.getImageData(
            Math.round(x0 * scale),
            Math.round(y0 * scale),
            Math.max(1, Math.round((x1 - x0) * scale)),
            Math.max(1, Math.round((y1 - y0) * scale)),
          ).data;
          let best = Number.POSITIVE_INFINITY;
          for (let index = 0; index < data.length; index += 4) {
            const distance =
              Math.abs((data[index] ?? 0) - (red ?? 0)) +
              Math.abs((data[index + 1] ?? 0) - (green ?? 0)) +
              Math.abs((data[index + 2] ?? 0) - (blue ?? 0));
            best = Math.min(best, distance);
          }
          return best;
        };
        const { left, top, right, bottom } = inner;
        const middleX = (left + right) / 2;
        const middleY = (top + bottom) / 2;
        return {
          inlineStart: nearest(left - 1.5, middleY, left + 1.5, middleY + 1),
          inlineEnd: nearest(right - 1.5, middleY, right + 1.5, middleY + 1),
          blockStart: nearest(middleX, top - 1.5, middleX + 1, top + 1.5),
          blockEnd: nearest(middleX, bottom - 1.5, middleX + 1, bottom + 1.5),
        };
      },
      {
        png: shot,
        outer: clip,
        inner: {
          left: margin,
          top: margin,
          right: margin + box.width,
          bottom: margin + box.height,
        },
      },
    );

    // A distance of 0 is the border colour exactly. White is more than 300 away from it.
    expect(sides.inlineStart).toBeLessThanOrEqual(30);
    expect(sides.inlineEnd).toBeLessThanOrEqual(30);
    expect(sides.blockStart).toBeLessThanOrEqual(30);
    expect(sides.blockEnd).toBeLessThanOrEqual(30);
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

// A query container applies style containment, and with it Chromium 159 laid out a table with
// 8,000 <summary> elements in about 10 seconds instead of 0.6, a cost that grew with the square of
// the number of rows (Document 3 section 5). So nothing around the table may become one.
test("makes no element around the table a query container", async ({ page }) => {
  await open(page);

  const containers = await page.locator("#table table").evaluate((table) => {
    const found: string[] = [];
    for (let element: Element | null = table; element !== null; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (style.containerType !== "normal" || /style|strict|content/.test(style.contain)) {
        found.push(
          `${element.localName}: container-type ${style.containerType}, contain ${style.contain}`,
        );
      }
    }
    return found;
  });

  expect(containers).toEqual([]);
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
