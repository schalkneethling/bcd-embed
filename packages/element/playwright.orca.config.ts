// Screen reader tests with Orca on Linux, in Playwright's Firefox. Guidepup drives
// the screen reader and records what it says. The screen reader takes over the machine while
// the tests run, so they are not part of `pnpm check`.
import { defineConfig, devices } from "@playwright/test";

import { origin, webServer } from "./screen-reader/server.js";

export default defineConfig({
  // The walk loads the built fixture page, which this server previews. Run
  // `pnpm --filter @schalkneethling/bcd-embed build:screen-reader-fixture` first.
  webServer,
  // One test at a time and headed, because there is only one screen reader and it cannot read a
  // headless browser.
  workers: 1,
  fullyParallel: false,
  testDir: "./screen-reader",
  testMatch: "**/*.orca.ts",
  // Each test starts the screen reader and moves it into the page, which takes tens of seconds.
  // The walk then makes about 25 more moves for Document 7's steps 8 to 12, so it gets twice the
  // time the walk without them had.
  timeout: 10 * 60 * 1000,
  // A screen reader sometimes fails to start. Playwright reports a test that passed on retry as
  // flaky.
  retries: 1,
  reporter: "list",
  use: { baseURL: origin, trace: "retain-on-failure", video: "retain-on-failure" },
  projects: [{ name: "firefox", use: { ...devices["Desktop Firefox"], headless: false } }],
});
