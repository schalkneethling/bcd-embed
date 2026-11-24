# Developing `@schalkneethling/bcd-embed`

This file is the maintainers' guide to the package: how it is built, tested, and laid out.
`README.md` beside it is the consumer guide that npm shows on the package page, and the
documentation site has the full reader-facing guide. "Releasing the component" on the
documentation site (`apps/website/src/content/docs/releasing.md`) covers publishing to npm.

The `<bcd-compat-table>` web component (`docs/planning/03-web-component-architecture.md`). The
element renders in three modes. In fetch mode it requests the feature named by its `query`
attribute from the API. In data mode a page assigns a payload to its `data` property, and the
element renders the table with no request. In source mode the `source` attribute names a
`<script type="application/json">` that holds the payload, and the element renders it with no
request and no script of the page's own (see "Source mode"). The package also holds the message table, the note tokenizer, the table model, the feature client,
and the screen reader tests, which walk the element's own table.

## Installation and entry points

Releases are betas under the `beta` dist-tag until 1.0. `lit` and `@lit/task` arrive with it,
because they are listed under `dependencies`:

```sh
npm install @schalkneethling/bcd-embed@beta
```

The package has two entry points, and `exports` in `package.json` lists no others.

| Import                                | What it gives you                                                                                                                                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@schalkneethling/bcd-embed`          | Defines `<bcd-compat-table>`. The import itself is the effect, so write `import "@schalkneethling/bcd-embed";`. It also exports the message table and the types, such as `BcdCompatTableElement`. It exports no class and no type from Lit. |
| `@schalkneethling/bcd-embed/base.css` | The opt-in base stylesheet, one file in the layer `bcd-embed.base` (see "Styling"). Link it, or import it through a bundler that does not minify CSS (see "If your bundler minifies the stylesheet").                                       |

`package.json` lists `./dist/index.js` and `./dist/*.css` under `sideEffects`, never a bare `false`.
A bundler that reads `false` drops `import "@schalkneethling/bcd-embed";`, because the page uses nothing
from the import, and the element is never defined. `tests/consumer-build.test.ts` builds a
throwaway consumer with Vite in production mode to check this: the built page defines
`bcd-compat-table`, a consumer that imports only a type ships no Lit code, and with `sideEffects`
set to `false` the element stays undefined.

The package also ships `custom-elements.json`, the Custom Elements Manifest, and names it in the
`customElements` field of `package.json`, so editors and documentation tools find the element's
attributes, properties, and events.

### Size

The initial import, which is `dist/index.js` with Lit and `@lit/task`, measures 16.68 kB with gzip
on 21 November 2026, against the budget of 25 kB (Document 3 section 6). The renderer alone,
without Lit, measures 1.74 kB with gzip, so it stays a static import in the same file. `pnpm build`
checks both with `size-limit` and fails when either goes over its limit. "Build and tests" lists the
measurements that `.size-limit.json` holds.

## Usage

Importing the package defines the element. The documentation site has the reader-facing guide, starting at
`apps/website/src/content/docs/component/getting-started.mdx`; its code samples come from
`examples/` (see "Layout").

In fetch mode, the only required input is `query`. The element asks the hosted API,
`https://api.browser-compat.dev`, once it comes near the viewport:

```html
<bcd-compat-table query="css.properties.display">
  <p>
    <a href="https://developer.mozilla.org/en-US/docs/Web/CSS/display#browser_compatibility"
      >Browser compatibility for <code>display</code> on MDN Web Docs</a
    >
  </p>
</bcd-compat-table>

<script type="module">
  import "@schalkneethling/bcd-embed";

  document.addEventListener("bcd-load", (event) => {
    console.log(event.detail); // { mode: "fetch", snapshot: "bcd-8.1.9-gen-…" }
  });
  document.addEventListener("bcd-error", (event) => {
    console.warn(event.detail); // { mode: "fetch", reason: "network", status: null, code: null }
  });
</script>
```

In data mode, a script assigns a payload obtained at build time:

```html
<bcd-compat-table id="display" browsers="chrome firefox safari">
  <p>
    <a href="https://developer.mozilla.org/en-US/docs/Web/CSS/display#browser_compatibility"
      >Browser compatibility for <code>display</code> on MDN Web Docs</a
    >
  </p>
</bcd-compat-table>

<script type="module">
  import "@schalkneethling/bcd-embed";

  const table = document.querySelector("#display");
  table.addEventListener("bcd-load", (event) => {
    console.log(event.detail); // { mode: "data", snapshot: null }
  });
  table.addEventListener("bcd-error", (event) => {
    console.warn(event.detail.reason); // "invalid-payload"
  });
  // `payload` is a feature response from the API contract, obtained at build time.
  table.data = payload;
</script>
```

| Input                  | Kind                   | What it does                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data`                 | Property only          | A contract 1.x feature response. Assigning one renders the table. `null` removes the table. The element reads the payload when it is assigned, so assign a new object to show new data. While `data` is set, `query` sends no request.                                                                                                                                      |
| `source`               | Attribute and property | The `id` of a `<script type="application/json">` that holds a payload, while `data` is `null`. The element reads it once and sends no request, and a `source` that fails never falls through to `query`. See "Source mode".                                                                                                                                                 |
| `query`                | Attribute and property | The BCD dotted key to request, such as `css.properties.display`, while `data` is `null`. Changing it requests the new key; removing it removes the table.                                                                                                                                                                                                                   |
| `endpoint`             | Attribute and property | The API's base URL, for a self-hosted API. The default is `https://api.browser-compat.dev`. It must be an absolute `https:` or `http:` URL, on any host, with no query string, fragment, or credentials; anything else is the error `invalid-endpoint`. A browser blocks an `http:` request from an `https:` page as mixed content, which the element reports as `network`. |
| `loading`              | Attribute and property | `lazy`, the default, holds the first request back until the element is within 400 pixels of the viewport. `eager` requests as soon as the element is in the document. Any other value, set on the attribute or the property, means `lazy`, as for `<img loading>`.                                                                                                          |
| `browsers`             | Attribute and property | Space-separated support target ids, such as `chrome firefox`. Without it, the table shows `chrome firefox safari nodejs`, less any target the payload does not describe, or every target in the payload when it describes none of those four.                                                                                                                               |
| `locale`               | Attribute and property | Selects the string table. Only English ships, and an unknown locale selects English.                                                                                                                                                                                                                                                                                        |
| The element's children | Fallback content       | Shown until a table renders, and again after an error or `data = null`. The element never moves or removes them.                                                                                                                                                                                                                                                            |

The element fires two events. Both are `CustomEvent`s that bubble, so a listener on the element,
an ancestor, or the document receives them, and neither can be cancelled.

| Event       | When                                                                                                                           | `detail` in data mode                                                   | `detail` in fetch mode                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `bcd-load`  | Once for each update that renders a newly assigned payload, or the answer to a new request, after the table is in the document | `{ mode: "data", snapshot: null }`                                      | `{ mode: "fetch", snapshot }`, where `snapshot` is the response's `bcd-embed-snapshot` header |
| `bcd-error` | Once for each update that rejects a newly assigned value, or for each new request that fails                                   | `{ mode: "data", reason: "invalid-payload", status: null, code: null }` | `{ mode: "fetch", reason, status, code }`, with a `reason` from the next table                |

| Fetch-mode `reason` | When                                                                                                     | `status` and `code`                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `invalid-query`     | `query` fails the key pattern. No request is sent, and the error fires at once, even for a lazy element. | Both `null`                                                                                        |
| `invalid-endpoint`  | `endpoint` is not an `https:` or `http:` base URL. No request is sent.                                   | Both `null`                                                                                        |
| `network`           | The request failed with no readable response, or took longer than 20 seconds.                            | Both `null`                                                                                        |
| `http`              | The API answered with an error status.                                                                   | The status, and the contract's code, such as `feature_not_found`, or `null` when the body has none |
| `invalid-payload`   | The answer is not a contract 1.x feature response that the table model can read.                         | Both `null`                                                                                        |

**A failed request means "temporarily unavailable".** The API contract says so
(`docs/planning/01-api-contract.md`, section 8). The hosted API's edge rate limit answers with a
Cloudflare 429 that has no CORS header, so the browser hides it and the element reports
`network`. The element shows its fallback, fires one `bcd-error`, and never retries by itself, so
fifty tables cannot turn a refusal into a request loop. The page's feature client holds the
failure for 10 seconds.

**What retries.** Assigning the value `query` already has is no change, so it does nothing. A
page that offers a retry button must change the input: remove `query` (or set it to `null`), let
the element update, then set it back, or add a new element with the same `query`. Either asks the
feature client again. Inside the 10-second window the client answers with the held failure and
sends nothing, so the element fires `bcd-error` again with no request. After the window it sends
one new request. Nothing retries on a timer.

**Requests.** All elements on a page share one feature client, so fifty elements with the same
`query` send one request. A new `query` or `endpoint` while a request is pending starts the new
request, and the old answer neither renders nor fires an event. Removing the element while a
request is pending stops its wait: no event fires when the answer arrives, and the viewport
observer is disconnected. Adding the element back asks again, and the shared request answers it
without a second request when it is still in flight or succeeded. `data` wins over `query`:
setting `data` drops a pending request, and setting it back to `null` shows the fetched table
again.

**Restoring an input.** The element remembers its latest successful answer. Restoring the `query`
and `endpoint` it answered, after `query` was removed or after `data` was set and cleared, shows
that table again in the same update, with no pending state, no `aria-busy`, and no request. That
update changed the input, so it fires one `bcd-load`, as any update that renders a newly assigned
input does. A failure is not remembered, so restoring after a failure asks the feature client
again, as described under "What retries".

A change to `browsers` or `locale` renders the table again without a second `bcd-load`. The one
exception is a change that turns a rendered payload into a rejected one, or back: the model checks
only the support targets it shows, so asking for a target whose `browsers` entry is malformed fires
`bcd-error`, and removing it again fires `bcd-load`. **What "once" means.** The element updates in a batch. Two payloads assigned one after the other
in the same task render the second and fire one event. Assigning the object that is already
assigned is no change, so nothing renders and nothing fires. An event never fires while the
element is out of the document: the element holds it back and dispatches one event, for the state
it is in, when it is connected again, so a listener on the document misses nothing.

**While loading, and after an error.** When the element has fallback content, it renders nothing
of its own and the fallback is the message. When it has none, it renders one sentence in its
container, so it is never empty:

| State                                                          | Markup (message id)                                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Fetch mode, lazy and waiting for the viewport (no request yet) | `<p class="bcd-loading">Browser compatibility data for {query} has not loaded yet.</p>` (`not-loaded`) |
| Fetch mode, request in flight                                  | `<p class="bcd-loading">Loading browser compatibility data for {query}.</p>` (`loading`)               |
| Fetch mode, error                                              | `<p class="bcd-error">Browser compatibility data for {query} could not be loaded.</p>` (`error`)       |
| Data mode, error, or a fetch error for an empty `query`        | `<p class="bcd-error">Browser compatibility data could not be shown.</p>` (`error-no-query`)           |

The owner decided the data-mode sentence on 20 November 2026. #203 chose the three fetch-mode
sentences, because in fetch mode the query is always known. The waiting sentence does not say
that anything is loading, because nothing has been requested and the wait may never end (see
"Limits of lazy loading"). Fallback content is an element child,
or text that is not only white space, and the element checks again whenever its children change.

While a request is in flight the element carries `aria-busy="true"`, and it removes the attribute
when the answer arrives. A lazy element that is still waiting for the viewport has no `aria-busy`,
because that wait may never end. The element removes only the attribute it set: an author's own
`aria-busy`, set before the request, is neither overwritten nor removed. No state uses a live region and the element never moves focus,
so a page with ten tables produces no announcement while they load; a page reacts through the
events instead.

**Limits of lazy loading.** The element waits for an `IntersectionObserver`, which reports only
on an element that has a box. A host styled `display: none` or `display: contents` never meets
the viewport, so a lazy element there sends no request, fires no event, and keeps the waiting
sentence or its fallback. Use `loading="eager"` for such a host. The 400-pixel margin applies to
the viewport, not to a scrolling ancestor: inside an `overflow: auto` or `overflow: scroll` box
the element is clipped by that box, so the request starts only when the element scrolls into
view within it. In a cross-origin iframe the browser ignores the margin altogether.

The table below gives what each screen reader is expected to say when a reader moves onto a
loading element that has no fallback content. **None of it is verified yet**: the CI walks in
`screen-reader/` cover the loaded table only, and the owner's manual pass comes at the end.

| Screen reader and browser | Expected on reaching a loading element                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| NVDA with Firefox         | The loading sentence, read as text. NVDA is not expected to announce `aria-busy` on an element with no role. |
| VoiceOver with Safari     | The loading sentence. VoiceOver may add "busy", or skip the content of a busy element until it is ready.     |
| Orca with Firefox         | The loading sentence, read as text.                                                                          |

Nothing is announced when the table replaces the sentence, because there is no live region; a
reader who stays on the element finds the table on the next move. After an error, each screen
reader is expected to read the error sentence, or the author's fallback, as plain text.

**What counts as invalid.** Anything the table model rejects with a `TablePayloadError`: a value
that is not a contract 1.x feature response, and a payload in which two features share a key.

**How the fallback is hidden.** While a table is rendered, the element carries the boolean
attribute `loaded`, and the table sits in a child `<div class="bcd-render-container">`. The base
stylesheet (below, "Styling") hides every other child while `loaded` is present, bare text
included, and leaves no space for it: the element becomes a one-column grid with the container in
the first row and any text in a row of zero height. A page that loads
no stylesheet shows the fallback next to the table, which the owner accepted on 20 November 2026. If a script removes the container, which React does when it changes a single string
child, the element puts the same container back. The class `bcd-render-container` belongs to the
element: it removes any other child that carries it, because such a child is a copy of an earlier
table, from `cloneNode(true)` or from saved HTML. That is the one case where it removes a child.

**Re-rendering.** Rows are keyed by feature and cells by target, so a disclosure a reader opened
stays open on its own cell when `browsers` changes or a new payload has the same feature.

**What the markup is.** The table matches `docs/planning/phase1-markup/index.html` (variant A,
headers associated by `scope`), element for element and attribute for attribute, with one
addition: each note sits in a `<bdi>` element, so a note that contains bidirectional control
characters cannot reorder the words around it. A browser test compares the two. Each cell holds a
compact span with `aria-hidden="true"` and `hidden`, which holds the state's icon and the version,
then a span with the full sentence, so a page with no stylesheet reads every cell as its sentence.

**TypeScript.** `document.querySelector("bcd-compat-table")` returns `BcdCompatTableElement`, a
hand-written interface, and `addEventListener("bcd-load", …)` types `event.detail`. No type from
Lit is public: the entry does not export the element's class, and a test fails when any
declaration file the entry reaches imports from `lit`.

### Source mode

Source mode needs no script of the page's own. A build step writes two plain HTML fragments, the
JSON script and the element that names it:

```html
<script type="application/json" id="bcd-data-css-properties-display">
  { "contract": "1.1.0", "query": "css.properties.display", … }
</script>
<bcd-compat-table source="bcd-data-css-properties-display">
  <p>Browser compatibility for <code>display</code> on MDN Web Docs</p>
</bcd-compat-table>
```

**Naming the script.** The `id` is the page author's to choose, and the element enforces nothing.
Use `bcd-data-` followed by the query with each dot written as a dash, as in
`bcd-data-css-properties-display`, so that several tables on one page cannot share an `id`.

**Escaping the JSON.** The page's generator must replace every `<` in the JSON with the six
characters `\u003c` (a backslash, `u`, `0`, `0`, `3`, `c`). `JSON.parse` turns `\u003c` back
into `<`, so every note arrives unchanged. One line does it:

```js
const scriptJson = JSON.stringify(payload).replaceAll("<", "\\u003c");
```

Escaping only a closing script tag is not enough. The HTML parser decides where a script ends,
before the element sees any text, and two sequences in a note can cut or swallow it:

- A closing script tag, `</script>`, ends the script at the note. The rest of the JSON becomes
  text in the page, and the element reports `source-invalid-json`.
- The sequence `<!--<script>` is worse. It moves the tokenizer into its "script data double
  escaped" state (HTML Standard, section 13.2.5, "Script data double escaped state"), where the
  next `</script>` no longer ends the script. The real end tag is read as script text, and the
  rest of the page, the element included, disappears into the script. The Standard's section
  4.12.1.3, "Restrictions for contents of `script` elements", describes the same pairing rule.

Escaping every `<` removes both cases, and any other that starts with `<`. The element cannot
repair JSON that the parser has already cut.

**What the element reads.** It looks the `id` up in its own tree, which is the shadow root that
holds it or else the document, and accepts one kind of target: an HTML `<script>` whose `type` is
`application/json`, in any letter case, with no parameters. An `id` that matches no element, or
whose first match in the tree is anything else, such as a `<div>` or a `<script>` of another type,
gives `source-missing`, at once, even while the page is still being parsed, because a script with
the same `id` further down can never be the first match. The element never reads the text of
another kind of element. It passes the script's `textContent` to `JSON.parse`, so nothing in it
is evaluated. Any failure of `JSON.parse`, including a `RangeError` for extreme nesting, gives
`source-invalid-json`.

**Where the script goes.** A script before the element, in the same tree, with no earlier
element that has the same `id`, always works. A script after it works too
while the page is still being parsed: when the `id` is not in the page yet, the element waits for
the end of parsing and reads then, and during the wait it shows nothing and fires no event. This
covers the case where the element is defined before the parser reaches it, because then its
`connectedCallback` runs before the parser has read anything after the element's start tag. A
script that inserts both fragments into a page that has finished loading must insert the JSON
script first, because nothing is left to wait for, and the element reports `source-missing`.

**Read once.** The first read happens when the element connects. The element keeps what it read
until `source` changes, so editing or removing the script afterwards changes nothing, and moving
the element does not read again. Setting `source` to another `id` reads that script and fires one
event. While `data` is set, the element does not read `source` at all, so a broken reference
reports nothing, and setting `data` while the element waits for the parser cancels the wait;
clearing `data` reads it then.

**Refreshing a payload.** The element never watches the script, so a page that changes the JSON
must say so. Two ways work. Give each payload a new script with a new `id`, and set `source` to
it. Or remove the `source` attribute, let the element update, then set it again: the removal
makes the element forget its read, and the new value reads the script again and fires one
event. Removing and setting the attribute in the same task does nothing, because the element
updates once and sees the same `id`.

**Order of inputs.** `data` wins over `source`, and `source` wins over `query`. When `source` is
present the element never sends a request, even when the read fails: it reports the error and
shows the fallback, so a wrong `id` cannot hide behind a working `query`. Remove the `source`
attribute to fall back to `query`.

| Event       | `detail`                                                                |
| ----------- | ----------------------------------------------------------------------- |
| `bcd-load`  | `{ mode: "source", snapshot: null }`                                    |
| `bcd-error` | `{ mode: "source", reason, status: null, code: null }`, with a `reason` |

| Source-mode `reason`  | When                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------- |
| `source-missing`      | No element has the `id`, or the first one is not a `<script type="application/json">` |
| `source-invalid-json` | The script's text is empty or is not JSON                                             |
| `invalid-payload`     | The JSON is not a contract 1.x feature response that the table model can read         |

Everything else works as in data mode: one event for each update in which the input changed, the
event held while the element is out of the document, the `loaded` attribute, the render
container's guard, the error sentence when the page gave no fallback content, and an author's own
`aria-busy` left alone. The element never sets `aria-busy` in source mode, because nothing is in
flight.

**Cost.** Parsing is O(n) time and space for n characters of script text, and the lookup is
expected O(1). It happens once for each `id`, so later updates do not parse again. The table
model then costs what it costs in data mode (see "Size of the rendered table").

### Size of the rendered table

The element builds the model and the markup in one pass each, so one update costs
O(F × T + S + C) time and space for F features, T shown targets, S statements with their flags and
notes, and C characters of text. The number of elements is bounded too. `src/render/table.ts`
derives the exact bound, and a browser test checks it on 2,000 features by four targets:

```text
elements ≤ 16 × F × T + 9 × S + E + 10
```

Here S counts each statement, flag, and note, and E counts the code, emphasis, and link elements
inside notes. The short form holds for at least one feature and one target; the exact bound in
`src/render/table.ts` holds always. The 2,000-feature test payload renders 77,618 elements, including the render
container. Each cell's icon is an `<svg>` with one `<path>`, so it adds two elements to every cell;
that is 16,000 of those elements.

Render time for that payload, measured on 20 November 2026 on an Apple silicon Mac (Darwin 27.2.0,
load average between 18 and 30, because other work ran beside it) with Playwright 1.65.1, one test
at a time, three runs each, after fetch mode (#203) and the base stylesheet (#200) were both in. The page ran Lit's development build from the Vite dev server, which is
slower than the production build, and linked the base stylesheet. The times are recorded by
`e2e/data-mode.e2e.ts`, which prints them and never asserts them.

| Engine (Playwright build) | Until `bcd-load` (model and markup) | Until two animation frames later (layout and paint) |
| ------------------------- | ----------------------------------- | --------------------------------------------------- |
| Chromium                  | 207 to 214 ms                       | 507 to 519 ms                                       |
| Firefox                   | 600 to 633 ms                       | 1,125 to 1,323 ms                                   |
| WebKit                    | 379 to 385 ms                       | 2,313 to 2,324 ms                                   |

The base stylesheet, not the icons, costs the extra layout time. #198 measured 394 to 939 ms until
two frames later on a page with no stylesheet. In a separate run of issue #200, hiding every icon
with `display: none` on the styled page saved 23 to 93 ms in each engine, while the same table on
the page with no stylesheet painted in 390 to 397 ms in Chromium and 821 to 865 ms in WebKit.
WebKit's layout grows most, to about 2.2 s. No single rule caused it when each was switched off in
turn, and that run was too noisy to say more. The payload is more than six times the largest real
table, but the owner has not yet accepted this cost, and nothing guards against it growing.

A row cap does not need to become a follow-up now. A feature's table holds the feature and
everything nested under it, and the largest such subtree in BCD 8.1.9 is `api.Element` with 314
features; five subtrees have more than 200 and none has more than 500. So 2,000 rows is more than
six times the largest real table, and it rendered in under a second here. These numbers come from
one fast machine, so measure again on a slow phone before relying on them for very large tables.

## Frameworks

The element works inside React 19.3.1, Vue 3.5.45, and Svelte 5.57.3. The package ships no wrapper
and no framework typings. Each framework has a fixture page in `e2e/frameworks/`, built with Vite
and run in Chromium, Firefox, and WebKit against Vite's dev server and a production build. The
pages use the syntax below, and the tests show that `element.data` is the object the page passed,
that the framework's own listener received `bcd-load` and `bcd-error`, and that a re-render with
changed props leaves the table and the author's fallback in place with no console error.

In every framework, import `@schalkneethling/bcd-embed` before the framework renders the element, as the
first import of the module that mounts the app. Put the fallback in an element such as `<p>`, not
in a bare string: a framework that changes a single string child assigns `textContent`, which
removes the element's render container. The element puts the container back, and the tests show it
for React and Vue, but the form with an element child never relies on that. The events bubble and
are not composed, so a listener on the element or on an ancestor in the same tree receives them.

| Framework | Sets `data` as a property                                                                            | Listens for `bcd-load`   | Element defined after the first render                                                          |
| --------- | ---------------------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------- |
| React 19  | `ref` callback (any order); `<el data={x} />` only if the element is defined before the first render | `<el onbcd-load={fn} />` | `data={x}` loses the payload; a `ref` callback keeps it                                         |
| Vue 3     | `:data.prop="x"` (any order); `:data="x"` only if the element is defined before the first render     | `@bcd-load="fn"`         | `:data="x"` loses the payload; `:data.prop="x"` keeps it                                        |
| Svelte 5  | `data={x}` (any order, with the WebKit exception below)                                              | `onbcd-load={fn}`        | `data={x}` keeps the payload, except in WebKit when nothing read `customElements` first (below) |

"Loses the payload" means the framework wrote the attribute `data="[object Object]"`, which the
element never reads, so the table does not render. The framework then sets the property from its
next `data` value, because the property exists by then.

**React.** React 19 sets a prop as a property when `prop in element` is true, so `data` works when
the element is defined first. A `ref` callback assigns the property in every load order. The
callback must read the current value, so declare it inline or depend on the value:

```tsx
import "@schalkneethling/bcd-embed";
import type {
  BcdCompatTableElement,
  BcdLoadDetail,
  CompatTableData,
} from "@schalkneethling/bcd-embed";

export const Table = ({ data }: { data: CompatTableData }) => (
  <bcd-compat-table
    browsers="chrome firefox safari"
    ref={(element: BcdCompatTableElement | null) => {
      if (element !== null) element.data = data;
    }}
    onbcd-load={(event: CustomEvent<BcdLoadDetail>) => console.log(event.detail)}
  >
    <p>Browser compatibility for this feature is on MDN Web Docs.</p>
  </bcd-compat-table>
);
```

React reads a prop that begins with `on` as a listener for the event named by the rest of the
prop, so `onbcd-load` listens for `bcd-load`. TypeScript needs the tag declared;
`e2e/frameworks/react/custom-element.d.ts` is a working declaration.

**Vue.** Tell the template compiler that the tag is a custom element, or Vue warns that it cannot
resolve a component. With `@vitejs/plugin-vue`:

```ts
vue({ template: { compilerOptions: { isCustomElement: (tag) => tag === "bcd-compat-table" } } });
```

```vue
<script setup lang="ts">
import "@schalkneethling/bcd-embed";
import { shallowRef } from "vue";

const data = shallowRef(payload);
</script>

<template>
  <bcd-compat-table
    browsers="chrome firefox safari"
    :data.prop="data"
    @bcd-load="(event) => console.log(event.detail)"
  >
    <p>Browser compatibility for this feature is on MDN Web Docs.</p>
  </bcd-compat-table>
</template>
```

The `.prop` modifier always sets the property. Without it, Vue sets a property only when
`key in el` is true, which has the same load-order limit as React. Keep the payload in
`shallowRef` or `markRaw`: a `ref` makes the object deeply reactive, so the element receives a
`Proxy` of the payload. The table still renders from the proxy, but `element.data` is then not the
object you passed.

**Svelte.** The ordinary binding works. While the element is not defined, Svelte sets an object as
a property, and Lit keeps a property that was set before the upgrade. Use `$state.raw` for the
payload, because `$state` makes an object deeply reactive and the element receives a proxy:

```svelte
<script lang="ts">
  import "@schalkneethling/bcd-embed";

  let data = $state.raw(payload);
</script>

<bcd-compat-table
  browsers="chrome firefox safari"
  {data}
  onbcd-load={(event) => console.log(event.detail)}
>
  <p>Browser compatibility for this feature is on MDN Web Docs.</p>
</bcd-compat-table>
```

WebKit 27.2 has a bug that affects an element defined after a Svelte page rendered it. Svelte
builds its markup with `document.importNode`, and WebKit never upgrades an element that
`importNode` made before anything read `window.customElements`, not even through
`customElements.upgrade`. The page then shows the fallback forever. Importing the element first, as
above, avoids it, because the definition reads `customElements` before the markup exists.
`e2e/frameworks.e2e.ts` reproduces the bug without a framework and marks the affected tests with
an assertion of the symptom (the element is not `:defined` and the fallback is still showing), so the tests turn red when a WebKit release fixes it, and also when something else breaks in the same page. It was observed on macOS WebKit 27.2 only; the CI runs Linux WebKit.

## Styling

The package ships an opt-in base stylesheet, `@schalkneethling/bcd-embed/base.css`. It makes the table
usable with no other CSS: borders, padding, a visible focus ring, the icons and their colours, the
hidden sentences, the rule that hides the fallback, and the layout in a narrow container and in
print. It decides no fonts, sizes, or background, so the table takes those from the page. Load it
from the document:

```html
<link rel="stylesheet" href="/node_modules/@schalkneethling/bcd-embed/dist/base.css" />
```

A bundler that resolves package exports can import `@schalkneethling/bcd-embed/base.css` instead. Load it
from the document, not from a shadow root, because Chromium 159, Firefox 159, and WebKit 27.2 ignore
an `@property` rule inside a shadow root, and the tokens below would then stay unregistered.

**Overriding it.** Every rule sits in the cascade layer `bcd-embed.base`, which the file declares
first. Any rule of yours that is not in a layer beats every rule in it, whatever the specificity, so
`.bcd-table td { padding: 0 }` is enough and `!important` is never needed. A page that uses layers
itself can name `bcd-embed.base` in its own `@layer` order statement. A test reads the stylesheet
and checks, for every selector and every property it sets, that a rule with one class selector
wins in Chromium, Firefox, and WebKit.

### Tokens

The tokens are custom properties registered with `@property`. Each one inherits, so set it on the
element, on any ancestor, or on `:root`. Each colour has a light and a dark token, and the
stylesheet picks one with `light-dark()` where the colour is used.

| Token                                                           | Type       | Default (light) | Default (dark) |
| --------------------------------------------------------------- | ---------- | --------------- | -------------- |
| `--bcd-color-supported-light`, `--bcd-color-supported-dark`     | `<color>`  | `#1a7f37`       | `#4ac26b`      |
| `--bcd-color-partial-light`, `--bcd-color-partial-dark`         | `<color>`  | `#9a6700`       | `#d29922`      |
| `--bcd-color-preview-light`, `--bcd-color-preview-dark`         | `<color>`  | `#0969da`       | `#4493f8`      |
| `--bcd-color-flagged-light`, `--bcd-color-flagged-dark`         | `<color>`  | `#6639ba`       | `#ab7df8`      |
| `--bcd-color-unsupported-light`, `--bcd-color-unsupported-dark` | `<color>`  | `#cf222e`       | `#ff7b72`      |
| `--bcd-color-unknown-light`, `--bcd-color-unknown-dark`         | `<color>`  | `#59636e`       | `#9198a1`      |
| `--bcd-color-no-data-light`, `--bcd-color-no-data-dark`         | `<color>`  | `#59636e`       | `#9198a1`      |
| `--bcd-color-border-light`, `--bcd-color-border-dark`           | `<color>`  | `#818b98`       | `#656c76`      |
| `--bcd-border-width`                                            | `<length>` | `1px`           | `1px`          |

Four tokens are not registered. Three have defaults in `rem` or `em`, and an `@property` initial
value cannot be: such a length is not computationally independent, and all three engines rejected
one. The fourth defaults to `Canvas`, the browser's page colour for the current `color-scheme`, and
all three engines resolved a registered `Canvas` initial value to white, even under
`color-scheme: dark`. The stylesheet reads each with a fallback, such as
`var(--bcd-cell-padding, 0.5rem)`, so they behave like the others, except that a value of the wrong
type is not rejected.

| Token                           | Type, unregistered | Default  | What it sets                                                             |
| ------------------------------- | ------------------ | -------- | ------------------------------------------------------------------------ |
| `--bcd-cell-padding`            | `<length>`         | `0.5rem` | The padding of every cell, and below the caption                         |
| `--bcd-indent`                  | `<length>`         | `1rem`   | One step of a nested row's indent                                        |
| `--bcd-icon-size`               | `<length>`         | `1em`    | The width and height of an icon                                          |
| `--bcd-color-sticky-background` | `<color>`          | `Canvas` | The background of the sticky feature column (below, "Narrow containers") |

Layout and typography are not tokens. The table is light DOM, so ordinary CSS reaches every part of
it, and the rendered class names (Document 3, "Styling surface") are the hooks.

### Icons and colours

Each support state has its own icon, so colour never carries the state alone. The icons are inline
SVG drawn for this project as strokes in `currentColor`, one `<path>` each, inside the cell's
`aria-hidden` span, with no `<title>`. They carry the classes `bcd-icon` and `bcd-icon-{state}`.

The stroke comes from SVG presentation attributes on each `<svg>`: `fill="none"`,
`stroke="currentColor"`, `stroke-width="2"`, and round caps and joins. Any CSS rule beats a
presentation attribute, so a common reset such as `svg { fill: currentColor }` fills the icons
in, and the check, the cross, and the dash turn into blobs. The base stylesheet cannot prevent
this, because an unlayered reset beats its layer too. A page with such a reset should exempt the
icons, for example with `svg:not(.bcd-icon)` in the reset's selector, or restore them with
`.bcd-icon { fill: none; stroke: currentColor; }`.

| `bcd-icon-…`  | Shape                  | Shown for                                                                       |
| ------------- | ---------------------- | ------------------------------------------------------------------------------- |
| `supported`   | A check mark           | `supported`                                                                     |
| `partial`     | A circle split in half | `partial`, any partial implementation, and a partial preview even behind a flag |
| `preview`     | A laboratory flask     | A full `preview`                                                                |
| `flagged`     | A flag on a pole       | Support behind a flag, unless it is a partial preview                           |
| `unsupported` | A cross                | `unsupported`                                                                   |
| `unknown`     | A question mark        | `unknown`                                                                       |
| `no-data`     | A dash                 | A target the payload has no data for                                            |

The default state colours reach at least 4.87:1, and the border colours at least 3.14:1, against
the default page background of each engine: white in light, and `#121212` (Chromium 159),
`#1c1b22` (Firefox 159), or `#1e1e1e` (WebKit 27.2) in dark. WCAG asks 3:1 of an icon, and
`tests/styles/contrast.test.ts` asserts that for each icon and for the border, in both schemes,
from the token values. `e2e/base-stylesheet.e2e.ts` checks that each engine's Canvas colour is still
the one the test assumes. The stylesheet colours no text, so text keeps the page's own
colour and contrast. A page with its own background should check the tokens against it.

**Dark mode.** The stylesheet never sets `color-scheme`, because the background behind the table is
the page's. The dark colours apply when the table inherits a dark scheme: `color-scheme: dark` on
any ancestor, or `color-scheme: light dark` on the page while the reader prefers dark. A page that
declares no scheme gets the light colours. **The element that sets a dark scheme must also paint a
dark background**, such as `background-color: Canvas`. `light-dark()` follows the inherited scheme
whether or not anything dark is painted, and the dark colours on white reach only 2.28:1 to 3.10:1,
so every state colour except preview's fails 3:1 there.

**Forced colours.** The browser replaces the icon's colour with a system colour and the stroke
follows it, so the shapes stay. Focus on the region and on each disclosure keeps a 2 px outline.
Playwright's forced-colours emulation forced the colours in Firefox. In Chromium and WebKit it
switched the `forced-colors` media query on but left the computed colours alone, so a real Windows
High Contrast check is still a manual one.

### The hidden sentences

Each cell's sentence, and each row header's "(part of …)", sits in a `visually-hidden` span. The
base stylesheet hides it from sight with `font-size: 0`, `clip-path: inset(50%)`, and
`white-space: nowrap`, and leaves it an inline, unpositioned box, so it has no size and scrolls
with its cell. It does not use the common technique of a positioned one-pixel box, for two
reasons found in the screen reader CI walks of #200:

- Positioned absolutely, the span left the line, so the space before a row header's
  "(part of …)" became trailing white space and collapsed, and NVDA in Firefox read
  "from(part of Array)".
- Made an inline-block, the span became an accessible object of its own: Chromium's
  accessibility tree shows a `generic` node for an inline-block span and none for an inline one.
  NVDA then read an empty item in row headers. Firefox, which NVDA and Orca use, likely does the
  same for an absolutely positioned span, because its frame becomes a block. With both variants,
  Orca's Return stopped opening a disclosure it had reached by table navigation. The separate
  object is the likely cause, which only the CI walk can confirm.

An inline span adds no object, which matches the tree with no stylesheet. A page that has its own
unlayered `.visually-hidden` rule replaces this one, and should keep the same two properties.

### Narrow containers

The table never changes shape: at every width the `<table>`, its rows, and its cells keep their
table display values, so a screen reader reads the same table. What changes is how it scrolls.

| Where                | What the stylesheet does                                                                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| On screen, any width | The region (`.bcd-scroller`) scrolls sideways when the table is wider than it. The page does not.                                                                                                                     |
| On screen, any width | The feature column, its header included, is sticky: while the region scrolls, it stays at the inline start and the other columns pass beneath it. While the table fits, nothing scrolls and the column does not move. |
| In print             | Nothing is sticky and the region does not clip the table. The header rows are in a `<thead>`.                                                                                                                         |

In a 320 CSS pixel viewport the page scrolls only down and the region only sideways, so nothing needs
scrolling in two directions. The keyboard reaches the region with Tab, and the arrow keys scroll it.
In right-to-left text the column sticks to the right, and the borders mirror.

**Long feature names.** A feature name may break anywhere (`overflow-wrap: anywhere` on its
`<code>`), and a row header is at least 10em wide, indent included (`min-inline-size: 10em` with
`box-sizing: border-box`). So in a region too narrow for the table, the sticky column shrinks to
10em and a long name wraps inside it, which leaves room for the other columns to scroll into view
beside it, even at depth 5 in a 320 CSS pixel viewport. Where the table fits, the column keeps the
name's full width.

**A floor for the support columns.** The history list takes no width of its own (#204), so nothing
in a support cell asked for width, and the table spent its spare width on the feature column. Six
targets in an 850 pixel region left each support column about 110 pixels wide, and an open cell's
notes wrapped every word or two. Each support cell is now at least `min(12em, 100vw - 12em)` wide.
Past that, the region scrolls sideways. With three targets in the same region, the columns measured
248, 198, 198, and 198 pixels instead of 301, 176, 188, and 176. The cap keeps the #201 guarantee
above: at 320 CSS pixels a 12em column does not fit beside the 10em sticky column, and the test that
scrolls each column into view fails in three engines without it. A container query would measure
the region instead of the viewport, but it costs the containment described below.

**There is no breakpoint.** Issue #201 first made the column sticky only in a container narrower
than 40em, with a container query. A query container applies style containment, and with it
Chromium 159 laid out the largest real table, 314 rows, in 249 ms instead of 51 ms: five times as
long. The cost grows with the square of the number of rows, so a synthetic 2,000-row table took
about 10 seconds instead of 0.6 (Document 3, "Responsive behavior"). Containment also made the
region 0 pixels wide when the element was a flex item that did not grow and had no width. A sticky
column at every width needs no query and costs nothing while the table fits, so the stylesheet uses
that instead. Do not apply style containment to the table or an ancestor, with `container-type`,
`contain: style`, or `content-visibility`, for the same reason; a test checks that the stylesheet
applies none.

**The sticky column's background.** The sticky cells paint over the cells that scroll beneath them,
so they need a background. It is `Canvas`, the browser's page colour for the inherited
`color-scheme`, which matches a page that paints no background of its own. On a page with its own
background, set the token to the same colour:

```css
bcd-compat-table {
  --bcd-color-sticky-background: #fdf6e3;
}
```

To keep the column in the flow instead, override both properties with an unlayered rule:

```css
.bcd-table thead tr:first-child > :first-child,
.bcd-table .bcd-feature {
  position: static;
  background-color: transparent;
}
```

**Borders.** The table uses `border-collapse: separate` with `border-spacing: 0`: each cell draws
its block-end and inline-end border, the first header row adds the block-start side, and the feature
column adds the inline-start side. With `border-collapse: collapse`, Chromium, Firefox, and WebKit
all left the side borders of a scrolled sticky cell unpainted (Document 3, "Responsive behavior").
If you restyle the borders, keep each line on one cell, or a sticky cell loses it while the table
scrolls.

### Without the stylesheet

A page that loads only the element gets a complete, accessible table: each cell reads as its full
sentence, because the compact span with the icon and version keeps its `hidden` attribute. The
fallback content stays visible next to the table. axe reports no violation on that page in the
three engines.

### Building and linting it

`vite.config.ts` builds `src/styles/base.css` as a second library entry into `dist/base.css`, with
Vite's own CSS pipeline. The `@import` rules are inlined, `@layer bcd-embed.base;` stays first, the
`@property` rules stay at the top level because `properties.css` is imported without `layer()`, and
every other rule ends up in an `@layer bcd-embed.base { }` block. `build.cssMinify` is `false`,
because the default minifier, lightningcss, drops the layer statement (Document 10, #188 section 6).

**If your bundler minifies the stylesheet.** The published file is not minified, so a page can
link it as it is. A consumer who imports it through a bundler that minifies CSS, as Vite does by
default with lightningcss, gets a changed stylesheet. Issue #200 checked this by passing
`dist/base.css` through a Vite 8.3.8 library build with `build.cssMinify` at its default:

- The `@layer bcd-embed.base;` statement is dropped. Every rule is still in the layer, and the
  layer still sits where the first rule puts it, so unlayered author rules still win. The order
  only changes if the bundler places another layer's rules before this file's first rule, in
  which case `bcd-embed.base` comes after that layer instead of where the statement put it.
- The `@property` rules move inside the layer block. Chromium, Firefox, and WebKit still register
  them there (Document 10, #188 section 6).
- **The colours are lost.** lightningcss rewrote each `light-dark()` into
  `var(--lightningcss-light, …) var(--lightningcss-dark, …)`, which depends on custom properties
  it only defines next to a `color-scheme` declaration in the same CSS. This stylesheet sets no
  `color-scheme`, so in Chromium 159, Firefox 159, and WebKit 27.2 every icon computed to the text
  colour, `rgb(0, 0, 0)`, in light and in dark. The shapes stay, so no state is lost, but the
  palette is.

Link `dist/base.css` directly, or exclude it from minification, for example with
`build.cssMinify: false` in Vite, which leaves the file as published.

The stylesheet targets the Baseline 2025 floor (Document 3 section 1). `calavera.config.json` sets
that floor for the whole repository, but the recipe has not been applied yet, so the root
`.stylelintrc.json` still checks for widely available features, which flags `@property`,
`light-dark()`, and `overflow-inline`. Until the recipe is applied, this package's
`.stylelintrc.json` extends the root configuration and sets `available: 2025`. Delete it once the
root configuration carries the floor. Stylelint reports nothing at that floor.

Four tests guard the source files in `src/styles`: `tests/styles/logical-properties.test.ts`
rejects physical properties and values, `tests/styles/properties.test.ts` checks that every custom
property is registered or listed with its reason in `properties.css`,
`tests/styles/contrast.test.ts` checks the palette, and `tests/styles/containment.test.ts` checks
that nothing makes a query container or applies style containment (above, "Narrow containers") and
that no container query length unit such as `cqi` appears, which `stylelint-plugin-use-baseline`
flags.

## Layout

| Path                                       | Holds                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                             | The package entry. It defines the element, and everything the package exports passes through it.                                                                                                                                                                                                                           |
| `src/bcd-compat-table.ts`                  | The element's class: its properties, the render container, the `loaded` attribute, the events.                                                                                                                                                                                                                             |
| `src/render/`                              | The Lit templates that map the table model to the Phase 1 markup, the state icons (`status.ts`), and the loading and error sentences (`error.ts`).                                                                                                                                                                         |
| `src/styles/`                              | The opt-in base stylesheet: `base.css` imports `properties.css`, `tokens.css`, and `table.css` (below, "Styling").                                                                                                                                                                                                         |
| `src/model/table-model.ts`                 | `buildTableModel`, which turns a payload into columns, rows, cells, and sentences, with no DOM.                                                                                                                                                                                                                            |
| `src/strings/en.ts`                        | The English message table, keyed by message id, with `{placeholders}`.                                                                                                                                                                                                                                                     |
| `src/strings/format.ts`                    | `formatMessage`, `formatMessageToParts`, `MissingPlaceholderError`, and `selectStrings`, which falls back to English.                                                                                                                                                                                                      |
| `src/data/request-cache.ts`                | The request cache: one entry per URL, shared in-flight requests, and per-result retention.                                                                                                                                                                                                                                 |
| `src/data/feature-client.ts`               | The feature client: builds the URL, calls `fetch`, and classifies the answer.                                                                                                                                                                                                                                              |
| `src/public-types.ts`                      | The public types, including the hand-written `BcdCompatTableElement`.                                                                                                                                                                                                                                                      |
| `src/contract.ts`                          | Plain copies of the contract's feature response types, which the published declarations use instead of the private `@bcd-embed/schema` (below the table).                                                                                                                                                                  |
| `src/model/note.ts`                        | `parseNote`, which turns a BCD note string into text, code, emphasis, and link segments.                                                                                                                                                                                                                                   |
| `tests/`                                   | Vitest tests, `tests/fixtures/message-cases.ts`, the fixtures the schema package lacks, and `tests/fixtures/large-payload.ts`, which builds a payload of any size.                                                                                                                                                         |
| `examples/`                                | The samples the documentation site shows (`apps/website/src/content/docs/component/`). `browser/docs-examples.browser.test.ts` runs the HTML, JavaScript, and CSS ones, `e2e/frameworks.e2e.ts` renders the React, Vue, and Svelte ones, and `tests/examples.test.ts` fails when an example is added that no test imports. |
| `browser/`                                 | Browser tests for the Chromium Vitest project, named `*.browser.test.ts`.                                                                                                                                                                                                                                                  |
| `e2e/`, `playwright.e2e.config.ts`         | Playwright Test files named `*.e2e.ts`, run in three engines with axe, and their fixtures.                                                                                                                                                                                                                                 |
| `playwright.visual.config.ts`              | The visual snapshots of the layout (`e2e/layout.visual.ts`), with one set of images per platform in `e2e/__snapshots__/` (below, "Browser tests").                                                                                                                                                                         |
| `screen-reader/`, `playwright.*.config.ts` | The screen reader tests and the fixture page they load (below).                                                                                                                                                                                                                                                            |
| `vite.config.ts`, `tsconfig.build.json`    | The library build and its type declarations.                                                                                                                                                                                                                                                                               |
| `vite.screen-reader.config.ts`             | The build of the screen reader fixture page into `dist-screen-reader/`, which is not committed.                                                                                                                                                                                                                            |
| `.size-limit.json`                         | The size budgets: 25 kB with gzip for `dist/index.js` with Lit, 8 kB with gzip for the renderer alone, and, with Brotli, 9.5 kB for `dist/index.js` without `lit` and `@lit/task` and 3.6 kB for `dist/base.css`.                                                                                                          |
| `custom-elements.json`                     | The Custom Elements Manifest. It is committed and published, and `tests/custom-elements-manifest.test.ts` fails when it differs from a fresh run.                                                                                                                                                                          |
| `.stylelintrc.json`                        | This package's Baseline floor for Stylelint (below, "Styling"), on top of the root configuration.                                                                                                                                                                                                                          |
| `custom-elements-manifest.config.mjs`      | The Custom Elements Manifest analyzer's settings.                                                                                                                                                                                                                                                                          |

The published package has `exports` for `.`, `./base.css`, and `./package.json`, `files` set to
`dist` and `custom-elements.json` (npm adds `package.json`, `README.md`, and `LICENSE` to every
tarball itself), and `sideEffects` in array form (`["./dist/index.js", "./dist/*.css"]`), so a
bundler keeps the entry and any stylesheet and drops the rest of an unused import.
`publishConfig.access` is `public`, which a scoped package needs on its first publish.

The published declarations import nothing but relative files, `lit`, and `@lit/task`, because a
consumer installs only `dependencies`. `@bcd-embed/schema` is a private development dependency and
defines the contract types with Zod, so the source imports plain copies of them from
`src/contract.ts` instead. `tests/contract.test.ts` checks in the type checker that each copy and
its schema namesake are assignable to each other in both directions, so a schema change that the
copy misses fails `pnpm typecheck`. `tests/package.test.ts` fails when any emitted `.d.ts` file
imports a package that is not a dependency, and `tests/consumer-build.test.ts` type-checks a
consumer that has no `@bcd-embed/schema` at all.

## Message table

Every sentence the component renders is a message in `src/strings/en.ts`. The type checker checks a
message's placeholders: `formatMessage(table, "supported-since", { target })` fails to compile
without `version`. At run time, a missing value throws a `MissingPlaceholderError` that names the
message and the placeholder. `selectStrings("xx")` returns the English table, and
`selectStrings("en-GB")` returns it too, because only the language subtag counts.

The ids and the text match the string inventory in `docs/planning/07-component-phase1-markup.md`.
A test reads that table and fails when the two differ, so change both together.

## Notes

A BCD (`@mdn/browser-compat-data`) note is a string with a little HTML in it, such as
`Use <code>a</code>, see <a href="https://…">bug</a>.`. `parseNote` in `src/model/note.ts` turns
that string into a closed set of segments, so the renderer can write each one through Lit's text
and attribute bindings and nothing in a note ever becomes markup:

| Note markup                 | Segment                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------- |
| Plain text                  | `{ kind: "text", text }`                                                            |
| `<code>…</code>`            | `{ kind: "code", text }`                                                            |
| `<em>…</em>`                | `{ kind: "emphasis", text }`                                                        |
| `<a href="https://…">…</a>` | `{ kind: "link", href, children }`, where `children` holds text, code, and emphasis |

These are the only tags BCD 8.1.9 uses. A test reads every note in the installed BCD and fails when
a release adds another tag, which is the signal to extend the tokenizer. Everything else comes out
as literal text: other tags, tags with other attributes, tags left open, and links whose decoded
address does not start with `https://` and a host, which rules out `http:`, `javascript:`,
relative, and protocol-relative links. Every link in BCD 8.1.9 uses `https:`, so a test that
expects every link to be kept fails when a release adds another scheme. Empty code and emphasis
produce no segment, and a link whose content has no visible text gets its address as its text, so
it always has an accessible name.

Entities decode once, from a closed list: `&lt;`, `&gt;`, `&amp;`, `&quot;`, and decimal or
hexadecimal numeric entities. So `&amp;lt;` reads `&lt;`, and `&lt;code&gt;` is text, not a tag.
Unknown entities, and numeric ones for control characters, surrogates, noncharacters, or code
points past U+10FFFF, stay literal. An entity that stays literal inside a kept address is safe,
because a Lit attribute binding sets the value as-is and never decodes it.

The scanner consumes each character once and never steps back. A failed tag or entity attempt
reads at most one character it does not consume, and each attempt starts at a consumed `<` or `&`,
so a note of n characters takes at most 2n reads: O(n) time and space. `parseNoteWithSteps`
returns the number of reads, and a test checks that a 100,000-character note, and a set of
adversarial ones, take at most 2n. That count only sees reads through the scanner's reader, so a
second test checks the source: the tokenizer touches the note only through that reader, `slice`,
and `length`, never through a search such as `indexOf` or a regular expression. A third test checks
that the package source never uses an HTML string sink such as `innerHTML` or `unsafeHTML`.

A note can contain bidirectional control characters, written directly or as numeric entities,
which can reorder the text around them. The tokenizer leaves them alone. The renderer wraps each
note's segments in a `<bdi>` element, which isolates the note's text direction, so a note cannot
reorder the "Note:" label before it or the text after it.

## Feature client and request cache

`createFeatureClient({ fetch, now })` in `src/data/feature-client.ts` requests
`{endpoint}/v1/current/features/{query}.json` and resolves with a classified result. It never
throws for a failed request. A result is either `{ ok: true, payload, snapshot }`, where `snapshot`
is the `bcd-embed-snapshot` header, or `{ ok: false, reason, status, code }` with a `reason` of
`invalid-query`, `invalid-endpoint`, `network`, `http`, or `invalid-payload`. Tests inject `fetch`
and the clock, so no test touches the network. The element calls `getPageFeatureClient()`, which
creates one client per page on first use, and that client calls the page's `fetch` at the moment
it sends each request.

| Outcome                                                             | Cached for                       |
| ------------------------------------------------------------------- | -------------------------------- |
| A 200 with a feature response                                       | The life of the page             |
| A 4xx with a contract error code, except 429                        | The life of the page             |
| A network failure, a timeout, a 429, a 5xx, any other failed answer | 10 seconds (`FAILURE_WINDOW_MS`) |

The 10 seconds equal the block duration of the hosted API's rate limit
(`apps/website/src/content/docs/deployment.md`). The cache never retries by timer: a request goes
out again only when a caller asks after the window. A browser cannot read Cloudflare's edge 429,
because it has no CORS header, so `fetch` rejects and the result is `network` with `status: null`.

A caller's `AbortSignal` ends only that caller's wait. The shared request has its own internal
deadline instead, `REQUEST_TIMEOUT_MS` (20 seconds, covering the fetch and the body read), so a
stalled request ends as `network` and is held for the 10-second window instead of leaving every
element waiting. The header comment of `src/data/request-cache.ts` walks through the abort rule with
three elements.

The client checks the payload with types only (`isFeatureResponseEnvelope`), because Zod must stay
out of the bundle. The check is linear: the contract's major version is 1, each browser entry is an
object, and each feature is an object with a `support` object. It does not look inside a `support`
entry, so **the consumer must still map a throw while it builds its model or renders to
`invalid-payload`**. Callers share one payload object, so consumers must not mutate it; the cache
does not freeze it, because a deep freeze costs time proportional to the payload. The cache holds
one entry per distinct URL and never evicts a success. The default clock is `performance.now()`,
which a change to the system time cannot move.

The client checks `endpoint` before it builds a URL. An endpoint must be an absolute `https:` or
`http:` URL, on any host, with no credentials, query string, or fragment. `http:` exists for a
self-hosted API, typically on a local machine during development; a browser blocks an `http:`
request from an `https:` page as mixed content, and the element then reports `network`. Anything else gives `invalid-endpoint`, with no request and no cache entry.
Without the check an empty string would become a request relative to the page, and a `?` or `#`
would turn the feature path into a query string or a fragment. The raw text is checked for `?`
and `#`, because the URL parser reports `https://a.test/?` as having no query. A valid endpoint is
normalized through the URL parser, so `https://Example.TEST` and `https://example.test/` share one
cache entry.

The client is not exported from `src/index.ts`; the element is its only caller.

## Build and tests

| Command                                                  | What it does                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @schalkneethling/bcd-embed build`         | Builds `dist/index.js` and `dist/base.css` with Vite, emits the type declarations with `tsc`, then checks the size budget. It needs no other workspace built first, because the source imports the contract types from `src/contract.ts`. `pnpm build` builds everything.                                                                                            |
| `pnpm --filter @schalkneethling/bcd-embed check:package` | Runs publint, which checks `package.json` against the files `pnpm pack` would publish, and Are the Types Wrong (`attw`) with its `esm-only` profile, which checks that the entry's types resolve for ESM consumers. `base.css` is left out of `attw`, because a stylesheet has no types. Run it after `build`; `pnpm check` and the release workflow both do.        |
| `pnpm --filter @schalkneethling/bcd-embed typecheck`     | Type-checks the source, the tests and the screen reader tests.                                                                                                                                                                                                                                                                                                       |
| `pnpm --filter @schalkneethling/bcd-embed test:live`     | Runs the one test that calls the live, hosted API (`e2e/live-api.live.ts` with `playwright.live.config.ts`). It requests `css.properties.line-clamp` once, in Chromium, and is not part of `pnpm check` or of the Element browser workflow.                                                                                                                          |
| `pnpm exec vitest run packages/element`                  | Runs this package's Vitest tests from the repository root. `pnpm test` runs them with every other workspace's.                                                                                                                                                                                                                                                       |
| `pnpm --filter @schalkneethling/bcd-embed cem`           | Rewrites `custom-elements.json` beside `package.json`, and leaves `package.json` unchanged. Run it and commit the result whenever the element's attributes, properties, or events change. It lists the `bcd-compat-table` element with its six attributes (`query`, `endpoint`, `source`, `loading`, `browsers`, `locale`), its `data` property, and its two events. |

The Vitest tests include a production build into a temporary directory, which checks that
`dist/index.js` has no mention of `zod` and that `dist/base.css` has the shape "Styling" describes. The element imports no schema code, because Zod would roughly double the bundle. Another test emits the type declarations into a temporary
directory under `node_modules/.cache` and follows every import from `index.d.ts`, to check that
none of those files imports from `lit`, and a third reads every emitted declaration file to check
that it imports nothing but relative files and the package's dependencies.

`tests/consumer-build.test.ts` builds the package and then a throwaway consumer project with Vite
in production mode, and loads the built page in Chromium (the `playwright` package at the
repository root, using the Chromium headless shell that CI installs with
`pnpm exec playwright install --with-deps --only-shell chromium`). It also type-checks a consumer
against the emitted declarations and builds one that imports `base.css`.
`tests/custom-elements-manifest.test.ts` runs the analyzer into a directory under
`node_modules/.cache` and compares the result with the committed `custom-elements.json`. The
manifest lists the public surface only: a plugin in `custom-elements-manifest.config.mjs` removes
private members, so an internal refactor does not change it.

The size budget in `.size-limit.json` was 2 kB while the package held only the message table. The
element, the table model, and the note tokenizer measured 6.43 kB with Brotli, without Lit, so the
limit became 7 kB. Fetch mode (#203) brings the feature client and the request cache into the
bundle for the first time, and the total became 8.26 kB (8.07 kB before the review fixes), so the limit became 8.5 kB. Measured on their
own with Vite's minifier, the client and the cache account for about 1.4 kB of the 1.64 kB of
growth, and the element's fetch logic for the rest. The icons of #200 add the rest: with both,
`dist/index.js` measured 8.52 kB, 18 bytes over 8.5 kB, so the limit became 9 kB. Source mode (#205) adds the source reader and the parser wait: with fetch mode, source mode and the icons together, `dist/index.js` measures 8.97 kB, 30 bytes under 9 kB, so the limit is 9.5 kB. `dist/base.css`
measured 2.94 kB with Brotli against a limit of 3 kB. The sticky column, long-name, height and print rules of #201 brought it to 3.36 kB, so the limit became 3.5 kB. The inline icon of #281 and the support column floor brought it to 3.52 kB on 24 November 2026, so the limit is 3.6 kB. With the comments removed, the source files grew by 0.15 kB with Brotli; the rest of the growth is comments, which the file keeps because it is not minified (below, "Styling"). The entry's `name` in `.size-limit.json` records that measurement, so the
next person to raise the limit sees what it was set against.

The packaging issue (#206) added the two gzip entries. `size-limit` 14.3.0 measures with Brotli
unless an entry sets `"gzip": true`, and it counts `lit` unless an entry sets `ignore`. The first
new entry, `dist/index.js` with `"gzip": true` and no `ignore`, is the overall budget of Document 3
section 6: 16.68 kB against 25 kB, Lit and `@lit/task` included. The second measures
`src/render/table.ts`, which imports only `render/status.ts` and the message formatter, with
`"ignore": ["lit"]`: 1.74 kB against 8 kB, the threshold above which Document 3 proposes a lazy
renderer chunk. The same file bundled with Lit counts 8.10 kB, but the shell's `LitElement` base
class already brings in `lit-html`, the template engine that the renderer's templates run on, so a
lazy renderer chunk could move only the 1.74 kB (Document 3 section 6 records the reading). `size-limit` reads `kB` as 1,000 bytes.

## Browser tests

Two harnesses run the component in a real browser. Each was run once by the implementer of issue
#197 on macOS with Playwright 1.65.1, and again with the element's own tests by the implementer of
issue #198 on 20 November 2026. The Element browser workflow runs the three-engine one on every
pull request that changes this package.

| Harness                                      | Engines                   | Runs in         | Command                                                           |
| -------------------------------------------- | ------------------------- | --------------- | ----------------------------------------------------------------- |
| Vitest browser project (`*.browser.test.ts`) | Chromium (headless shell) | `pnpm check`    | `pnpm exec vitest run --project browser` from the repository root |
| Playwright Test with axe (`*.e2e.ts`)        | Chromium, Firefox, WebKit | Element browser | `pnpm --filter @schalkneethling/bcd-embed test:e2e`               |
| Visual snapshots (`*.visual.ts`)             | Chromium, Firefox, WebKit | By hand         | `pnpm --filter @schalkneethling/bcd-embed test:visual`            |

The visual snapshots show the table in a narrow container, scrolled so the sticky column covers the
other columns, and in a wide one, each in light and dark. They load
`e2e/fixtures/layout-visual.html`, which nothing else uses, so a change to another fixture page
cannot change them; a change to that page, to the fixture payload, or to the stylesheet does. Fonts and antialiasing differ between
operating systems, so an image matches only on the platform that recorded it, and
`playwright.visual.config.ts` keeps one set per platform under `e2e/__snapshots__/`. The committed
set was recorded on macOS by the implementer of #201 on 21 November 2026. The Element browser
workflow runs on Linux and has no set to compare against, so it does not run them; the layout
itself is asserted in `e2e/layout.e2e.ts`, which it does run. After a deliberate visual change,
run `test:visual --update-snapshots` and review the new images before committing them.

Install the browsers before the first run. Chromium's headless shell is enough for the Vitest
project, and it is a smaller download than the full browser. Use the workspace's own Playwright,
because a browser build is tied to the Playwright version.

```sh
pnpm exec playwright install --only-shell chromium
pnpm --filter @schalkneethling/bcd-embed exec playwright install firefox webkit
```

Add `--project=firefox` (or `chromium`, `webkit`) to `test:e2e` to run one engine. On Linux, add
`--with-deps` to the install commands to install the engines' system libraries.

The root `vitest.config.ts` has two projects, `node` and `browser`. The `node` project excludes
`**/*.browser.test.ts`, and the `browser` project includes only that pattern, so each file runs in
one project and the list of Node tests does not change. The `*.e2e.ts` files match neither, so
`vitest run` never collects them. Name a new test by where it must run, not by what it tests.

`playwright` and `@playwright/test` are pinned to the same exact version, in the root
`package.json` and in this package. Update them together. `pnpm why playwright @playwright/test -r`
prints one version of each when they agree.

`browser/bcd-compat-table.browser.test.ts` holds the element's rendering tests: the markup against
the Phase 1 page, the events, the fallback rules, notes that contain markup, and the bound on the
size of the rendered tree. `browser/fetch-mode.browser.test.ts` holds the fetch-mode lifecycle:
the input priority, sharing, `aria-busy`, each error reason, a query changed while a request is
pending, and an element removed while one is pending. It replaces the page's `fetch` in each test
and gives each test a query of its own, because the page's request cache lives as long as the
page.

`e2e/fixtures/smoke.html` is an inert page, and `e2e/smoke.e2e.ts` runs axe on it, so the harness
proves itself without the element. A violation fails the test with the rule's id and the
elements it flags, for example `image-alt` with `img`.

`e2e/fixtures/data-mode.html` is the element's fixture page. Its script assigns the adversarial
fixture to `data`, and its only stylesheet is the built `dist/base.css`, which holds the fallback
rule. `e2e/fixtures/unstyled.html` is the same page with no stylesheet. `playwright.e2e.config.ts`
runs `e2e/global-setup.ts` first, which builds the package, so the pages link the file a consumer
gets. `e2e/base-stylesheet.e2e.ts` checks the stylesheet itself (below, "Styling").
`e2e/frameworks.e2e.ts` runs the three framework pages (see "Frameworks") against two servers,
Vite's dev server on port 5199 and a static server on port 5200 that serves the production build
the global setup writes; `playwright.e2e.config.ts` starts both. `e2e/data-mode.e2e.ts` runs axe on
the loaded table, with every disclosure open, after an error, and after `data = null`. It also
checks the fallback rule's computed styles, the Tab key's stops, and that a note's markup never
runs, and it records the render time of a 2,000-feature table, in the page's width and in a 30em
container, where the region scrolls. `e2e/layout.e2e.ts` checks the layout of "Narrow
containers": sideways scrolling, the sticky column and its painted borders, display values at six
widths, a 320 CSS pixel viewport, a long name at depth 5 at 320 CSS pixels, right-to-left text,
forced colours where the engine really forces them, that no element around the table applies style
containment, print, the arrow keys, and axe. The page imports TypeScript source,
so `playwright.e2e.config.ts` starts Vite's dev server on port 5198 through `webServer` and stops
it afterwards. The run fails at once if that port is taken.

`e2e/fixtures/fetch-mode.html` holds each fetch-mode state still: a loading element and an error
element, each with and without fallback content, a network error, and a loaded table. Its
stand-in API, `e2e/fixtures/fixture-api.ts`, replaces the page's `fetch` for the origin
`https://fixture.test` only, so the page sends no request to a real server. The query
`fixture.pending` never answers, so the loading state lasts until the feature client's 20-second
deadline turns it into `network`; a test or a manual pass that needs it for longer installs
Playwright's fake clock first. `e2e/fetch-mode.e2e.ts` runs axe on those states. It also adds
elements to the page's `#lab` to check lazy loading against the real `IntersectionObserver`,
`eager`, one request for 50 elements, `data` with `query`, `endpoint`, a 404, and a failed
request. Playwright's routing answers requests to the hosted API's origin and to
`https://example.test`, with the API's CORS headers.

The Element browser workflow (`.github/workflows/element-browser.yml`) has a `changes` job, one
test job per engine, and a final `element-browser` job that is the required status check. It
reports on every pull request, passes when the tests passed or had nothing to test, and fails when
any engine failed or was cancelled. A failed run uploads `test-results/` with the traces.

## Screen reader tests

[Guidepup](https://www.guidepup.dev/) drives a real screen reader through Playwright and records
what it says. `screen-reader/walk-table.ts` makes the same moves through a table with every
screen reader, so the transcripts can be compared step by step. The VoiceOver and Orca tests then
perform Document 7's steps 8 to 12 (`docs/planning/07-component-phase1-markup.md`), through
`screen-reader/component-steps.ts`. The NVDA test performs steps 2 and 8 to 12 with its own moves
and its recorded wording, so that NVDA's output for those steps lands in its transcript too.

**What the walks load.** Every walk loads one page, `screen-reader/fixtures/component.html`,
which renders `<bcd-compat-table>` from the adversarial fixture (`v1NormalizedFixture` in
`@bcd-embed/schema`), with a fallback paragraph inside the element. The page is a built page: Vite
builds it into `dist-screen-reader/` (`vite.screen-reader.config.ts`), and each Playwright config
starts `vite preview` on port 5199 to serve it (`screen-reader/server.ts`). The walks therefore
hear the table the element renders, including the `<bdi>` around each note. The page imports
`@schalkneethling/bcd-embed` as a consumer does, and the config maps that name to the library build,
`dist/index.js`, so the package's `sideEffects` list applies. The build script therefore builds
the library first. They no longer load
the static pages in `docs/planning/phase1-markup/`, which are a record of the Phase 1 decision.
Because the element renders variant A only, the walks do not cover Document 7's steps 13 and 14,
which compare variant B with variant A. Those stay with the manual pass (#186).

The page links the built base stylesheet, `dist/base.css`, so the walks hear the element as an
author who opts into the stylesheet ships it, with the fallback paragraph hidden once the table
has rendered. `vite.screen-reader.config.ts` copies the file unminified. With the stylesheet, each
cell's icon-and-version span is displayed but keeps `aria-hidden="true"`, so no screen reader
reads it, and the sentence span is clipped out of sight but stays in the accessibility tree. So
#200 changed no check of any walk; the CI walks confirm the wording.

**The build step.** Build the page before any walk:

```sh
pnpm --filter @schalkneethling/bcd-embed build:screen-reader-fixture
```

The walks fail without it, because `vite preview` exits when `dist-screen-reader/` does not
exist. The workflow runs the build as its own step before the tests, so a build that fails fails
the job instead of skipping it. Rebuild after any change to `src/`, because the walks hear the
last build, not the source.

| Screen reader | Runs on                              | Browser              | Command                                                   |
| ------------- | ------------------------------------ | -------------------- | --------------------------------------------------------- |
| VoiceOver     | macOS 26 (`macos-26`)                | Playwright's WebKit  | `pnpm --filter @schalkneethling/bcd-embed test:voiceover` |
| Orca          | Ubuntu 26.04 (`ubuntu-26.04`)        | Playwright's Firefox | `pnpm --filter @schalkneethling/bcd-embed test:orca`      |
| NVDA          | Windows Server 2025 (`windows-2025`) | Playwright's Firefox | `pnpm --filter @schalkneethling/bcd-embed test:nvda`      |

The tests are not part of `pnpm check`, because the screen reader takes over the machine while
they run. The Screen readers workflow (`.github/workflows/screen-readers.yml`) runs all three on
pull requests that change this workspace or the schema package, and on manual runs. Its `screen-readers`
job is a required status check: it reports on every pull request and blocks the merge when any
screen reader fails or is cancelled.

Each test writes a `transcript.json` to its directory under `test-results/`, attaches it, and
prints it to the job log. The workflow uploads `test-results/` as the artifact
`screen-reader-results-<reader>` after a pass and after a failure. The checks on the page (which
element has focus, whether a disclosure is open) stop the test at once. The checks on the spoken
wording are soft: a mismatch still fails the test, but only after the walk has finished, so the
transcript is complete. Where the wording is the screen reader's own and is not yet known, the
step has no check and is performed for the transcript alone.

Some expectations are not recordings of the screen reader. The first cell's check reads the
string table (`src/strings/en.ts`) and builds the cell's sentence from it, so the sentence is
written once. VoiceOver's and Orca's checks for steps 8 to 11 do the same, for the cell's fact.
VoiceOver's passed in CI run 44788533467, and Orca's step 8 text appears in that run's transcript,
but Orca never reached steps 9 to 11 on the cells, so those are unconfirmed. NVDA's checks are
recordings: of the static page, and of the component in that run, which changed three phrases
(Document 7, "NVDA in CI").

To run them locally, set the machine up once with `pnpm dlx @guidepup/setup@0.29.3 setup`. Then,
in `packages/element`, install the assets with `pnpm dlx @guidepup/setup@0.29.3 install` and the
browser with `pnpm exec playwright install webkit` on macOS, or `firefox` on Linux and Windows.
Build the fixture page (above), then run the test. On Linux, run the tests inside
`xvfb-run dbus-run-session --`.

The setup tool is not a dependency of this workspace, because it only prepares a machine and
the tests never import it. Running it with `pnpm dlx` keeps its version pinned in one command.

`@guidepup/guidepup` is pinned to 0.39.0, the version in `package.json`. `@guidepup/playwright`
0.21.0 lists 0.38.0 as its own development dependency and accepts 0.38.0 or later as a peer, so
0.39.0 satisfies it. Version 0.40.0 groups the Orca commands by service, and
`@guidepup/playwright` 0.21.0 still looks them up by their old flat names, so moving Orca into the
page fails with "Cannot read properties of undefined (reading 'service')". Update the two packages
together.

### What each pairing covers

Document 3 §9 makes NVDA with Firefox and VoiceOver with Safari a release gate. VoiceOver with
Safari stays a manual pass by the owner, which no pairing here replaces. NVDA with Firefox is met
by the NVDA walk here passing on the release commit and the owner reviewing its transcripts. The
three pairings cover the gate to different degrees.

| Pairing                        | Stands in for         | What it covers, and what it leaves out                                                                                                                                                                         |
| ------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VoiceOver, Playwright's WebKit | VoiceOver with Safari | The real screen reader in a WebKit build that is not Safari. Safari's own accessibility behaviour, such as which elements take a tab stop, can differ, so the manual Safari pass stays.                        |
| NVDA, Playwright's Firefox     | NVDA with Firefox     | The real screen reader in a Firefox build, on Windows Server rather than a desktop Windows. The owner signs off NVDA's part of each pass by reading the transcripts, because the owner has no Windows machine. |
| Orca, Playwright's Firefox     | No required pairing   | A second reading of Firefox, on Linux. Orca is not part of the release gate. It is kept because it shows how another screen reader announces the same markup in Firefox.                                       |
