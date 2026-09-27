import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: { entry: "src/index.ts", fileName: () => "index.js", formats: ["es"] },
    rolldownOptions: {
      external: [
        "@bcd-embed/core",
        "@bcd-embed/schema",
        "@mdn/browser-compat-data",
        "ajv",
        "ajv-formats",
        "node:crypto",
        "node:module",
      ],
    },
  },
});
