# Introduction page

`@bcd-embed/home` is the introduction page for `https://browser-compat.dev`. It is built with
[Astro](https://astro.build), without Starlight, and produces one static HTML page with one
stylesheet and one script. It is not deployed yet: the Wrangler configuration, the response headers,
and the deploy belong to #211, and the styling of the example picker to #210.

The page shows four example tables, one at a time, chosen with four radio inputs. Their data is
built into the page, so showing them sends no request. One more table, lower on the page, asks the
hosted API for its data when it scrolls near.

## Commands

Run these from the repository root:

| Command                                   | What it does                                                          |
| ----------------------------------------- | --------------------------------------------------------------------- |
| `pnpm dev:home`                           | Serves the page locally and reloads on every change                   |
| `pnpm --filter @bcd-embed/home build`     | Writes the page to `apps/home/dist`, then checks it has no `v1` entry |
| `pnpm --filter @bcd-embed/home typecheck` | Generates Astro's types, then type-checks the TypeScript files        |
| `pnpm exec vitest run apps/home`          | Runs this workspace's tests                                           |

`pnpm check` runs the tests, the type check, and the build with every other workspace. The tests
load the page in Chromium's headless shell, so install it once with
`pnpm exec playwright install --only-shell chromium`.

## Where things are

```
apps/home/
├─ astro.config.ts          site address, workspace source resolution, CSS and script settings
├─ scripts/assert-no-v1.mjs fails when the built site has a top-level v1 entry
├─ src/
│  ├─ data/examples.ts      the four examples, and everything the page reads from BCD
│  ├─ pages/index.astro     the page
│  └─ styles/home.css       the page's own styles and the panel switching
└─ tests/
   ├─ examples.test.ts      the data module, without a build
   └─ home-page.test.ts     builds the page and checks it in Chromium
```

## The examples

| Radio      | BCD key                             | Why this feature                                                             |
| ---------- | ----------------------------------- | ---------------------------------------------------------------------------- |
| HTML       | `html.elements.video.loading`       | Owner's choice (18 November 2026)                                            |
| CSS        | `css.properties.line-clamp`         | Owner's choice; prefixed support, previews and flags                         |
| JavaScript | `javascript.builtins.Error.isError` | Partial implementations in Safari and Node.js, and a Node.js history         |
| Web API    | `api.Navigator.share`               | Owner's choice; a partial Chrome history, a Firefox flag, no Node.js support |

The JavaScript key replaced `javascript.operators.import`, which every engine supports in a way that
shows nothing interesting (#209). In BCD 8.1.9, Safari has a preview and, from 18.4, a partial
implementation with a note, and Node.js is partial from 24.0.0 and full from 24.3.0. A test fails
if the Safari and Node.js data stops holding a partial implementation.

The live table requests `html.elements.dialog`. `LIVE_EXAMPLE` in `src/data/examples.ts` names it.

## How the data gets into the page

The page reads the installed `@mdn/browser-compat-data` (BCD) at build time, in the front matter of
`src/pages/index.astro`. Nothing is fetched: the build does what the API's generator does for one
key, for each of the four keys.

1. `findSubtree` walks BCD down the key's segments. A key that is missing, or that names a
   namespace or an inherited property such as `constructor`, throws `HomeDataError`, which fails
   the build. So a BCD release that renames or removes one of the keys cannot ship an empty panel.
2. `buildFeatureResponse` passes the subtree to `normalizeFeatureSubtree` from `@bcd-embed/core`,
   wraps the result in the contract's envelope (`contract` and `query`), and checks it with
   `featureResponseSchema` from `@bcd-embed/schema`. The result is the body the API would answer.
3. `toScriptJson` turns it into the text of a `<script type="application/json">`, and the page
   writes that next to a `<bcd-compat-table source="…">` that names the script's `id`. The element
   reads it once and renders with no request (`packages/element/README.md`, "Source mode").
4. `findMdnUrl` gives each panel's fallback link: the feature's MDN Web Docs page, or the nearest
   ancestor's page when the feature has none. `html.elements.video.loading` has none, so it links
   to the `<video>` page. The `#browser_compatibility` fragment is added.

**Cost.** Astro loads BCD once, which is O(n) time and space for the n bytes of `data.json`, about
20 MB. Each key then costs O(d) for its d segments to find, and O(s) to normalize, check, and
serialize for its s statements, notes, and flags. The four subtrees hold eleven features in all, so the
build does no work that grows with the size of BCD beyond the one load.

**The page states its BCD version**, from `bcd.__meta.version`, in its second paragraph.

### The escaping rule

`toScriptJson` writes every `<` in the JSON as the six characters `<`, and `JSON.parse` turns
them back into `<`. This is the page's one injection control. BCD notes contain markup, such as
`<code>`, and a note that held `</script>` would end the script early, while `<!--<script>` would
make the HTML parser swallow the rest of the page. Escaping every `<` rules out both, and anything
else that starts with `<`. A test writes a note with both sequences and `alert(1)` into the built
page and checks that the page still has exactly four JSON scripts, that no dialog opens, and that
the note appears as text in the table.

## How the panels switch

All four panels are in the HTML. Four rules in `src/styles/home.css` use `:has()` on the
`.examples` wrapper to hide every panel whose `data-example` does not match the checked radio's
`value`. No script is involved, so switching works with script turned off. Focus stays on the
radio: the arrow keys move between radios as they do in any native radio group, and nothing moves
focus to the table.

A browser without `:has()` cannot parse those selectors and drops the rules, so every panel shows
under its own heading. That is the fallback, which is why the file has no `@supports` block.

```
.examples:has([value="css"]:checked)
  ├─ panel data-example="css"      → shown
  └─ other three panels            → display: none
```

## Build settings

`astro.config.ts` holds four settings that the page depends on.

| Setting                                                                  | Why                                                                                                                                                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The `bcd-embed-workspace-source` plugin                                  | The workspace packages export `dist/`, which does not exist until `pnpm build` runs, and `pnpm check` runs the tests first. The plugin points each import at the package's source instead. |
| `moduleSideEffects: true` on the element                                 | The element's `sideEffects` lists only `dist/` files, so without it the bundler drops `import "@bcd-embed/element";` from the source and nothing defines the element.                      |
| `vite.build.cssMinify: false`                                            | Vite's default minifier drops the base stylesheet's `@layer` statement and rewrites its `light-dark()` colours into custom properties the page never defines (#246).                       |
| `build.inlineStylesheets: "never"` and `vite.build.assetsInlineLimit: 0` | Every stylesheet and script is a file, never inline, so #211 can serve the page with `style-src 'self'` and `script-src 'self'`.                                                           |

`src/styles/home.css` sets `color-scheme: light dark` and paints `Canvas` on the root, because the
base stylesheet picks its colours with `light-dark()`, and its dark colours fail contrast on white.

## The live table

`<bcd-compat-table query="html.elements.dialog">` uses fetch mode with the default lazy loading. It
sends its one request when it comes within 400 pixels of the viewport, to
`https://api.browser-compat.dev/v1/current/features/html.elements.dialog.json`. In a viewport about
720 pixels tall the table is already that close when the page loads, so it requests at once; in a
shorter one it waits until the reader scrolls. #211 must allow that origin in `connect-src`.

## Tests

`tests/examples.test.ts` checks the data module against the installed BCD. `tests/home-page.test.ts`
builds the page into a temporary directory with `NODE_ENV=production` (Vitest sets `test`, which
would select Lit's development build), serves it on `127.0.0.1`, and loads it in Chromium. Every
request to `https://api.browser-compat.dev` is answered by the test from installed BCD, and every
other request that leaves the local server is aborted and recorded, so no test reaches a real
server.

| What the page test checks                                                                                  |
| ---------------------------------------------------------------------------------------------------------- |
| One `<h1>`, an introduction, and a fieldset whose legend and four radios are each followed by their label  |
| Every radio is rendered, not `display: none` or `visibility: hidden`, and is in the accessibility tree     |
| Only the HTML panel shows on load; a click on CSS shows only the CSS panel, with its rendered table        |
| Three right arrows in under a second reach the Web API panel, focus the Web API radio, and send no request |
| Focus stays on the selected radio after every selection                                                    |
| With script off, the panels switch and each shows its MDN Web Docs link                                    |
| With the `:has()` rules deleted, all four panels show under their headings                                 |
| Each panel has one JSON script, with no `<`, that validates and equals the build from installed BCD        |
| A hostile note stays inside its script, and nothing runs                                                   |
| The live table sends no request until it scrolls near, then exactly one                                    |
| The stylesheet keeps `@layer bcd-embed.base;` and `light-dark()`, and the page has no `<style>` element    |
| The build has no top-level `v1` entry, and the check fails when one is added                               |

Firefox and WebKit do not run these tests. The accessibility checks, axe among them, arrive with #210.

## No top-level `v1` entry

The zone's rate limiting rule matches `/v1/` on every hostname of `browser-compat.dev`, so a
top-level `v1` file or folder in the site would be answered by the rule instead of the site. The
`build` script runs `scripts/assert-no-v1.mjs dist` after `astro build`, and the page test runs the
same check on its own build, then adds a `v1` folder and shows the check failing.
