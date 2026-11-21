// Builds the page that the screen reader walks load (`screen-reader/fixtures/component.html`) and
// serves it with `vite preview`. It is separate from the library build in `vite.config.ts`, whose
// output in `dist/` is what the package publishes and what the page imports.
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    // The page imports the package by name, as a consumer does. The package is not linked into
    // its own `node_modules`, so the name is mapped to the library build.
    alias: { "@bcd-embed/element": fileURLToPath(new URL("./dist/index.js", import.meta.url)) },
  },
  build: {
    // The page links the built `dist/base.css`, and Vite copies it into this build. Its default
    // minifier, lightningcss, drops the `@layer bcd-embed.base;` statement, so the walks would
    // hear a different stylesheet from the one the package publishes.
    cssMinify: false,
    outDir: "dist-screen-reader",
    emptyOutDir: true,
    rolldownOptions: { input: "screen-reader/fixtures/component.html" },
  },
});
