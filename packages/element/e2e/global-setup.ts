// Builds the package before the browser tests run, so the fixture pages link the stylesheet a
// consumer gets, `dist/base.css`, and not its source files. The Vite dev server that Playwright
// starts serves `dist/` from disk on each request, so the file only has to exist before the
// first test. Playwright calls the default export once, before any test.
//
// The second build is the production build of the framework pages (issue #207), which reads the
// package build, so it runs after the first. The framework tests' production server reads its
// output from disk on each request.
import { fileURLToPath } from "node:url";

import { build } from "vite";

export default async function globalSetup(): Promise<void> {
  await build({
    root: fileURLToPath(new URL("..", import.meta.url)),
    mode: "lib",
    logLevel: "warn",
  });

  // Vite fills `NODE_ENV` in only when it is unset, and Playwright's runner may have set it to
  // "test", which would put the development versions of React and Lit into a page that the tests
  // call the production page (issue #206 found the same with Vitest). The variable is set for this
  // one build and put back afterwards.
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await build({
      configFile: fileURLToPath(new URL("./frameworks/vite.config.ts", import.meta.url)),
      mode: "production",
      logLevel: "warn",
    });
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
}
