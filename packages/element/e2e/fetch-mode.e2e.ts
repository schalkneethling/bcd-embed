// The element in fetch mode, in Chromium, Firefox, and WebKit (issue #203): axe on the loading and
// error states, lazy loading against the real `IntersectionObserver`, and the requests the page
// sends. Requests to the hosted API's origin and to `https://example.test` are answered by
// Playwright's routing, so no test reaches a real server.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page, Request, Route } from "@playwright/test";

import { v1NormalizedFixture } from "../../schema/src/fixtures/v1.js";

const FIXTURE_PAGE = "/e2e/fixtures/fetch-mode.html";
const API_ORIGIN = "https://api.browser-compat.dev";
const SNAPSHOT = "bcd-8.1.9-gen-0.0.0";
const FEATURE_PATH = "/v1/current/features/";

// The headers the hosted API sends with every answer (Document 1 sections 3 and 8). Without the
// second one a cross-origin page could not read the snapshot header.
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "etag, retry-after, bcd-embed-snapshot",
};

const queryOf = (url: string): string => {
  const { pathname } = new URL(url);
  return pathname.slice(pathname.indexOf(FEATURE_PATH) + FEATURE_PATH.length, -".json".length);
};

/** Answers a feature request with the Phase 1 fixture under the requested query. */
const fulfillPayload = (route: Route): Promise<void> =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { ...CORS_HEADERS, "bcd-embed-snapshot": SNAPSHOT },
    body: JSON.stringify({ ...v1NormalizedFixture, query: queryOf(route.request().url()) }),
  });

/** Routes every request for `origin` to `handle`, and returns the list of requests it saw. */
const routeApi = async (
  page: Page,
  handle: (route: Route) => Promise<void> = fulfillPayload,
  origin = API_ORIGIN,
): Promise<Request[]> => {
  const seen: Request[] = [];
  await page.route(`${origin}/**`, (route) => {
    seen.push(route.request());
    return handle(route);
  });
  return seen;
};

/** Writes `markup` into the page's lab, where the element is already defined. */
const addToLab = (page: Page, markup: string): Promise<void> =>
  page.locator("#lab").evaluate((lab, html) => {
    // The markup is the test's own constant, never data from a page or a response.
    lab.insertAdjacentHTML("beforeend", html);
  }, markup);

/** Collects every `bcd-load` and `bcd-error` detail on the page, in `window.bcdEvents`. */
const recordEvents = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const events: unknown[] = [];
    Object.assign(window, { bcdEvents: events });
    document.addEventListener("bcd-load", (event) =>
      events.push({ type: "bcd-load", ...event.detail }),
    );
    document.addEventListener("bcd-error", (event) =>
      events.push({ type: "bcd-error", ...event.detail }),
    );
  });

const readEvents = (page: Page): Promise<unknown[]> =>
  page.evaluate(() => (window as unknown as { bcdEvents: unknown[] }).bcdEvents);

const expectNoViolations = async (page: Page): Promise<void> => {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(
    violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) })),
  ).toEqual([]);
};

const openFixture = async (page: Page): Promise<void> => {
  await page.goto(FIXTURE_PAGE);
  // Every held state has arrived once the loaded table and the two errors have rendered.
  await page.locator("#loaded[loaded] table").waitFor();
  await page.locator("#not-found-bare p.bcd-error").waitFor();
  await page.locator("#unavailable-bare p.bcd-error").waitFor();
};

test.describe("the loading and error states", () => {
  test("have no axe violations, and show the fallback or a sentence of the element's own", async ({
    page,
  }) => {
    await openFixture(page);

    await expect(page.locator("#loading")).toHaveAttribute("aria-busy", "true");
    await expect(page.locator("#loading > p")).toBeVisible();
    await expect(page.locator("#loading-bare p.bcd-loading")).toHaveText(
      "Loading browser compatibility data for fixture.pending.",
    );
    await expect(page.locator("#not-found")).not.toHaveAttribute("aria-busy");
    await expect(page.locator("#not-found > p")).toBeVisible();
    await expect(page.locator("#not-found-bare p.bcd-error")).toHaveText(
      "Browser compatibility data for fixture.missing could not be loaded.",
    );
    await expect(page.locator("#unavailable-bare p.bcd-error")).toHaveText(
      "Browser compatibility data for fixture.unavailable could not be loaded.",
    );
    await expect(page.locator("#loaded > p")).toBeHidden();

    // No state uses a live region, so nothing is announced while the page loads.
    await expect(
      page.locator('[aria-live], [role="status"], [role="alert"], [role="log"], output'),
    ).toHaveCount(0);
    await expectNoViolations(page);
  });
});

test.describe("lazy loading", () => {
  test("sends no request for an element far below the viewport until the page scrolls near it", async ({
    page,
  }) => {
    await openFixture(page);
    const requests = await routeApi(page);
    await recordEvents(page);

    await addToLab(
      page,
      `<div style="block-size: 5000px"></div>
       <bcd-compat-table id="far" query="css.properties.line-clamp"><p>Fallback</p></bcd-compat-table>`,
    );
    // Give the observer several frames to report, as it does once for every new target.
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          let frames = 10;
          const next = (): void => {
            frames -= 1;
            if (frames === 0) resolve(undefined);
            else requestAnimationFrame(next);
          };
          requestAnimationFrame(next);
        }),
    );
    expect(requests).toHaveLength(0);
    await expect(page.locator("#far")).not.toHaveAttribute("aria-busy");

    await page.locator("#far").scrollIntoViewIfNeeded();
    await page.locator("#far[loaded] table").waitFor();

    expect(requests.map((request) => request.url())).toEqual([
      `${API_ORIGIN}/v1/current/features/css.properties.line-clamp.json`,
    ]);
    expect(await readEvents(page)).toEqual([
      { type: "bcd-load", mode: "fetch", snapshot: SNAPSHOT },
    ]);
  });

  test("sends the request on connect for loading=eager, far below the viewport", async ({
    page,
  }) => {
    await openFixture(page);
    const requests = await routeApi(page);

    await addToLab(
      page,
      `<div style="block-size: 5000px"></div>
       <bcd-compat-table id="far" query="css.properties.gap" loading="eager"></bcd-compat-table>`,
    );

    await expect(page.locator("#far")).toHaveAttribute("loaded", "");
    expect(requests).toHaveLength(1);
  });
});

test.describe("requests", () => {
  test("sends one request for 50 elements with the same query", async ({ page }) => {
    await openFixture(page);
    const requests = await routeApi(page);
    await recordEvents(page);

    await addToLab(
      page,
      '<bcd-compat-table query="css.properties.display" loading="eager"></bcd-compat-table>'.repeat(
        50,
      ),
    );

    await expect(page.locator("#lab bcd-compat-table[loaded]")).toHaveCount(50);
    expect(requests).toHaveLength(1);
    expect(await readEvents(page)).toHaveLength(50);
  });

  test("sends no request for an element whose data is set", async ({ page }) => {
    await openFixture(page);
    const requests = await routeApi(page);

    await page.locator("#lab").evaluate((lab) => {
      const table = document.createElement("bcd-compat-table");
      table.setAttribute("query", "css.properties.color");
      table.setAttribute("loading", "eager");
      table.id = "with-data";
      table.data = window.bcdFetchFixture.payload;
      lab.append(table);
    });

    await expect(page.locator("#with-data")).toHaveAttribute("loaded", "");
    await page.waitForTimeout(200);
    expect(requests).toHaveLength(0);
  });

  test("sends the request to the origin that endpoint names", async ({ page }) => {
    await openFixture(page);
    const hosted = await routeApi(page);
    const other = await routeApi(page, fulfillPayload, "https://example.test");

    await addToLab(
      page,
      '<bcd-compat-table id="elsewhere" query="css.properties.color" loading="eager" endpoint="https://example.test"></bcd-compat-table>',
    );

    await expect(page.locator("#elsewhere")).toHaveAttribute("loaded", "");
    expect(hosted).toHaveLength(0);
    expect(other.map((request) => request.url())).toEqual([
      "https://example.test/v1/current/features/css.properties.color.json",
    ]);
  });

  test("fires one bcd-error with the reason http for a 404, and shows the fallback", async ({
    page,
  }) => {
    await openFixture(page);
    await routeApi(page, (route) =>
      route.fulfill({
        status: 404,
        contentType: "application/json",
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: { code: "feature_not_found", message: "No data.", query: "css.properties.nope" },
        }),
      }),
    );
    await recordEvents(page);

    await addToLab(
      page,
      '<bcd-compat-table id="missing" query="css.properties.nope" loading="eager"><p>Fallback</p></bcd-compat-table>',
    );

    await expect(page.locator("#missing")).not.toHaveAttribute("aria-busy");
    await expect.poll(() => readEvents(page)).toHaveLength(1);
    expect(await readEvents(page)).toEqual([
      { type: "bcd-error", mode: "fetch", reason: "http", status: 404, code: "feature_not_found" },
    ]);
    await expect(page.locator("#missing > p")).toBeVisible();
    await expectNoViolations(page);
  });

  test("fires one bcd-error with the reason network for a failed request, and sends no other", async ({
    page,
  }) => {
    await openFixture(page);
    const requests = await routeApi(page, (route) => route.abort("failed"));
    await recordEvents(page);

    await addToLab(
      page,
      '<bcd-compat-table id="offline" query="css.properties.float" loading="eager"><p>Fallback</p></bcd-compat-table>',
    );

    await expect.poll(() => readEvents(page)).toHaveLength(1);
    await page.waitForTimeout(500);
    expect(await readEvents(page)).toEqual([
      { type: "bcd-error", mode: "fetch", reason: "network", status: null, code: null },
    ]);
    expect(requests).toHaveLength(1);
    await expect(page.locator("#offline > p")).toBeVisible();
  });
});
