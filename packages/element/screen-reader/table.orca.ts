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
        right: () => orca.perform(MoveRight),
        down: () => orca.perform(MoveDown),
      },
      variant,
      testInfo,
    );
  });
}
