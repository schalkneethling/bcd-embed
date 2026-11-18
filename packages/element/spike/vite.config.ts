// Serves (and builds) the spike pages. Each page is its own build entry, so the production
// preview serves the same pages as the dev server. spike/public holds the classic script that
// vite.early.config.ts builds; both servers serve it at /early-define.js.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const page = (name: string) => fileURLToPath(new URL(`./${name}.html`, import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  build: {
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        "class-fields": page("class-fields"),
        "early-parse": page("early-parse"),
        "light-dom": page("light-dom"),
        react: page("react"),
        "table-parse": page("table-parse"),
      },
    },
  },
});
