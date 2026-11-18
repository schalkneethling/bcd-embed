// Builds early-define.ts as a classic (IIFE) script into spike/public, so early-parse.html can
// load it with a parser-blocking <script> in <head>. That defines the element before the parser
// reaches it, which a module script cannot do, because module scripts run after parsing.
// Run before the spike tests by the `test:spike` script.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: false,
  build: {
    outDir: fileURLToPath(new URL("./public", import.meta.url)),
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL("./early-define.ts", import.meta.url)),
      name: "SpikeEarlyDefine",
      formats: ["iife"],
      fileName: () => "early-define.js",
    },
  },
});
