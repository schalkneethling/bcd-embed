// Visual snapshots of the responsive layout (issue #201): a narrow container, scrolled so the
// sticky feature column covers the other columns, and a wide one, each in light and dark.
// playwright.visual.config.ts runs this file; the Element browser workflow does not.
import { expect, test } from "@playwright/test";

const STYLED_PAGE = "/e2e/fixtures/data-mode.html";

const LAYOUTS = [
  { name: "narrow", inlineSize: "30em", targets: "chrome edge firefox opera safari nodejs" },
  { name: "wide", inlineSize: "60em", targets: "chrome opera nodejs" },
] as const;

for (const scheme of ["light", "dark"] as const) {
  for (const { name, inlineSize, targets } of LAYOUTS) {
    test(`the ${name} layout in ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(STYLED_PAGE);
      await page.locator("#table[loaded] table").waitFor();
      // The page declares both schemes, so the canvas and the palette follow the emulated one.
      await page.evaluate(
        ({ size, browsers }) => {
          document.documentElement.style.colorScheme = "light dark";
          const table = document.querySelector("#table") as HTMLElement;
          table.style.inlineSize = size;
          table.setAttribute("browsers", browsers);
        },
        { size: inlineSize, browsers: targets },
      );
      await expect(page.locator("#table thead tr:nth-child(2) th")).toHaveCount(
        targets.split(" ").length,
      );
      if (name === "narrow") {
        await page.locator("#table .bcd-scroller").evaluate((scroller) => {
          scroller.scrollLeft = 160;
        });
      }

      // The element is visibility: hidden while loaded (table.css), so the region is shot.
      await expect(page.locator("#table .bcd-scroller")).toHaveScreenshot(`${name}-${scheme}.png`);
    });
  }
}
