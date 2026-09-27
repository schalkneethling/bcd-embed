import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: { index: "src/index.ts", bin: "src/bin.ts" },
      fileName: (_format, entryName) => `${entryName}.js`,
      formats: ["es"],
    },
    rolldownOptions: {
      external: [
        "@bcd-embed/core",
        "@bcd-embed/schema",
        "@mdn/browser-compat-data",
        "ajv",
        "ajv-formats",
        "node:crypto",
        "node:fs/promises",
        "node:module",
        "node:path",
      ],
    },
  },
});
