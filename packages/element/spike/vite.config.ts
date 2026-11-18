// Serves (and builds) the spike pages. Each page is its own build entry, so the production
// preview serves the same four pages as the dev server.
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
        "light-dom": page("light-dom"),
        react: page("react"),
        "table-parse": page("table-parse"),
      },
    },
  },
});
