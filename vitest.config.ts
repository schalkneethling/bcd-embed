import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@bcd-embed/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
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
});
