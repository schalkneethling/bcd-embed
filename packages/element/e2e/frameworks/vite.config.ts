// The Vite configuration for the three framework pages (issue #207). The pages are served two ways,
// and the tests run against both: by the dev server, which serves the element's source and the
// frameworks' development builds, and by `production-server.ts`, which builds the pages and serves
// the result. React and Lit ship different development and production builds, and the Lit spike
// found that a difference in the build can change what the element does (Document 10, #187).
import { fileURLToPath } from "node:url";

import { svelte } from "@sveltejs/vite-plugin-svelte";
import react from "@vitejs/plugin-react";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const frameworksRoot = fileURLToPath(new URL(".", import.meta.url));

export const FRAMEWORKS = ["react", "vue", "svelte"] as const;

export default defineConfig(({ command }) => ({
  // The package directory, as for the other fixture pages, so `/dist/base.css` is the stylesheet
  // that a build of the package writes (e2e/global-setup.ts).
  root: packageRoot,
  plugins: [
    react({ include: /\/frameworks\/react\/.*\.tsx$/ }),
    // Vue reads `<bcd-compat-table>` as an unknown component unless the compiler is told that it
    // is a custom element (vuejs.org, "Vue and Web Components").
    vue({
      template: { compilerOptions: { isCustomElement: (tag) => tag === "bcd-compat-table" } },
    }),
    svelte(),
  ],
  resolve: {
    alias: {
      // The dev server runs the source, as the other fixture pages do. The build reads the file
      // that `vite build --mode lib` wrote, which is the file a consumer's bundler reads through
      // the package's `exports`, so the production pages hold the element as it ships.
      "@bcd-embed/element": fileURLToPath(
        new URL(
          command === "serve" ? "../../src/index.ts" : "../../dist/index.js",
          import.meta.url,
        ),
      ),
    },
  },
  // Vite finds the frameworks to pre-bundle by scanning the pages, and its default scan starts at
  // `index.html` in the root, which does not exist here. Without these entries the dev server
  // finds React on the first request and reloads the page, which a test would see as a lost page.
  optimizeDeps: { entries: FRAMEWORKS.map((name) => `${frameworksRoot}${name}/index.html`) },
  build: {
    outDir: `${frameworksRoot}dist`,
    emptyOutDir: true,
    // The stylesheet's `@layer` statement does not survive Vite's CSS minifier (see the Vite
    // config of the package), so the pages keep the stylesheet as written.
    cssMinify: false,
    rolldownOptions: {
      input: FRAMEWORKS.map((name) => `${frameworksRoot}${name}/index.html`),
    },
  },
}));
