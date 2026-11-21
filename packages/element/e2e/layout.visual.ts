// Visual snapshots of the responsive layout (issue #201): a narrow container, scrolled so the
// sticky feature column covers the other columns, and a wide one, each in light and dark.
// playwright.visual.config.ts runs this file; the Element browser workflow does not.
//
// The page is e2e/fixtures/layout-visual.html, which nothing else uses. Any change to it, to the
// fixture payload, or to the stylesheet changes the images: run `test:visual --update-snapshots`
// and review the new images before committing them.
import { expect, test } from "@playwright/test";

const PAGE = "/e2e/fixtures/layout-visual.html";

for (const scheme of ["light", "dark"] as const) {
  for (const layout of ["narrow", "wide"] as const) {
    test(`the ${layout} layout in ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(PAGE);
      await page.locator(`#${layout}[loaded] table`).waitFor();
      const region = page.locator(`#${layout} .bcd-scroller`);
      if (layout === "narrow") {
        await region.evaluate((scroller) => {
          scroller.scrollLeft = 160;
        });
      }

      // The element is visibility: hidden while loaded (table.css), so the region is shot.
      await expect(region).toHaveScreenshot(`${layout}-${scheme}.png`);
    });
  }
}
