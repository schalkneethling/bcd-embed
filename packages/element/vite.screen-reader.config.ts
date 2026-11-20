// Builds the page that the screen reader walks load (`screen-reader/fixtures/component.html`) and
// serves it with `vite preview`. It is separate from the library build in `vite.config.ts`, whose
// output in `dist/` is what the package publishes.
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    {
      // `package.json` lists only the built `dist/index.js` as having side effects, and Vite
      // passes that list to the bundler. The page imports the source `src/index.ts`, which
      // defines the element and exports nothing the page uses, so without this the bundler drops
      // the import and the page renders no table. A hook's answer outranks the bundler's
      // `treeshake.moduleSideEffects` option, which is why a plugin does this and not an option.
      name: "keep-element-definition",
      enforce: "post",
      transform(code, id) {
        return /[\\/]src[\\/]index\.ts$/.test(id) ? { code, moduleSideEffects: true } : null;
      },
    },
  ],
  build: {
    outDir: "dist-screen-reader",
    emptyOutDir: true,
    rolldownOptions: { input: "screen-reader/fixtures/component.html" },
  },
});
