// Browser tests in Chromium, Firefox, and WebKit with Playwright Test and axe. They are not part
// of `pnpm check`: the Element browser workflow (`.github/workflows/element-browser.yml`) runs
// them. The Chromium Vitest project in the root `vitest.config.ts` runs in `pnpm check`.
import { defineConfig, devices } from "@playwright/test";

// The pages that load the element need a server, because they import TypeScript source. Vite's
// dev server serves this package's directory, so `/e2e/fixtures/data-mode.html` is the fixture
// page. `--strictPort` makes a port that is already taken a failure instead of a silent move to
// another port that `baseURL` would not know about.
const port = 5198;
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  // The `*.e2e.ts` name keeps these files out of `vitest run`, which collects `*.test.ts`.
  testMatch: "**/*.e2e.ts",
  // Builds `dist/base.css`, which the fixture pages link (e2e/global-setup.ts).
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: origin, trace: "retain-on-failure" },
  webServer: {
    command: `vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: `${origin}/e2e/fixtures/data-mode.html`,
    reuseExistingServer: false,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
