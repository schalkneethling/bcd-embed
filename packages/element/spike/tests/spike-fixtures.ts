// Shared setup for the spike tests: records every console error and uncaught page error, and
// notes which browser build ran the test so the findings can quote it.
import { test as base, expect } from "@playwright/test";

type SpikeFixtures = {
  pageErrors: string[];
};

export const test = base.extend<SpikeFixtures>({
  pageErrors: async ({ page, browser, browserName }, use, testInfo) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(`console.error: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => {
      errors.push(`pageerror: ${error.message}`);
    });
    testInfo.annotations.push({
      type: "engine",
      description: `${browserName} ${browser.version()}`,
    });
    await use(errors);
    if (errors.length > 0) {
      testInfo.annotations.push({ type: "page errors", description: errors.join("\n") });
    }
  },
});

export { expect };

// Whether the project runs against the Vite dev server or the production build.
export function buildMode(metadata: Record<string, unknown>): "dev" | "build" {
  return metadata.mode === "build" ? "build" : "dev";
}
