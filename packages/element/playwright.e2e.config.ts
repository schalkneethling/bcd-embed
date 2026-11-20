// Browser tests in Chromium, Firefox, and WebKit with Playwright Test and axe. They are not part
// of `pnpm check`: the Element browser workflow (`.github/workflows/element-browser.yml`) runs
// them. The Chromium Vitest project in the root `vitest.config.ts` runs in `pnpm check`.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // The `*.e2e.ts` name keeps these files out of `vitest run`, which collects `*.test.ts`.
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  reporter: "list",
  use: { trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
