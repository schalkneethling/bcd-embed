// What VoiceOver says while walking the Phase 1 tables in Playwright's WebKit.
import { voiceOverTest as test } from "@guidepup/playwright";

import { variants, walkTable } from "./walk-table.js";

for (const variant of variants) {
  test(`VoiceOver walks ${variant.name}`, async ({ page, voiceOver }, testInfo) => {
    await walkTable(
      page,
      voiceOver,
      {
        right: () => voiceOver.next({ capture: true }),
        down: () => voiceOver.perform(voiceOver.keyboardCommands.moveDown, { capture: true }),
      },
      variant,
      testInfo,
    );
  });
}
