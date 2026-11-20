// The script of `component.html`, the page the screen reader walks load. Vite builds it into
// `dist-screen-reader/` (`vite.screen-reader.config.ts`), so the walks hear the element as a
// built page ships it, not as the dev server's modules.
import { v1NormalizedFixture } from "../../../schema/src/fixtures/v1.js";
import "../../src/index.js";

const table = document.querySelector("bcd-compat-table");
if (table !== null) table.data = v1NormalizedFixture;
