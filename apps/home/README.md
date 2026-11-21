# Introduction page

`@bcd-embed/home` is the introduction page for `https://browser-compat.dev`. It is built with
[Astro](https://astro.build), without Starlight, and produces one static HTML page with one
stylesheet and two scripts, the element's and the status region's. It is served as static
files by a Cloudflare Worker with no script, only on that address, under an enforcing
Content-Security-Policy (see "Deploying" below). It has been deployed since 21 November 2026.

The page shows four example tables, one at a time, chosen with four radio inputs. Their data is
built into the page, so showing them sends no request. One more table, lower on the page, asks the
hosted API for its data when it scrolls near.

## Commands

Run these from the repository root:

| Command                                            | What it does                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `pnpm dev:home`                                    | Serves the page locally and reloads on every change (see below)                                         |
| `pnpm --filter @bcd-embed/home build`              | Writes the page to `apps/home/dist`, then checks it has no `v1` entry                                   |
| `pnpm --filter @bcd-embed/home typecheck`          | Generates Astro's types, then type-checks the TypeScript files                                          |
| `pnpm exec vitest run apps/home`                   | Runs this workspace's tests                                                                             |
| `pnpm --filter @bcd-embed/home run deploy:dry-run` | Builds the packages and the page, then validates the deploy without uploading. The owner runs `deploy`. |

`pnpm check` runs the tests, the type check, and the build with every other workspace. The tests
load the page in Chromium's headless shell, so install it once with
`pnpm exec playwright install --only-shell chromium`.

## Where things are

```
apps/home/
├─ .stylelintrc.json        the Baseline 2025 floor for this workspace's stylesheet
├─ astro.config.ts          site address, CSS and script settings, the test-only source plugin
├─ public/_headers          the response headers, including the Content-Security-Policy
├─ public/favicon.svg       the project's icon, the same file as the documentation site's
├─ public/robots.txt        allows every crawler
├─ wrangler.jsonc           the apex custom domain, static assets only
├─ scripts/assert-no-v1.mjs fails when the built site has a top-level v1 entry
├─ src/
│  ├─ data/examples.ts      the four examples, and everything the page reads from BCD
│  ├─ pages/index.astro     the page
│  ├─ scripts/example-status.ts  creates the status region and fills it when the choice changes
│  └─ styles/home.css       the page's own styles, the segmented control, and the panel switching
└─ tests/
   ├─ contrast.test.ts      the contrast formula, without a build
   ├─ contrast.ts           WCAG contrast ratios from computed colours
   ├─ examples.test.ts      the data module, without a build
   ├─ home-deploy.test.ts   the configuration, the headers, and the policy in a browser
   ├─ home-page.test.ts     builds the page and checks it in Chromium
   └─ serve.ts              serves a built copy, with the headers of `_headers` if asked
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
4. `findMdnPage` gives each panel's fallback link: the feature's MDN Web Docs page, or the nearest
   ancestor's page when the feature has none, with the `#browser_compatibility` fragment added.
   The link text names the page it links to. `html.elements.video.loading` has no page, so its link
   goes to the `<video>` page and reads "Browser compatibility for `<video>` on MDN Web Docs". Every
   `mdn_url` on the key's path must start with `https://developer.mozilla.org/`, or the build
   fails, so a bad address in a BCD release cannot become a link on the page.

**Cost.** Astro loads BCD once, which is O(n) time and space for the n bytes of `data.json`, about
20 MB. Each key then costs O(d) for its d segments to find, and O(s) to normalize, check, and
serialize for its s statements, notes, and flags. The four subtrees hold eleven features in all, so the
build does no work that grows with the size of BCD beyond the one load.

**The page states its BCD version**, from `bcd.__meta.version`, in its second paragraph.

### The escaping rule

`toScriptJson` writes every `<` in the JSON as the six characters `\u003c`, and `JSON.parse` turns
them back into `<`. This is the page's one injection control. BCD notes contain markup, such as
`<code>`, and a note that held `</script>` would end the script early, while `<!--<script>` would
make the HTML parser swallow the rest of the page. Escaping every `<` rules out both, and anything
else that starts with `<`. A test writes a note with both sequences and `alert(1)` into the built
page and checks that the page still has exactly four JSON scripts, that no dialog opens, and that
the note appears as text in the table.

## How the panels switch

All four panels are in the HTML. One rule in `src/styles/home.css`, with a list of four selectors,
uses `:has()` on the `.examples` wrapper to hide every panel whose `data-example` does not match the checked radio's
`value`. No script is involved, so switching works with script turned off. Focus stays on the
radio: the arrow keys move between radios as they do in any native radio group, and nothing moves
focus to the table.

A browser without `:has()` cannot parse those selectors and drops the rules, so every panel shows
under its own heading. The radios would then choose nothing, so an
`@supports not selector(:has(*))` block hides the fieldset in that browser. A browser too old to
know `selector()` in `@supports` treats the condition as false, so `not` hides the fieldset there
too, and such a browser lacks `:has()` anyway. In the installed `stylelint-plugin-use-baseline`
1.4.8, `:has()` is widely available (Baseline 2023), and the plugin reports nothing for this block
at the root configuration or at the 2025 floor.

```
.examples:has([value="css"]:checked)
  ├─ panel data-example="css"      → shown
  └─ other three panels            → display: none
```

## The segmented control

The four radios look like one row of four buttons (#210). Each radio is hidden with a clip pattern
(`position: absolute`, a 1 pixel box, `clip-path: inset(50%)`), never `display: none`, so it stays
in the accessibility tree and in the focus order. Its label is the visible button, and the rules
reach the label from the radio with the sibling combinator:

| State         | Selector                            | What changes                                        |
| ------------- | ----------------------------------- | --------------------------------------------------- |
| Checked       | `input:checked + label`             | A 4 pixel border in `CanvasText`, bold text, a tint |
| Keyboard ring | `input:focus-visible + label`       | A 3 pixel outline, offset 3 pixels from the border  |
| Hover         | `input:not(:checked) + label:hover` | The background only                                 |

No focus or checked rule of the control uses `:has()`, and none uses `box-shadow`, which forced
colours mode removes. The checked state does not depend on colour, because its border is thicker
and its text is bold. A radio group puts keyboard focus on the checked radio, so the ring and the
checked style show together. The ring's offset is at least 2 pixels, so it never touches the
checked border, and the colour next to it is the page's on both sides, which is why the contrast
test measures it against the page.

Every label is at least 44 by 44 CSS pixels, above the 24 pixels of WCAG 2.5.8 (Target Size,
Minimum). The labels share the row equally, so bold text moves nothing. Nothing transitions, so
`prefers-reduced-motion: reduce` has nothing to turn off, and a test checks that no transition
starts.

The colours are `light-dark()` pairs with literal arguments. The text and the checked border are
the system colours `CanvasText` on `Canvas`. Each `light-dark()` declaration follows a plain one: a
grey border, and a blue ring that holds 3:1 on white and on near black. A browser that parses
`:has()` but not `light-dark()` drops the second declaration at parse time and keeps the plain one,
so it still shows a border and a focus ring. A `var()` argument would parse everywhere and then
compute as invalid, which is why the pairs are literal. The checked label keeps its thicker border
and bold text in that browser, and hover shows no change, because a light grey would sit under
white text in a dark scheme. A test plays that browser by renaming `light-dark(` in the stylesheet.

Stylelint with `stylelint-plugin-use-baseline` 1.4.8 treats `light-dark()` as available from 2024:
it flags it at the `widely` and 2023 floors and reports nothing at 2024 and 2025 (checked on 21
November 2026). The repository's policy floor is 2025 (`calavera.config.json`), but the root
`.stylelintrc.json` still checks for widely available features, the same state as
`packages/element/README.md`, "Building and linting it". So this workspace's `.stylelintrc.json`
extends the root and sets `available: 2025`. Delete it when the root configuration carries the
floor.

### Known limit: the keyboard ring in WebKit

In Playwright's WebKit 27.2, `:focus-visible` matches the first radio after Tab (`true`), and stops
matching after an arrow key moves focus to the next radio (`false`), so the ring disappears. The
checked border and bold text still move with the arrow keys, so the position stays visible. A
review reproduced it on a bare page with no stylesheet, so it is the engine's behaviour and not
this page's. Real Safari was not tested. The rule stays `input:focus-visible + label`, as #210
requires, and the owner's manual pass should confirm what Safari does.

## The status region

The panels switch with CSS alone, which tells a screen reader nothing. So
`src/scripts/example-status.ts` creates a `<div role="status">` after the fieldset when the page
loads, empty, and sets one sentence on each `change` event, such as "Showing the Cascading Style
Sheets (CSS) example: line-clamp". Each radio carries its sentence in `data-announcement`, which
the build writes from `announcement` in `src/data/examples.ts`. The region is clipped away, not
`display: none`, because a screen reader skips an element that is not rendered.

The static HTML has no status element, so the page without script has no empty region. Focus stays
on the radio. The script is its own file, never inline and not part of the element's bundle, so the
region does not depend on the element's script running, and the page can be served with `script-src 'self'` (#211), and the built HTML has no `style` attribute, so it can
be served with `style-src 'self'`.

## Accessibility checks

The page test covers each criterion of #210 that a browser can measure, in Chromium:

- **Contrast.** The test reads each colour from `getComputedStyle` and applies the WCAG relative
  luminance formula (`tests/contrast.ts`). In light and dark it requires 3:1 for the unchecked
  border against the page and against the label (resting and hovered), for the checked border
  against the page and against its tint, and for the focus ring against the page, and 4.5:1 for
  the label text (resting, hovered, checked) and the body text (WCAG 1.4.11 and 1.4.3). axe cannot
  check non-text contrast.
- **Forced colours.** With Playwright's `forcedColors: "active"`, the test photographs one label
  unchecked, checked, and checked with the keyboard ring, and requires all three pictures to
  differ.
- **axe.** `@axe-core/playwright` reports no violation with each of the four panels showing, in
  light and dark.
- **A browser without `light-dark()`.** The same test renames `light-dark(` in the stylesheet and
  requires a border, a thicker checked border, and a 3 pixel ring with 3:1 against the page.
- **Reduced motion.** Under `prefers-reduced-motion: reduce`, no element of the page has a
  transition duration, and no transition starts across a selection and a table disclosure.
- **Size and layout.** Every label is at least 44 pixels each way at 320 and 1280 pixels wide, and
  choosing an example moves no label.

Set `BCD_EMBED_HOME_SCREENSHOTS` to a directory to keep the screenshots the tests take (the control
in light, dark, and forced colours), and `BCD_EMBED_HOME_CONTRAST_REPORT=1` to print each ratio.

## What the deployed page contains

The deployed page ships what a consumer of the packages gets. `pnpm build` builds the workspaces in
dependency order, so `schema`, `core`, and `element` are built before this page, and the page
imports each through its `exports`:

| Import                        | Resolves to                                                      | Where it ends up                                    |
| ----------------------------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| `@bcd-embed/element`          | `packages/element/dist/index.js`, kept by the `sideEffects` list | Bundled with Lit into the element's script file     |
| `@bcd-embed/element/base.css` | `packages/element/dist/base.css`                                 | Bundled, unminified, into the page's one stylesheet |
| `@bcd-embed/core`, `schema`   | Their `dist/index.js`                                            | Run at build time only; nothing of them ships       |

So `pnpm --filter @bcd-embed/home build` and `pnpm dev:home` need those packages built first. On a
fresh checkout, run `pnpm --filter "@bcd-embed/home^..." build` once, which builds this workspace's
dependencies and not the workspace itself. Without them the build stops with "failed to resolve
import".

The page test is the one exception. `pnpm check` runs the tests before it builds anything, so
`tests/home-page.test.ts` sets `BCD_EMBED_HOME_WORKSPACE_SOURCE=1`, and a plugin in
`astro.config.ts` then points each import at the package's source, as the root `vitest.config.ts`
does. The plugin marks the element's `src/index.ts` as having side effects, because its
`sideEffects` list names only `dist/` files and the bundler would otherwise drop the import. The
type checker reads the source through `paths` in `tsconfig.json` in both cases.

## Build settings

`astro.config.ts` holds three settings that the deployed page depends on, besides the test-only
plugin above.

| Setting                                                                  | Why                                                                                                                                                                  |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vite.build.cssMinify: false`                                            | Vite's default minifier drops the base stylesheet's `@layer` statement and rewrites its `light-dark()` colours into custom properties the page never defines (#246). |
| `build.inlineStylesheets: "never"` and `vite.build.assetsInlineLimit: 0` | Every stylesheet and script is a file, never inline, so #211 can serve the page with `style-src 'self'` and `script-src 'self'`.                                     |

`src/styles/home.css` sets `color-scheme: light dark` and paints `Canvas` on the root, because the
base stylesheet picks its colours with `light-dark()`, and its dark colours fail contrast on white.

## The live table

`<bcd-compat-table query="html.elements.dialog">` uses fetch mode with the default lazy loading. It
sends its one request when it comes within 400 pixels of the viewport, to
`https://api.browser-compat.dev/v1/current/features/html.elements.dialog.json`. In a viewport about
720 pixels tall the table is already that close when the page loads, so it requests at once; in a
shorter one it waits until the reader scrolls. The policy in `public/_headers` allows that origin, and only that origin, in `connect-src`.

## Tests

`tests/examples.test.ts` checks the data module against the installed BCD. `tests/home-page.test.ts`
builds the page into a temporary directory with `NODE_ENV=production` (Vitest sets `test`, which
would select Lit's development build), serves it on `127.0.0.1`, and loads it in Chromium. Every
request to `https://api.browser-compat.dev` is answered by the test from installed BCD, and every
other request that leaves the local server is aborted and recorded, so no test reaches a real
server.

| What the page test checks                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One `<h1>`, an introduction, and a fieldset whose legend and four radios are each followed by their label                                                                              |
| Every radio is rendered, not `display: none` or `visibility: hidden`, and is in the accessibility tree                                                                                 |
| Only the HTML panel shows on load; a click on CSS shows only the CSS panel, with its rendered table                                                                                    |
| Each of three right arrows switches the panel at once, ending on Web API with focus there, and sends no request                                                                        |
| Focus stays on the selected radio after every selection                                                                                                                                |
| With script off, the panels switch, each shows its MDN Web Docs link, and the HTML link names `<video>`                                                                                |
| Without `:has()`, all four panels show under their headings and the fieldset is hidden                                                                                                 |
| Each panel has one JSON script, with no `<`, that validates and equals the build from installed BCD                                                                                    |
| A hostile note stays inside its script, and nothing runs                                                                                                                               |
| The live table sends no request until it scrolls near, then exactly one                                                                                                                |
| The stylesheet keeps `@layer bcd-embed.base;` and `light-dark()`, and the page has no `<style>` element                                                                                |
| The built HTML has no `role="status"`, no inline script, and no `style` attribute; a loaded page has one empty status region, and a selection sets one sentence that names the example |
| The control's rules use `input:checked + label` and `input:focus-visible + label`, with no `:has()` or `box-shadow`                                                                    |
| The checked label has a thicker border and bold text; the keyboard ring is an outline of at least 2 pixels                                                                             |
| Contrast, target size, no transition under reduced motion, forced colours, and axe (see "Accessibility checks")                                                                        |
| The build has no top-level `v1` entry; the check rejects one, and its command line exits with code 1                                                                                   |

The arrow-key test does not time the presses. Timed from Node, they would measure Playwright's round
trips rather than the page, so the test checks that each press takes effect before the next and
that nothing is requested. Firefox and WebKit do not run these tests.

## No top-level `v1` entry

The zone's rate limiting rule matches `/v1/` on every hostname of `browser-compat.dev`, so a
top-level `v1` file or folder in the site would be answered by the rule instead of the site. The
`build` script runs `scripts/assert-no-v1.mjs dist` after `astro build`, and the page test runs the
same check on its own build, then adds a `v1` folder and shows the check failing.

## Deploying

The page is built to be a Cloudflare Worker with no script: `wrangler.jsonc` serves the files in
`dist/` and answers only on the apex custom domain `browser-compat.dev`, with `workers_dev` and
`preview_urls` off. `public/_headers` sends `X-Content-Type-Options`, `Referrer-Policy`, and an
enforcing Content-Security-Policy, and `public/robots.txt` allows every crawler. The owner deploys
it, with `pnpm --filter @bcd-embed/home run deploy`, which first builds the packages the page
imports (`build:dependencies`) and then the page. The commands, the checks to run afterwards, the
reason for each directive of the policy, the beacon's trailing slash, the `www` redirect, and the
rollback are in the
[deployment page](../website/src/content/docs/deployment.md#deploying-the-introduction-page).

`tests/home-deploy.test.ts` serves a build on `127.0.0.1` with the exact headers of `_headers`,
listens for `securitypolicyviolation` events in the page and in any worker, and requires no
violation and all five tables rendered. Controls show the listener works: a policy of
`default-src 'none'` alone, the policy without `connect-src`, the policy without `img-src`, and the
policy with an inline script and a `style` attribute injected. Two more tests serve a stand-in for
Cloudflare's analytics beacon at a tokenised path under a second origin, and show that it runs under
the beacon's source with its trailing slash and is blocked without it. `pnpm check` runs the file in
Chromium. Set `BCD_EMBED_HOME_CSP_ENGINES=chromium,firefox,webkit` to run it in all three (the
engines Playwright installs with `pnpm exec playwright install`), and `BCD_EMBED_HOME_CSP_REPORT=1`
to print each visit's violations. As in the page test, every request that leaves the local machine
is aborted, and the hosted API is answered from installed BCD.
