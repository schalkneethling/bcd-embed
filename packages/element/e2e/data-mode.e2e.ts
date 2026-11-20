// The element in data mode, in Chromium, Firefox, and WebKit (issue #198): axe on each state, the
// fallback rule's computed styles, the keyboard path, and the render time of a large table. The
// page links the built base stylesheet, which holds the fallback rule (issue #200).
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const FIXTURE_PAGE = "/e2e/fixtures/data-mode.html";

const openFixture = async (page: Page): Promise<void> => {
  await page.goto(FIXTURE_PAGE);
  await page.locator("#table[loaded] table").waitFor();
};

// Listing each violation's rule id and the elements it flags makes a failure name the problem.
const expectNoViolations = async (page: Page): Promise<void> => {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(
    violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) })),
  ).toEqual([]);
};

/** The computed `display` and `visibility` of the first element that matches `selector`. */
const styleOf = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const { display, visibility } = getComputedStyle(element);
      return { display, visibility };
    });

test.describe("the loaded table", () => {
  test("has no axe violations, closed and with every disclosure open", async ({ page }) => {
    await openFixture(page);
    await expect(page.locator("#table tbody tr")).toHaveCount(14);
    await expectNoViolations(page);

    await page
      .locator("#table details")
      .evaluateAll((disclosures) =>
        disclosures.forEach((disclosure) => disclosure.setAttribute("open", "")),
      );
    await expect(page.locator("#table details[open]")).toHaveCount(5);
    await expectNoViolations(page);
  });

  test("is a region named by its caption", async ({ page }) => {
    await openFixture(page);

    await expect(
      page.getByRole("region", { name: "Browser compatibility: fixture.adversarial-v1" }),
    ).toBeVisible();
    await expect(
      page.getByRole("table", { name: "Browser compatibility: fixture.adversarial-v1" }),
    ).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Desktop" })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: "from (part of Array)" })).toBeVisible();
  });

  test("stops the Tab key on the region and the five disclosures only, and toggles with the keyboard", async ({
    page,
  }) => {
    await openFixture(page);
    const describeFocus = () =>
      page.evaluate(() => {
        const active = document.activeElement;
        if (active === null || active === document.body) return "body";
        return active.localName === "summary"
          ? `summary: ${active.querySelector(".visually-hidden")?.textContent ?? ""}`
          : `${active.localName}: ${active.getAttribute("role") ?? ""}`;
      });

    const stops: string[] = [];
    for (let presses = 0; presses < 6; presses += 1) {
      await page.keyboard.press("Tab");
      stops.push(await describeFocus());
    }

    expect(stops).toEqual([
      "div: region",
      "summary: Supported since Chrome 46. History for fit-content in Chrome",
      "summary: Supported since Chrome 18. History for abort in Chrome",
      "summary: Supported since Chrome 37 behind a flag. Flag details for AudioTrackList in Chrome",
      "summary: Supported from Chrome 11.1, then removed in Chrome 12.1. History and notes for removed_partial in Chrome",
      "summary: Supported since Chrome 20. Notes for notes_only in Chrome",
    ]);

    // The last stop is the notes_only disclosure. Enter opens it, Space closes it, and focus
    // stays on the summary both times.
    const disclosure = page.locator("#table details").last();
    await page.keyboard.press("Enter");
    await expect(disclosure).toHaveAttribute("open", "");
    await expect(disclosure.locator("li").last()).toBeVisible();
    expect(await describeFocus()).toBe(stops[5]);
    await page.keyboard.press("Space");
    await expect(disclosure).not.toHaveAttribute("open");
    expect(await describeFocus()).toBe(stops[5]);
  });
});

test.describe("fallback content", () => {
  test("is hidden by the stylesheet rule while the table shows, and visible again without one", async ({
    page,
  }) => {
    await openFixture(page);

    expect(await styleOf(page, "#table > p")).toEqual({ display: "none", visibility: "hidden" });
    expect(await styleOf(page, "#table")).toMatchObject({ visibility: "hidden" });
    expect(await styleOf(page, "#table > .bcd-render-container")).toMatchObject({
      visibility: "visible",
    });
    await expect(page.locator("#table > p")).toBeHidden();
    await expect(page.locator("#table table")).toBeVisible();

    await page.locator("#table").evaluate((table: HTMLElementTagNameMap["bcd-compat-table"]) => {
      table.data = null;
    });

    await expect(page.locator("#table table")).toHaveCount(0);
    await expect(page.locator("#table")).not.toHaveAttribute("loaded");
    expect(await styleOf(page, "#table > p")).toEqual({ display: "block", visibility: "visible" });
    await expect(page.locator("#table > p")).toBeVisible();
    await expectNoViolations(page);
  });

  test("shows again after an invalid payload, with one bcd-error and no axe violations", async ({
    page,
  }) => {
    await openFixture(page);

    const errors = await page
      .locator("#table")
      .evaluate(async (table: HTMLElementTagNameMap["bcd-compat-table"]) => {
        const details: unknown[] = [];
        table.addEventListener("bcd-error", (event) => details.push(event.detail));
        table.data = { contract: "1.1.0" } as unknown as typeof table.data;
        // The element updates in a microtask, and a task comes after every microtask.
        await new Promise((resolve) => setTimeout(resolve, 0));
        return details;
      });

    expect(errors).toEqual([{ mode: "data", reason: "invalid-payload", status: null, code: null }]);
    await expect(page.locator("#table")).not.toHaveAttribute("loaded");
    await expect(page.locator("#table > p")).toBeVisible();
    await expect(page.locator("#table table")).toHaveCount(0);
    await expectNoViolations(page);
  });

  test("is replaced by the element's own sentence when the author gave none", async ({ page }) => {
    await openFixture(page);

    await page.evaluate(async () => {
      const table = document.createElement("bcd-compat-table");
      table.id = "no-fallback";
      document.querySelector("main")?.append(table);
      table.data = { contract: "1.1.0" } as unknown as typeof table.data;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await expect(page.locator("#no-fallback p.bcd-error")).toHaveText(
      "Browser compatibility data could not be shown.",
    );
    await expect(page.locator("#no-fallback p.bcd-error")).toBeVisible();
    await expect(page.locator("#no-fallback")).not.toHaveAttribute("loaded");
    await expectNoViolations(page);
  });

  test("hides a bare text fallback too, and leaves no space for it", async ({ page }, testInfo) => {
    await openFixture(page);

    const measured = await page.evaluate(async () => {
      const table = document.createElement("bcd-compat-table");
      table.id = "text-fallback";
      table.setAttribute("browsers", "chrome");
      table.append("Bare text fallback");
      document.querySelector("main")?.append(table);
      table.data = window.bcdFixture.payload;
      await new Promise((resolve) => setTimeout(resolve, 0));
      const container = table.querySelector(".bcd-render-container");
      return {
        visibleText: table.innerText,
        hostVisibility: getComputedStyle(table).visibility,
        tableVisibility: getComputedStyle(table.querySelector("table") as Element).visibility,
        hostHeight: table.getBoundingClientRect().height,
        containerHeight: container?.getBoundingClientRect().height ?? 0,
      };
    });

    expect(measured.hostVisibility).toBe("hidden");
    expect(measured.tableVisibility).toBe("visible");
    expect(measured.visibleText).not.toContain("Bare text fallback");
    expect(measured.visibleText).toContain("Supported since Chrome 46");
    // The hidden text keeps its line box, which shows as the difference between the height of a
    // block around the element and the height of the render container.
    const residual = await page.evaluate(() => {
      const table = document.querySelector("#text-fallback") as HTMLElement;
      const container = table.querySelector(".bcd-render-container") as HTMLElement;
      const wrapper = document.createElement("div");
      table.before(wrapper);
      wrapper.append(table);
      return wrapper.getBoundingClientRect().height - container.getBoundingClientRect().height;
    });
    testInfo.annotations.push({
      type: "residual-space",
      description: `${residual.toFixed(1)} px of blank space remain for a one-line text fallback`,
    });
    console.log(`[${testInfo.project.name}] residual space of a text fallback: ${residual} px`);
    // The base stylesheet places the text in a grid row of zero height (issue #200 review).
    expect(Math.abs(residual)).toBeLessThanOrEqual(0.5);
  });
});

test.describe("notes", () => {
  test("never run markup from a note", async ({ page }) => {
    await openFixture(page);
    const note = '<img src=x onerror="window.__x=1"><script>window.__x=2</script>';

    await page
      .locator("#table")
      .evaluate(async (table: HTMLElementTagNameMap["bcd-compat-table"], text) => {
        const payload = structuredClone(window.bcdFixture.payload);
        const statement = payload.features.find((feature) => feature.name === "notes_only")?.support
          .chrome?.branches[0]?.statements[0];
        if (statement === undefined) throw new Error("The fixture has no notes_only statement");
        statement.notes = [text];
        table.data = payload;
        await new Promise((resolve) => setTimeout(resolve, 0));
        for (const disclosure of table.querySelectorAll("details")) disclosure.open = true;
        // An image that fails to load reports its error in a later task.
        await new Promise((resolve) => setTimeout(resolve, 100));
      }, note);

    expect(await page.evaluate(() => (window as unknown as { __x?: unknown }).__x)).toBeUndefined();
    await expect(page.locator("#table img, #table script")).toHaveCount(0);
    await expect(page.locator("#table bdi").last()).toHaveText(note);
  });
});

test.describe("a large table", () => {
  test("renders 2,000 features by four targets, and records how long that takes", async ({
    page,
  }, testInfo) => {
    test.slow();
    await openFixture(page);

    const measured = await page.evaluate(async () => {
      const payload = window.bcdFixture.buildLargePayload(2000);
      const table = document.createElement("bcd-compat-table");
      table.id = "large";
      document.querySelector("main")?.append(table);
      const loaded = new Promise<number>((resolve) => {
        table.addEventListener("bcd-load", () => resolve(performance.now()), { once: true });
      });

      const start = performance.now();
      table.data = payload;
      // `bcd-load` fires once the table's nodes are in the document: the model and the markup.
      const rendered = (await loaded) - start;
      // Two animation frames later the browser has also laid the table out and painted it.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const painted = performance.now() - start;

      return {
        rendered,
        painted,
        rows: table.querySelectorAll("tbody tr").length,
        elements: table.querySelectorAll("*").length,
      };
    });

    expect(measured.rows).toBe(2000);
    const description =
      `${measured.elements} elements; ${measured.rendered.toFixed(0)} ms until bcd-load, ` +
      `${measured.painted.toFixed(0)} ms until two frames later`;
    testInfo.annotations.push({ type: "render-time", description });
    // The time is recorded, not asserted: it depends on the machine.
    console.log(`[${testInfo.project.name}] 2,000 features by 4 targets: ${description}`);
  });
});
