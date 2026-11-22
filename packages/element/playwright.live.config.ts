// The one test that calls the live, hosted API (issue #203). It is not part of `pnpm check` or the
// Element browser workflow, because a test there must not depend on a production service or spend
// its rate limit. Run it by hand with `pnpm --filter @schalkneethling/bcd-embed test:live`. It requests
// one feature, once, in Chromium.
import { defineConfig, devices } from "@playwright/test";

// A port of its own, so this run cannot collide with the three-engine run on 5198.
const port = 5197;
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  // The `*.live.ts` name keeps this file out of `test:e2e`, which collects `*.e2e.ts`, and out of
  // `vitest run`, which collects `*.test.ts`.
  testMatch: "**/*.live.ts",
  reporter: "list",
  // A failure against a live service is worth reading, not retrying.
  retries: 0,
  use: { baseURL: origin, trace: "retain-on-failure" },
  webServer: {
    command: `vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: `${origin}/e2e/fixtures/fetch-mode.html`,
    reuseExistingServer: false,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
