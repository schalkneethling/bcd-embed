# Documentation site

`@bcd-embed/website` is the project's documentation site. It is built with
[Starlight](https://starlight.astro.build), a documentation theme for the
[Astro](https://astro.build) site generator, and it produces static files
only.

This workspace is separate from `apps/docs`, which is the playground that
validates a response against the contract.

## Commands

Run these from the repository root:

| Command                                           | What it does                                         |
| ------------------------------------------------- | ---------------------------------------------------- |
| `pnpm dev:website`                                | Serves the site locally and reloads on every change  |
| `pnpm --filter @bcd-embed/website build`          | Writes the static site to `apps/website/dist`        |
| `pnpm --filter @bcd-embed/website typecheck`      | Generates Astro's types, then type-checks the config |
| `pnpm --filter @bcd-embed/website deploy:dry-run` | Builds, then checks the upload without deploying     |
| `pnpm --filter @bcd-embed/website run deploy`     | Builds, then deploys to Cloudflare                   |

`pnpm check` runs the build and the type check with every other workspace.

## Where things are

```
apps/website/
├─ astro.config.ts          site address, title, sidebar, diagram settings,
│                           and where the live example finds the element
├─ wrangler.jsonc           Cloudflare hosting configuration
├─ public/                  files copied to the site as they are
│  ├─ _headers              response headers Cloudflare adds
│  └─ robots.txt            crawler rules and the sitemap address
└─ src/
   ├─ components/           LiveExample.astro, the getting-started page's table
   ├─ content.config.ts     tells Astro that src/content/docs holds the pages
   ├─ content/docs/         one Markdown file per page
   │  └─ component/         the web component's pages
   └─ styles/diagrams.css   layout fixes for diagrams
```

To add a page, add a Markdown file to `src/content/docs` with a `title` in its
front matter, then add its slug, which is the file name without `.md`, to the
`sidebar` list in `astro.config.ts`.

## The web component's pages

The pages under `src/content/docs/component/` document `<bcd-compat-table>`.
They are Markdown, except `getting-started.mdx`, which is MDX because it
renders `src/components/LiveExample.astro`. Three rules keep them from
drifting from the element, and `tests/website-component-docs.test.ts` at the
repository root checks each one:

- Every code sample is the whole of a file, or at least three consecutive
  lines of it, and the file is in `packages/element/examples/` or is the
  framework pages' `packages/element/e2e/frameworks/vite.config.ts`. A comment
  on the line before the fence names the file:
  `<!-- sample: packages/element/examples/fetch-mode.html -->` in Markdown, and
  `{/* sample: … */}` in MDX, which does not accept HTML comments. Change the
  example file first, then copy the change into the page. A shell (`sh`) block
  may hold `pnpm add @bcd-embed/element`, which cannot run until the package is
  published, or a `pnpm` script that exists in the root `package.json` or in
  the `package.json` of the workspace it names with `--filter`.
- Every attribute, property, event, error reason, token, and class name must
  exist in `packages/element/custom-elements.json`, the element's public types,
  its stylesheet, or its render code, and the attributes, events, and styling
  pages must list all of them.
- The live example must show its fallback link with script turned off, and
  must render the table under the site's own report-only policy. The test
  listens for violations in the page and in Pagefind's search worker, in
  Chromium only, and fails on any report except one that predates these pages:
  the worker's `script-src wasm-eval`. Two controls remove one part of
  `connect-src` each and check that a violation is then reported. The test
  answers for the hosted API, so it sends no request to production.

The live example imports `@bcd-embed/element` and its stylesheet as a page
would. `astro.config.ts` resolves both names to the element's source, because
`pnpm check` builds the site in a test before any package is built. It also
marks the entry as having side effects: the element's `package.json` lists only
its `dist` files under `sideEffects`, so without the mark the bundler drops the
import and the element is never defined.

## Diagrams

A fenced code block marked `mermaid` becomes a diagram.
[astro-mermaid](https://github.com/joesaby/astro-mermaid) draws it in the
browser with [Mermaid](https://mermaid.js.org), and draws it again when the
reader switches between the light and dark themes.

Flowcharts shrink to fit a narrow screen. Sequence diagrams do not shrink,
because their labels become too small to read; they keep their size and scroll
sideways inside their own box. Keep a flowchart to two boxes side by side, so
that it stays readable on a phone.

## Hosting

The site is hosted on Cloudflare as a Worker that serves static assets, with
no Worker script. `wrangler.jsonc` names the Worker `bcd-embed-website`, points
it at `dist/`, and attaches it to `docs.browser-compat.dev` as a Custom Domain.
`workers_dev: false` and `preview_urls: false` leave that hostname as the only
address.

`astro.config.ts` sets `site` to `https://docs.browser-compat.dev`, which
Starlight needs to write `sitemap-index.xml`. `public/_headers` sets the
security headers, a one-year `immutable` cache lifetime for the hashed files
in `_astro/`, and a report-only Content-Security-Policy. The policy's
`connect-src` allows `https://api.browser-compat.dev`, which the live example
requests. Do not add a top-level
`v1` folder to `public/`, because the zone's rate limiting rule matches
`/v1/`; `tests/website-deploy.test.ts` fails if the build has one.

A deploy is a manual command that needs an interactive Wrangler login for the
Cloudflare account:

```sh
pnpm --filter @bcd-embed/website run deploy
```

The [deployment page](./src/content/docs/deployment.md#deploying-the-documentation-site)
lists the full command sequence, the checks that confirm a deploy, and the
rollback procedure.
