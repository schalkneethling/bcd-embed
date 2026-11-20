// Builds the package before the browser tests run, so the fixture pages link the stylesheet a
// consumer gets, `dist/base.css`, and not its source files. The Vite dev server that Playwright
// starts serves `dist/` from disk on each request, so the file only has to exist before the
// first test. Playwright calls the default export once, before any test.
import { fileURLToPath } from "node:url";

import { build } from "vite";

export default async function globalSetup(): Promise<void> {
  await build({
    root: fileURLToPath(new URL("..", import.meta.url)),
    mode: "lib",
    logLevel: "warn",
  });
}
