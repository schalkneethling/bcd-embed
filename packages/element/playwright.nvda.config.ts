// Screen reader tests with NVDA on Windows, in Playwright's Firefox. Guidepup drives the screen
// reader and records what it says. The screen reader takes over the machine while the tests run,
// so they are not part of `pnpm check`.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  // One test at a time and headed, because there is only one screen reader and it cannot read a
  // headless browser.
  workers: 1,
  fullyParallel: false,
  testDir: "./screen-reader",
  testMatch: "**/*.nvda.ts",
  // Each test starts the screen reader and moves it into the page, which takes tens of seconds.
  // The NVDA walk also performs Document 7's steps 8 to 14, about twenty more moves than the
  // VoiceOver and Orca walks, so it gets twice their time.
  timeout: 10 * 60 * 1000,
  // A screen reader sometimes fails to start. Playwright reports a test that passed on retry as
  // flaky.
  retries: 1,
  reporter: "list",
  use: { trace: "retain-on-failure", video: "retain-on-failure" },
  projects: [{ name: "firefox", use: { ...devices["Desktop Firefox"], headless: false } }],
});
