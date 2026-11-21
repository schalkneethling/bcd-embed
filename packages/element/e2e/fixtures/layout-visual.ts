// The script of `layout-visual.html`: assigns the adversarial fixture to every table on the page.
// The Vite dev server that Playwright starts serves it, so the page runs the element's source.
import { v1NormalizedFixture } from "../../../schema/src/fixtures/v1.js";
import "../../src/index.js";

for (const table of document.querySelectorAll("bcd-compat-table")) {
  table.data = v1NormalizedFixture;
}
