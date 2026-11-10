import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import mermaid from "astro-mermaid";

const repository = "https://github.com/schalkneethling/bcd-embed";

export default defineConfig({
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
      ],
    }),
  ],
});
