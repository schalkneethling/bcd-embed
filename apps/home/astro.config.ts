import { fileURLToPath } from "node:url";

import { defineConfig } from "astro/config";
import type { Plugin } from "vite";

const source = (path: string) => fileURLToPath(new URL(`../../packages/${path}`, import.meta.url));

// The workspace packages export their `dist/` folders, which do not exist until `pnpm build` has
// built them, and `pnpm check` runs this workspace's build test before it builds anything. So the
// page reads their source, as the root `vitest.config.ts` does.
//
// The element needs more than an alias. Its `package.json` lists only `./dist/index.js` and
// `./dist/*.css` under `sideEffects`, so the bundler treats `src/index.ts` as free of side effects
// and drops `import "@bcd-embed/element";`, which then defines nothing. A `resolveId` result's
// `moduleSideEffects` takes precedence over `package.json`, so this plugin keeps the entry, the
// way the published `dist/index.js` is kept.
const workspaceSource: Plugin = {
  name: "bcd-embed-workspace-source",
  enforce: "pre",
  resolveId(id) {
    switch (id) {
      case "@bcd-embed/core":
        return source("core/src/index.ts");
      case "@bcd-embed/schema":
        return source("schema/src/index.ts");
      case "@bcd-embed/element":
        return { id: source("element/src/index.ts"), moduleSideEffects: true };
      case "@bcd-embed/element/base.css":
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
    plugins: [workspaceSource],
    build: {
      // Vite's default CSS minifier, lightningcss, drops the base stylesheet's
      // `@layer bcd-embed.base;` statement and rewrites each `light-dark()` into custom
      // properties that this page never defines, so every icon loses its colour
      // (packages/element/README.md, "If your bundler minifies the stylesheet").
      cssMinify: false,
      // Astro copies a script smaller than this limit into the page as an inline `<script>`.
      // Zero keeps every script a file, so the page can be served with `script-src 'self'` (#211).
      assetsInlineLimit: 0,
    },
  },
});
