import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      // Two entries: the element, and the opt-in base stylesheet. The CSS entry needs
      // `cssCodeSplit: true`, because library mode turns code splitting off, and Vite 8.3.8 then
      // refuses a CSS file among the inputs. With it on, the stylesheet becomes `dist/base.css`
      // and no JavaScript file is emitted for it.
      entry: { index: "src/index.ts", base: "src/styles/base.css" },
      fileName: (_format, entryName) => `${entryName}.js`,
      formats: ["es"],
    },
    cssCodeSplit: true,
    // Vite's own CSS pipeline flattens base.css's `@import` rules into one file and keeps the
    // `@layer bcd-embed.base;` statement first. Its default minifier, lightningcss, drops that
    // statement and rewrites values (docs/planning/10-component-spikes.md, #188 section 6), so
    // the published stylesheet is not minified.
    cssMinify: false,
    // The package lists `lit` and `@lit/task` as dependencies, so the consumer's bundler resolves
    // them. Vite 8 names this option `rolldownOptions`; `rollupOptions` is a deprecated alias.
    rolldownOptions: {
      external: [/^lit(\/|$)/, /^@lit\//],
    },
  },
});
