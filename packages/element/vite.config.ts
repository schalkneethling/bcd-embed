import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      fileName: () => "index.js",
      formats: ["es"],
    },
    // The package lists `lit` and `@lit/task` as dependencies, so the consumer's bundler resolves
    // them. Vite 8 names this option `rolldownOptions`; `rollupOptions` is a deprecated alias.
    rolldownOptions: {
      external: [/^lit(\/|$)/, /^@lit\//],
    },
  },
});
