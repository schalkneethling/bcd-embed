import { fileURLToPath } from "node:url";

import { defineConfig } from "astro/config";
import type { Plugin } from "vite";

const source = (path: string) => fileURLToPath(new URL(`../../packages/${path}`, import.meta.url));

/** Set to "1" by `tests/home-page.test.ts`, and by nothing else. */
const WORKSPACE_SOURCE_VARIABLE = "BCD_EMBED_HOME_WORKSPACE_SOURCE";

// The deployed page is built by `pnpm build`, which builds the workspace packages first, because
// pnpm runs a recursive build in dependency order. So by default the page imports each package
// through its `exports`, as a consumer does: the element's `dist/index.js` (kept by its
// `sideEffects`) and `dist/base.css`, and the `dist/` of `core` and `schema` at build time.
//
// The page test runs before `pnpm build` in `pnpm check`, when no `dist/` exists, so it sets
// WORKSPACE_SOURCE_VARIABLE and this plugin points each import at the package's source instead,
// as the root `vitest.config.ts` does. The element needs more than an alias there: its
// `sideEffects` lists only `dist/` files, so the bundler would treat `src/index.ts` as free of side
// effects and drop `import "@schalkneethling/bcd-embed";`. A `resolveId` result's `moduleSideEffects` takes
// precedence over `package.json`, so the plugin keeps the entry, as `sideEffects` keeps
// `dist/index.js`.
const workspaceSource: Plugin = {
  name: "bcd-embed-workspace-source",
  enforce: "pre",
  resolveId(id) {
    switch (id) {
      case "@bcd-embed/core":
        return source("core/src/index.ts");
      case "@bcd-embed/schema":
        return source("schema/src/index.ts");
      case "@schalkneethling/bcd-embed":
        return { id: source("element/src/index.ts"), moduleSideEffects: true };
      case "@schalkneethling/bcd-embed/base.css":
        return source("element/src/styles/base.css");
      default:
        return null;
    }
  },
};

export default defineConfig({
  // The address the page is served from. Astro needs it to write absolute URLs.
  site: "https://browser-compat.dev",
  build: {
    // Every stylesheet becomes a file, never a `<style>` element, so the page can be served with
    // `style-src 'self'` (#211).
    inlineStylesheets: "never",
  },
  vite: {
    plugins: process.env[WORKSPACE_SOURCE_VARIABLE] === "1" ? [workspaceSource] : [],
    build: {
      // Vite's default CSS minifier, lightningcss, drops the base stylesheet's
      // `@layer bcd-embed.base;` statement and rewrites each `light-dark()` into custom
      // properties that this page never defines, so every icon loses its colour
      // (packages/element/DEVELOPMENT.md, "If your bundler minifies the stylesheet").
      cssMinify: false,
      // Astro copies a script smaller than this limit into the page as an inline `<script>`.
      // Zero keeps every script a file, so the page can be served with `script-src 'self'` (#211).
      assetsInlineLimit: 0,
    },
  },
});
