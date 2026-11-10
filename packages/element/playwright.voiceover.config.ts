// Screen reader tests with VoiceOver on macOS, in Playwright's WebKit, the closest Playwright browser to Safari. Guidepup drives
// the screen reader and records what it says. The screen reader takes over the machine while
// the tests run, so they are not part of `pnpm check`.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  // One test at a time and headed, because there is only one screen reader and it cannot read a
  // headless browser.
  workers: 1,
  fullyParallel: false,
  testDir: "./screen-reader",
  testMatch: "**/*.voiceover.ts",
  // Each test starts the screen reader and moves it into the page, which takes tens of seconds.
  timeout: 5 * 60 * 1000,
  // A screen reader sometimes fails to start. Playwright reports a test that passed on retry as
  // flaky.
  retries: 1,
  reporter: "list",
  use: { trace: "retain-on-failure", video: "retain-on-failure" },
  projects: [{ name: "webkit", use: { ...devices["Desktop Safari"], headless: false } }],
});
