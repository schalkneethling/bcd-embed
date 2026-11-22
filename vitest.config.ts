import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defaultExclude, defineConfig } from "vitest/config";

// Claude Code keeps other sessions' worktrees here. Each is a full copy of the repository, so
// without this their tests run too and the doubled load times out slow setup hooks.
const worktreeExclude = ".claude/worktrees/**";

// The one pattern that separates the two projects. Browser tests are named `*.browser.test.ts`.
// The Node project excludes the pattern, and the browser project includes only it, so each file
// runs in exactly one project. Playwright Test's `*.e2e.ts` files match neither project's
// `include`, so `vitest run` never collects them.
const browserTestPattern = "**/*.browser.test.ts";

export default defineConfig({
  resolve: {
    alias: {
      "@bcd-embed/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
      "@schalkneethling/bcd-embed": fileURLToPath(
        new URL("./packages/element/src/index.ts", import.meta.url),
      ),
      "@bcd-embed/generator": fileURLToPath(
        new URL("./packages/generator/src/index.ts", import.meta.url),
      ),
      "@bcd-embed/schema": fileURLToPath(
        new URL("./packages/schema/src/index.ts", import.meta.url),
      ),
      "@bcd-embed/server": fileURLToPath(
        new URL("./packages/server/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          // The spike did not test whether a project's `exclude` merges with the root's, so the
          // defaults and the worktree pattern repeat here.
          exclude: [...defaultExclude, worktreeExclude, browserTestPattern],
        },
      },
      {
        extends: true,
        test: {
          name: "browser",
          include: [browserTestPattern],
          exclude: [...defaultExclude, worktreeExclude],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            // Chromium only. Firefox and WebKit run in the Playwright Test config in
            // packages/element, so `pnpm check` stays fast (docs/planning/10-component-spikes.md).
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
