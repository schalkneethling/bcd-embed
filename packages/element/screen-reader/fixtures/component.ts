// The script of `component.html`, the page the screen reader walks load. Vite builds it into
// `dist-screen-reader/` (`vite.screen-reader.config.ts`), so the walks hear the element as a
// built page ships it, not as the dev server's modules. `@schalkneethling/bcd-embed` is the library build,
// `dist/index.js`, which is what a consumer imports, so `package.json`'s `sideEffects` list applies
// as it would in a consumer's bundler. `vite.screen-reader.config.ts` maps the name to the build
// and `tsconfig.json` maps it to the source for type checking. `build:screen-reader-fixture`
// builds the library first.
import "@schalkneethling/bcd-embed";

import { v1NormalizedFixture } from "../../../schema/src/fixtures/v1.js";

const table = document.querySelector("bcd-compat-table");
if (table !== null) table.data = v1NormalizedFixture;
