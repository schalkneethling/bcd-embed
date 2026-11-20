// What VoiceOver says while walking the table that `<bcd-compat-table>` renders, in Playwright's
// WebKit.
import { voiceOverTest as test } from "@guidepup/playwright";

import { componentSteps } from "./component-steps.js";
import { walkTable } from "./walk-table.js";

test("VoiceOver walks the component", async ({ page, voiceOver }, testInfo) => {
  const moves = {
    right: () => voiceOver.next({ capture: true }),
    down: () => voiceOver.perform(voiceOver.keyboardCommands.moveDown, { capture: true }),
    up: () => voiceOver.perform(voiceOver.keyboardCommands.moveUp, { capture: true }),
    left: () => voiceOver.previous({ capture: true }),
    activate: () => voiceOver.act({ capture: true }),
  };
  await walkTable(
    page,
    voiceOver,
    moves,
    testInfo,
    // VoiceOver announces the platform header above a column on entering it.
    { "move right to Node.js": "Server and Node.js" },
    // VoiceOver passed with the disclosures left open, so the route stays as it ran.
    { extraSteps: componentSteps(page, moves, { closeDisclosures: false }) },
  );
});
