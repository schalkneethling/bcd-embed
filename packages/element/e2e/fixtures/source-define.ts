// The script that defines the element for the source-mode pages (issue #205). The pages in
// `source-mode.e2e.ts` load it in different ways, to define the element before or after the HTML
// parser reaches it, and this file stays the same for all of them. The Vite dev server that
// Playwright starts serves it, so the pages run the element's source, not a build.
import "../../src/index.js";
