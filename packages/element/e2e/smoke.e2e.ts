// Proves the three-engine harness: Playwright Test loads an inert page in Chromium, Firefox, and
// WebKit, and axe reports no violations on it.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const smokePage = new URL("./fixtures/smoke.html", import.meta.url);

test("the smoke page has no axe violations", async ({ page }) => {
  await page.goto(smokePage.href);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Harness smoke page");

  const { violations } = await new AxeBuilder({ page }).analyze();

  // Listing each violation's rule id and the elements it flags makes a failure name the problem.
  expect(
    violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) })),
  ).toEqual([]);
});
