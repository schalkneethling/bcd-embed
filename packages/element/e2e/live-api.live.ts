// The element against the live, hosted API (issue #203), with no routing: one element with only
// `query` set asks `https://api.browser-compat.dev` for one feature. `playwright.live.config.ts`
// runs it; it is never part of `pnpm check`.
import { expect, test } from "@playwright/test";

const QUERY = "css.properties.line-clamp";
const FEATURE_URL = `https://api.browser-compat.dev/v1/current/features/${QUERY}.json`;

test(`renders ${QUERY} from the live API and fires one bcd-load with the snapshot`, async ({
  page,
}) => {
  await page.goto("/e2e/fixtures/fetch-mode.html");
  await page.locator("#loaded[loaded]").waitFor({ state: "attached" });
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://api.browser-compat.dev/")) requests.push(request.url());
  });

  const events = await page.locator("#lab").evaluate(async (lab, query) => {
    const details: unknown[] = [];
    const table = document.createElement("bcd-compat-table");
    table.id = "live";
    table.setAttribute("query", query);
    table.setAttribute("loading", "eager");
    const settled = new Promise<void>((resolve) => {
      table.addEventListener("bcd-load", () => resolve());
      table.addEventListener("bcd-error", () => resolve());
    });
    table.addEventListener("bcd-load", (event) =>
      details.push({ type: event.type, ...event.detail }),
    );
    table.addEventListener("bcd-error", (event) =>
      details.push({ type: event.type, ...event.detail }),
    );
    lab.append(table);
    await settled;
    // A second event would arrive by now: the element dispatches in the update after the answer.
    await new Promise((resolve) => setTimeout(resolve, 500));
    return details;
  }, QUERY);

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ type: "bcd-load", mode: "fetch" });
  const { snapshot } = events[0] as { snapshot: unknown };
  expect(typeof snapshot).toBe("string");
  expect(String(snapshot).length).toBeGreaterThan(0);
  await expect(page.locator("#live caption")).toHaveText(`Browser compatibility: ${QUERY}`);
  expect(await page.locator("#live tbody tr").count()).toBeGreaterThan(0);
  expect(requests).toEqual([FEATURE_URL]);
  console.log(`[live] ${FEATURE_URL} answered with snapshot ${String(snapshot)}`);
});
