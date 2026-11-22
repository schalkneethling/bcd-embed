// Visual snapshots of the table's responsive layout (issue #201), in Chromium, Firefox, and WebKit.
// They reuse the browser test setup (playwright.e2e.config.ts) but match `*.visual.ts`, so the
// Element browser workflow does not run them. Fonts and antialiasing differ between operating
// systems, so a snapshot only matches on the platform that recorded it, and the path below keeps
// one set per platform. The committed set was recorded on macOS (`darwin`). Record or update a
// set with `pnpm --filter @schalkneethling/bcd-embed run test:visual --update-snapshots`.
import { defineConfig } from "@playwright/test";

import browserTests from "./playwright.e2e.config.js";

export default defineConfig({
  ...browserTests,
  testMatch: "**/*.visual.ts",
  snapshotPathTemplate:
    "{testDir}/__snapshots__/{testFileName}/{platform}/{projectName}/{arg}{ext}",
});
