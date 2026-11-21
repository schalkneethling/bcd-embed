import { fileURLToPath } from "node:url";

import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import mermaid from "astro-mermaid";

const repository = "https://github.com/schalkneethling/bcd-embed";

const elementSource = (path: string) =>
  fileURLToPath(new URL(`../../packages/element/src/${path}`, import.meta.url));

export default defineConfig({
  // The address the site is served from. Astro needs it to write absolute
  // URLs, and Starlight's sitemap integration writes no sitemap without it.
  site: "https://docs.browser-compat.dev",
  vite: {
    // The live example on the getting-started page imports the element as a
    // page would. The two names point at the element's source, as the root
    // Vitest configuration does, because `pnpm check` builds this site in a
    // test before any package is built, so `packages/element/dist` may not
    // exist yet.
    plugins: [
      {
        name: "bcd-embed-element-source",
        enforce: "pre",
        resolveId(source) {
          // The element's `package.json` lists only its `dist` files under
          // `sideEffects`, so the bundler would drop a bare
          // `import "@bcd-embed/element"` of the source file, and the element
          // would never be defined. Marking the entry as having side effects
          // keeps the `customElements.define` call, as the list does for
          // `dist/index.js`.
          if (source === "@bcd-embed/element") {
            return { id: elementSource("index.ts"), moduleSideEffects: true };
          }
          if (source === "@bcd-embed/element/base.css") {
            return { id: elementSource("styles/base.css"), moduleSideEffects: true };
          }
          return null;
        },
      },
    ],
  },
  integrations: [
    // astro-mermaid must be registered before Starlight so that it sees the
    // `mermaid` code fences before Starlight's code highlighter does.
    // `autoTheme` redraws each diagram when Starlight changes the page's
    // `data-theme` attribute between light and dark.
    mermaid({
      autoTheme: true,
      enableLog: false,
      mermaidConfig: {
        // Wider boxes keep each flowchart label on two lines, not four.
        flowchart: { wrappingWidth: 320 },
        // A sequence diagram scaled down to a phone's width is unreadable, so
        // it keeps its natural size and scrolls sideways instead. Narrower
        // participant boxes and margins, and `wrap`, which breaks long
        // messages, keep that natural size within the desktop text column.
        sequence: {
          actorMargin: 40,
          diagramMarginX: 8,
          useMaxWidth: false,
          width: 112,
          wrap: true,
        },
      },
    }),
    starlight({
      title: "bcd-embed",
      description:
        "Embeddable browser compatibility tables backed by MDN Browser Compatibility Data.",
      social: [{ icon: "github", label: "GitHub", href: repository }],
      customCss: ["./src/styles/diagrams.css"],
      editLink: { baseUrl: `${repository}/edit/main/apps/website/` },
      sidebar: [
        { label: "How bcd-embed works", link: "/" },
        { slug: "publication" },
        { slug: "deployment" },
        {
          label: "Web component",
          items: [
            { slug: "component/getting-started" },
            { slug: "component/attributes-and-properties" },
            { slug: "component/events" },
            { slug: "component/data-modes" },
            { slug: "component/styling" },
            { slug: "component/frameworks" },
            { slug: "component/accessibility" },
            { slug: "component/browser-support" },
            { slug: "component/self-hosting" },
          ],
        },
      ],
    }),
  ],
});
