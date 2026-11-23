# Introduction page

`@bcd-embed/home` is the introduction page for `https://browser-compat.dev`. It is built with
[Astro](https://astro.build), without Starlight, and produces one static HTML page with one
stylesheet, two scripts (the element's and the status region's) and two font files. It is served as static
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
├─ .stylelintrc.json        the Baseline 2025 floor, and BEM class names, for this workspace
├─ astro.config.ts          site address, CSS and script settings, the test-only source plugin
├─ public/_headers          the response headers, including the Content-Security-Policy
├─ public/favicon.svg       the project's icon, the same file as the documentation site's
├─ public/robots.txt        allows every crawler
├─ public/font-licenses.txt the two fonts' licences, which the footer links
├─ wrangler.jsonc           the apex custom domain, static assets only
├─ scripts/assert-no-v1.mjs fails when the built site has a top-level v1 entry
├─ src/
│  ├─ data/examples.ts      the four examples, and everything the page reads from BCD
│  ├─ data/release.ts       the release badge and install command, from the element's version
│  ├─ pages/index.astro     the page
│  ├─ scripts/example-status.ts  creates the status region and fills it when the choice changes
│  ├─ styles/fonts.css      the two self-hosted typefaces
│  └─ styles/home.css       the tokens, the layout, the segmented control, and the panel switching
└─ tests/
   ├─ contrast.test.ts      the contrast formula, without a build
   ├─ contrast.ts           WCAG contrast ratios from computed colours
   ├─ examples.test.ts      the data module, without a build
   ├─ home-deploy.test.ts   the configuration, the headers, and the policy in a browser
   ├─ home-page.test.ts     builds the page and checks it in Chromium
   ├─ release.test.ts       the release badge and install command, without a build
   └─ serve.ts              serves a built copy, with the headers of `_headers` if asked
```

## Design

The page follows the owner's "Workbench" direction (23 November 2026). Its layout is the same in
both colour schemes, and the reader's `prefers-color-scheme` picks the palette, because the root
sets `color-scheme: light dark`:

| Scheme | Palette                                                              | Source of the direction |
| ------ | -------------------------------------------------------------------- | ----------------------- |
| Dark   | Espresso `#2a0b09` page, ochre `#c8914f` wordmark, cream text        | A, "Workbench, dark"    |
| Light  | Cream `#fbf1e4` page, darker ochre `#7a3b12` wordmark, espresso text | C, "Workshop, light"    |

From top to bottom the page has a header (the wordmark, which links to `/`, and a navigation with
Examples, Documentation, API and GitHub), a hero, the examples, "How the examples work", the live
table, and the footer. The API link goes to "The endpoints" on the documentation site's first
page, `https://docs.browser-compat.dev/#the-endpoints`, because the site has no page of its own for
the API. The hero holds a release badge, the one `<h1>`, the tagline, the introduction, a "Get
started" link to the component's getting started page, and the install command.

### The release badge

The badge and the install command are built from `packages/element/package.json` at build time by
`describeRelease` in `src/data/release.ts`, so nobody edits their text for a release. The page
still has to be rebuilt and redeployed to show a new version, because its deploy is manual and
outside the release workflow. Step 7 of "Each release" in
`apps/website/src/content/docs/releasing.md` does that, after the version is approved and
installable. The element's `exports` do not include its `package.json`, so the page imports the
file by its workspace path.

| Element version | Badge                                                       | Install command                                  |
| --------------- | ----------------------------------------------------------- | ------------------------------------------------ |
| `0.1.0-beta.0`  | `Beta · @schalkneethling/bcd-embed@0.1.0-beta.0`            | `npm install @schalkneethling/bcd-embed@beta`    |
| `1.1.0-rc.1`    | `Release candidate · @schalkneethling/bcd-embed@1.1.0-rc.1` | `npm install @schalkneethling/bcd-embed@rc`      |
| `1.0.0-0`       | `Prerelease · @schalkneethling/bcd-embed@1.0.0-0`           | `npm install @schalkneethling/bcd-embed@1.0.0-0` |
| `1.0.0`         | `@schalkneethling/bcd-embed@1.0.0`                          | `npm install @schalkneethling/bcd-embed`         |

Any text after the hyphen makes a version a prerelease. Its first identifier is its dist-tag, as the
release workflow stages it, and `alpha`, `beta` and `rc` are named in words; any other identifier is
shown as it is. A number alone names no stage, and npm rejects a dist-tag that reads as a semver
range ([npm dist-tag](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag), "Caveats"), so that
command pins the version.

### Fonts

The two typefaces are served from the site, never from a font service, because the policy allows
no other origin. `src/styles/fonts.css` points each `@font-face` at a file in an npm package, and
Vite copies the file into `dist/_astro` with a content hash in its name. Each rule names only the
Latin subset and only the WOFF2 file, with the Latin `unicode-range` from the package, and
`font-display: swap`.

| Typeface       | Package                                  | File shipped                            | Size     | Weights used       |
| -------------- | ---------------------------------------- | --------------------------------------- | -------- | ------------------ |
| Inter Tight    | `@fontsource-variable/inter-tight` 5.3.0 | `inter-tight-latin-wght-normal.woff2`   | 44,872 B | 300, 400, 700, 800 |
| JetBrains Mono | `@fontsource/jetbrains-mono` 5.3.0       | `jetbrains-mono-latin-400-normal.woff2` | 21,168 B | 400                |

Both packages are licensed under the SIL Open Font License 1.1. Inter Tight is the variable build,
so one file covers every weight, including the bold of the table's headers and the checked label.
Code is set in one weight, so JetBrains Mono ships one static file; `code` and `pre` set
`font-weight: 400` so that code inside a bold heading is not synthesised in bold.

`default-src 'none'` blocks fonts, so the policy names `font-src 'self'`. A test in
`tests/home-deploy.test.ts` requires the directive to be exactly `'self'` when the build ships a
font file and absent when it ships none, and requires every font the stylesheet names to be one of
the site's files.

The SIL Open Font License 1.1 requires the licence to accompany each copy of the fonts, and the
WOFF2 files carry only a copyright line and the licence's address. So `public/font-licenses.txt`
holds both packages' `LICENSE` files, unchanged, each with its font's copyright line, and the
footer links it. A test requires the shipped file to contain both installed `LICENSE` texts
exactly. When a font package is updated, rebuild the file from the two `LICENSE` files in
`node_modules`.

### Tokens

`src/styles/home.css` starts with the tokens on `:root`. Each colour that differs between the
schemes is a `light-dark()` pair; the rest of the stylesheet reads only the tokens.

| Token                          | Light     | Dark      | Used for                                               |
| ------------------------------ | --------- | --------- | ------------------------------------------------------ |
| `--home-color-ground`          | `#fbf1e4` | `#2a0b09` | The page                                               |
| `--home-color-text`            | `#2a0b09` | `#f2d3b0` | Body text and label text                               |
| `--home-color-muted`           | `#4e2a1c` | `#e3be97` | Introduction, badge, legend, summaries, footer         |
| `--home-color-accent`          | `#7a3b12` | `#c8914f` | Both wordmarks                                         |
| `--home-color-link`            | `#7a3b12` | `#e8b877` | Links (hover: `--home-color-link-hover`)               |
| `--home-color-focus`           | `#2f5236` | `#f2d3b0` | Every focus ring                                       |
| `--home-color-surface`         | `#fff`    | `#34110e` | Panels and the install command                         |
| `--home-color-line`            | `#2a0b09` | `#6b3a2a` | Decorative borders and the footer rule                 |
| `--home-color-code-surface`    | `#2f5236` | `#1c0605` | The markup sample (text: `#f2d3b0` in both)            |
| `--home-color-start`           | `#2a0b09` | `#c8914f` | The Get started link (text: `--home-color-start-text`) |
| `--home-choice-border`         | `#7a3b12` | `#b5702e` | An unchecked label's border                            |
| `--home-choice-fill`           | `#fff`    | `#3a1512` | An unchecked label (hover: `#f5e3cc`, `#4a1d17`)       |
| `--home-choice-checked-border` | `#2a0b09` | `#e0b04a` | The checked label's border                             |
| `--home-choice-checked-fill`   | `#f2d3b0` | `#2f5236` | The checked label                                      |

The palette's cutting-mat green (`#2f5236`) fills the header glyph in both schemes, and its yellow
(`#e0b04a`) is the badge's dot. A browser without `light-dark()` would compute every pair as
invalid and paint no colour, so an `@supports not (color: light-dark(#000, #fff))` block sets the
tokens to system colours there, with a grey `#808080` label border and a blue `#4285f4` focus ring,
the plain colours the control used before.

### Theming the table

The table is themed only through the tokens the component documents
(`apps/website/src/content/docs/component/styling.md`), set on `:root`; no rule of this page
reaches into the table's markup. Each registered colour token has a light and a dark member, and the
base stylesheet chooses between them, so the page sets plain colours:

| Token                                            | Light                                              | Dark      | Palette role                      |
| ------------------------------------------------ | -------------------------------------------------- | --------- | --------------------------------- |
| `--bcd-color-supported-*`                        | `#2f5236`                                          | `#9fd3a4` | Cutting-mat green                 |
| `--bcd-color-partial-*`                          | `#9a5b1e`                                          | `#e0b04a` | Ochre, yellow                     |
| `--bcd-color-unsupported-*`                      | `#a8332a`                                          | `#e8796d` | Red                               |
| `--bcd-color-unknown-*`, `--bcd-color-no-data-*` | `#6b4a3a`                                          | `#c9a27c` | Muted brown                       |
| `--bcd-color-border-*`                           | `#a0805f`                                          | `#9a6448` | Muted ochre                       |
| `--bcd-color-preview-*`, `--bcd-color-flagged-*` | default                                            | default   | Not set (see below)               |
| `--bcd-color-sticky-background`                  | the page on `:root`, the panel on `.example-panel` |           | Matches what is behind the column |

Preview and flagged keep the component's blue and violet, because the palette has neither, and
those hues keep the states apart; each state also has its own icon shape. Every state colour and the
border reach 3:1 against the page and against a panel in both schemes (the table below).

### Contrast

`tests/home-page.test.ts` reads every colour from the computed style and requires each ratio below
(text 4.5:1, borders, focus rings and the table's icons and borders 3:1). These are the values of
23 November 2026; `BCD_EMBED_HOME_CONTRAST_REPORT=1` prints them.

| Pair                                     | Light       | Dark                           | Minimum |
| ---------------------------------------- | ----------- | ------------------------------ | ------- |
| Body text on the page                    | 16.35       | 12.80                          | 4.5     |
| Unchecked label text on its fill         | 18.26       | 11.36                          | 4.5     |
| Hovered label text                       | 14.55       | 9.95                           | 4.5     |
| Checked label text                       | 12.80       | 6.18                           | 4.5     |
| Unchecked border on the page             | 7.64        | 4.63                           | 3       |
| Unchecked border on its label            | 8.53        | 4.11                           | 3       |
| Unchecked border on its hovered label    | 6.80        | 3.60                           | 3       |
| Checked border on the page               | 16.35       | 9.11                           | 3       |
| Checked border on its label              | 12.80       | 4.40                           | 3       |
| Control focus ring on the page           | 7.90        | 12.80                          | 3       |
| Link focus ring on the page              | 7.90        | 12.80                          | 3       |
| Skip link text on its fill               | 16.35       | 6.62                           | 4.5     |
| Skip link focus ring on the page         | 7.90        | 12.80                          | 3       |
| Wordmarks and navigation links           | 7.64        | 6.62 (wordmark), 10.04 (links) | 4.5     |
| Badge, introduction, legend, footer      | 11.25       | 10.50                          | 4.5     |
| Footer link                              | 7.64        | 10.04                          | 4.5     |
| Get started text on its fill             | 16.35       | 6.62                           | 4.5     |
| Install command on its fill              | 18.26       | 11.94                          | 4.5     |
| Panel heading on the panel               | 18.26       | 11.94                          | 4.5     |
| Panel summary on the panel               | 12.56       | 9.80                           | 4.5     |
| Markup sample                            | 6.18        | 13.66                          | 4.5     |
| Table supported (page / panel)           | 7.90 / 8.82 | 10.72 / 10.00                  | 3       |
| Table partial (page / panel)             | 4.84 / 5.40 | 9.11 / 8.50                    | 3       |
| Table preview (page / panel)             | 4.65 / 5.19 | 5.89 / 5.50                    | 3       |
| Table flagged (page / panel)             | 6.58 / 7.34 | 6.10 / 5.70                    | 3       |
| Table unsupported (page / panel)         | 5.93 / 6.62 | 6.42 / 5.99                    | 3       |
| Table unknown and no data (page / panel) | 7.05 / 7.88 | 7.77 / 7.26                    | 3       |
| Table border (page / panel)              | 3.27 / 3.65 | 3.73 / 3.48                    | 3       |

### Layout

The stylesheet is written Shared First: a declaration outside a media query has the same value at
every width, and each value that differs by viewport is written once for each range, so no
declaration overrides another:

| Range       | What it sets                                                             |
| ----------- | ------------------------------------------------------------------------ |
| Below 48rem | A 1rem gutter, 3rem/3.5rem around the hero, 1.25rem in each panel        |
| From 48rem  | A 2rem gutter, 6rem/4.5rem around the hero, 1.5rem in each panel         |
| Below 64rem | The markup sample in one column with the text, with 1.25rem padding      |
| From 64rem  | The markup sample beside the text that explains it, with 1.75rem padding |

The content is at most 75rem wide. At 320 pixels the page has no horizontal scroll: the
badge, the install command and the markup sample wrap, and the tables scroll inside their own
region. Class names that this page adds are BEM (`site-header__brand`, `hero__title`), which the
repository's kebab-case rule rejects, so this workspace's `.stylelintrc.json` allows a BEM element
and modifier. The older class names (`examples`, `example-panel`, `example-choices`) stay, because
the status script and the tests name them.

Astro's HTML compression removes a line break between a word and an element that starts the next
source line, which ran "with its" and `source` together. The page writes `{" "}` at the end of such
a line. A test parses the built HTML with no script running and, inside each block of running text,
fails if a letter or digit touches either side of a link, `code`, or other inline element, or if a
space sits between such an element and the punctuation after it.

The skip link, "Skip to main content", is the first stop in the focus order, so a keyboard user
can pass the header's five links. It is clipped away until it has focus, then shows at the top
left, at least 44 by 44 pixels, with the Get started link's colours; its transparent border keeps
its outline in forced colours mode. Each navigation link is at least 44 by 44 pixels too. In the
markup sample, `code` inherits the 14 pixel size of its `pre`, instead of the 0.9em that inline
code uses.

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
   reads it once and renders with no request (`packages/element/DEVELOPMENT.md`, "Source mode").
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

| State         | Selector                            | What changes                                       |
| ------------- | ----------------------------------- | -------------------------------------------------- |
| Checked       | `input:checked + label`             | A 4 pixel border, bold text, a filled background   |
| Keyboard ring | `input:focus-visible + label`       | A 3 pixel outline, offset 3 pixels from the border |
| Hover         | `input:not(:checked) + label:hover` | The background only                                |

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

The colours are the `--home-choice-*` tokens (see "Tokens" above). In the dark scheme the checked
label is cutting-mat green with a yellow border; in the light scheme it is cream with an espresso
border. A browser that parses `:has()` but not `light-dark()` gets the system colours from the
`@supports not (color: light-dark(#000, #fff))` block instead: a grey `#808080` border, a
`CanvasText` checked border, and a blue `#4285f4` ring, each of which holds 3:1 on white and on near
black. The checked label keeps its thicker border and bold text there, and hover shows no change.
A test plays that browser by renaming `light-dark(` in the stylesheet, which also makes the
`@supports` condition true.

Stylelint with `stylelint-plugin-use-baseline` 1.4.8 treats `light-dark()` as available from 2024:
it flags it at the `widely` and 2023 floors and reports nothing at 2024 and 2025 (checked on 21
November 2026). The repository's policy floor is 2025 (`calavera.config.json`), but the root
`.stylelintrc.json` still checks for widely available features, the same state as
`packages/element/DEVELOPMENT.md`, "Building and linting it". So this workspace's `.stylelintrc.json`
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
  the label text (resting, hovered, checked) and the body text (WCAG 1.4.11 and 1.4.3). A second
  test covers the rest of the palette: 4.5:1 for every other text colour against what is behind it,
  3:1 for the links' focus ring, and 3:1 for each of the table's state colours and its border
  against the page and against a panel. The values are in "Contrast" above. axe cannot check
  non-text contrast.
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

| Import                                | Resolves to                                                      | Where it ends up                                    |
| ------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| `@schalkneethling/bcd-embed`          | `packages/element/dist/index.js`, kept by the `sideEffects` list | Bundled with Lit into the element's script file     |
| `@schalkneethling/bcd-embed/base.css` | `packages/element/dist/base.css`                                 | Bundled, unminified, into the page's one stylesheet |
| `@bcd-embed/core`, `schema`           | Their `dist/index.js`                                            | Run at build time only; nothing of them ships       |

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

`src/styles/home.css` sets `color-scheme: light dark` and paints the page colour on the root,
because the base stylesheet picks its colours with `light-dark()`, and its dark colours fail
contrast on a light background. Vite resolves the package paths in `src/styles/fonts.css` and copies
each font file into `dist/_astro`, so no setting is needed for the fonts.

## The live table

`<bcd-compat-table query="html.elements.dialog">` uses fetch mode with the default lazy loading. It
sends its one request when it comes within 400 pixels of the viewport, to
`https://api.browser-compat.dev/v1/current/features/html.elements.dialog.json`. The hero and the
examples put it well below the first screen, so in a viewport up to about 1,000 pixels tall it
waits until the reader scrolls. The tests that need its table scroll to it first. The policy in `public/_headers` allows that origin, and only that origin, in `connect-src`.

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
| A header before `main` with the wordmark and four navigation links, with their addresses                                                                                               |
| The release badge and install command match the element's `package.json`, and Get started links to the getting started page                                                            |
| No word runs into an inline element on either side, and no space comes before the punctuation after one                                                                                |
| The site ships both font licences unchanged, and the footer links them                                                                                                                 |
| A skip link is the first stop, shows at 44 by 44 pixels when focused, and moves the next Tab into `main`                                                                               |
| Every navigation link is at least 44 by 44 pixels at 320 and 1280 pixels wide                                                                                                          |
| The markup sample's `code` has the sample's 14 pixel size                                                                                                                              |
| Every `light-dark()` token in `home.css` has a fallback in the `@supports not (color: light-dark(…))` block                                                                            |
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
violation, all five tables rendered, and both typefaces loaded. Controls show the listener works: a
policy of `default-src 'none'` alone, the policy without `connect-src`, the policy without
`img-src`, the policy without `font-src` (both font files blocked, no typeface loaded), and the
policy with an inline script and a `style` attribute injected. Two more tests serve a stand-in for
Cloudflare's analytics beacon at a tokenised path under a second origin, and show that it runs under
the beacon's source with its trailing slash and is blocked without it. `pnpm check` runs the file in
Chromium. Set `BCD_EMBED_HOME_CSP_ENGINES=chromium,firefox,webkit` to run it in all three (the
engines Playwright installs with `pnpm exec playwright install`), and `BCD_EMBED_HOME_CSP_REPORT=1`
to print each visit's violations. As in the page test, every request that leaves the local machine
is aborted, and the hosted API is answered from installed BCD.
