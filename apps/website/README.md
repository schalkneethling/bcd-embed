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
├─ astro.config.ts          site address, title, sidebar, and diagram settings
├─ wrangler.jsonc           Cloudflare hosting configuration
├─ public/                  files copied to the site as they are
│  ├─ _headers              response headers Cloudflare adds
│  └─ robots.txt            crawler rules and the sitemap address
└─ src/
   ├─ content.config.ts     tells Astro that src/content/docs holds the pages
   ├─ content/docs/         one Markdown file per page
   └─ styles/diagrams.css   layout fixes for diagrams
```

To add a page, add a Markdown file to `src/content/docs` with a `title` in its
front matter, then add its slug, which is the file name without `.md`, to the
`sidebar` list in `astro.config.ts`.

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
in `_astro/`, and a report-only Content-Security-Policy. Do not add a top-level
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
