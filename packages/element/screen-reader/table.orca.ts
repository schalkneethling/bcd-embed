// What Orca says while walking the table that `<bcd-compat-table>` renders, in Playwright's
// Firefox.
import { orcaTest as test } from "@guidepup/playwright";

import { componentSteps } from "./component-steps.js";
import { walkTable } from "./walk-table.js";

test("Orca walks the component", async ({ page, orca }, testInfo) => {
  const { MoveDown, MoveLeft, MoveRight, MoveUp } = orca.keyboardCommands;
  const moves = {
    right: () => orca.perform(MoveRight, { capture: true }),
    down: () => orca.perform(MoveDown, { capture: true }),
    up: () => orca.perform(MoveUp, { capture: true }),
    left: () => orca.perform(MoveLeft, { capture: true }),
    activate: () => orca.act({ capture: true }),
  };
  await walkTable(
    page,
    orca,
    moves,
    testInfo,
    // Orca announces the column headers on entering the table, and not again when table
    // navigation changes the column, so the support target's name in each cell is what
    // identifies the column.
    { "Tab to the fit-content cell in Chrome": "Desktop" },
    { extraSteps: componentSteps(page, moves) },
  );
});
