// What Orca says while walking the Phase 1 tables in Playwright's Firefox.
import { orcaTest as test } from "@guidepup/playwright";

import { variants, walkTable } from "./walk-table.js";

for (const variant of variants) {
  test(`Orca walks ${variant.name}`, async ({ page, orca }, testInfo) => {
    const { MoveDown, MoveRight } = orca.keyboardCommands;
    await walkTable(
      page,
      orca,
      {
        right: () => orca.perform(MoveRight, { capture: true }),
        down: () => orca.perform(MoveDown, { capture: true }),
      },
      variant,
      testInfo,
      // Orca announces the column headers on entering the table, and not again when table
      // navigation changes the column, so the support target's name in each cell is what
      // identifies the column.
      { "Tab to the fit-content cell in Chrome": "Desktop" },
    );
  });
}
