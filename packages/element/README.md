# `@bcd-embed/element`

The `<bcd-compat-table>` web component (`docs/planning/03-web-component-architecture.md`). The
element renders in two modes. In fetch mode it requests the feature named by its `query`
attribute from the API. In data mode a page assigns a payload to its `data` property, and the
element renders the table with no request. The `source` attribute is a later issue (#205). The
package also holds the message table, the note tokenizer, the table model, the feature client,
and the screen reader tests, which walk the element's own table.

## Usage

The package is not published yet (`private` is `true`), so this is how a page will use it once it
is. Importing the package defines the element.

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
  import "@bcd-embed/element";

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
  import "@bcd-embed/element";

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
stylesheet, which Phase 3 ships, hides every other child while `loaded` is present. Until then the
rule lives in `e2e/fixtures/fallback.css`. A page that loads no stylesheet shows the fallback next
to the table. If a script removes the container, which React does when it changes a single string
child, the element puts the same container back. The class `bcd-render-container` belongs to the
element: it removes any other child that carries it, because such a child is a copy of an earlier
table, from `cloneNode(true)` or from saved HTML. That is the one case where it removes a child.

**Re-rendering.** Rows are keyed by feature and cells by target, so a disclosure a reader opened
stays open on its own cell when `browsers` changes or a new payload has the same feature.

**What the markup is.** The table matches `docs/planning/phase1-markup/index.html` (variant A,
headers associated by `scope`), element for element and attribute for attribute, with one
addition: each note sits in a `<bdi>` element, so a note that contains bidirectional control
characters cannot reorder the words around it. A browser test compares the two. Each cell holds a
glyph span with `aria-hidden="true"` and `hidden`, then a span with the full sentence, so a page
with no stylesheet reads every cell as its sentence. The glyphs are Phase 1's placeholders until
Phase 3 chooses icons.

**TypeScript.** `document.querySelector("bcd-compat-table")` returns `BcdCompatTableElement`, a
hand-written interface, and `addEventListener("bcd-load", …)` types `event.detail`. No type from
Lit is public: the entry does not export the element's class, and a test fails when any
declaration file the entry reaches imports from `lit`.

### Size of the rendered table

The element builds the model and the markup in one pass each, so one update costs
O(F × T + S + C) time and space for F features, T shown targets, S statements with their flags and
notes, and C characters of text. The number of elements is bounded too. `src/render/table.ts`
derives the exact bound, and a browser test checks it on 2,000 features by four targets:

```text
elements ≤ 14 × F × T + 9 × S + E + 10
```

Here S counts each statement, flag, and note, and E counts the code, emphasis, and link elements
inside notes. The short form holds for at least one feature and one target; the exact bound in
`src/render/table.ts` holds always. The 2,000-feature test payload renders 61,618 elements, including the render
container.

Render time for that payload, measured on 20 November 2026 on an Apple silicon Mac (Darwin 27.2.0,
load average near 15, because other work ran beside it) with Playwright 1.65.1, one test at a time, three runs each. The page ran
Lit's development build from the Vite dev server, which is slower than the production build. The
times are recorded by `e2e/data-mode.e2e.ts`, which prints them and never asserts them.

| Engine (Playwright build) | Until `bcd-load` (model and markup) | Until two animation frames later (layout and paint) |
| ------------------------- | ----------------------------------- | --------------------------------------------------- |
| Chromium                  | 191 to 199 ms                       | 394 to 412 ms                                       |
| Firefox                   | 365 to 572 ms                       | 598 to 903 ms                                       |
| WebKit                    | 355 to 376 ms                       | 921 to 939 ms                                       |

A row cap does not need to become a follow-up now. A feature's table holds the feature and
everything nested under it, and the largest such subtree in BCD 8.1.9 is `api.Element` with 314
features; five subtrees have more than 200 and none has more than 500. So 2,000 rows is more than
six times the largest real table, and it rendered in under a second here. These numbers come from
one fast machine, so measure again on a slow phone before relying on them for very large tables.

## Layout

| Path                                       | Holds                                                                                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/index.ts`                             | The package entry. It defines the element, and everything the package exports passes through it.                                                                   |
| `src/bcd-compat-table.ts`                  | The element's class: its properties, the render container, the `loaded` attribute, the events.                                                                     |
| `src/render/`                              | The Lit templates that map the table model to the Phase 1 markup, the placeholder glyphs (`status.ts`), and the loading and error sentences (`error.ts`).          |
| `src/model/table-model.ts`                 | `buildTableModel`, which turns a payload into columns, rows, cells, and sentences, with no DOM.                                                                    |
| `src/strings/en.ts`                        | The English message table, keyed by message id, with `{placeholders}`.                                                                                             |
| `src/strings/format.ts`                    | `formatMessage`, `formatMessageToParts`, `MissingPlaceholderError`, and `selectStrings`, which falls back to English.                                              |
| `src/data/request-cache.ts`                | The request cache: one entry per URL, shared in-flight requests, and per-result retention.                                                                         |
| `src/data/feature-client.ts`               | The feature client: builds the URL, calls `fetch`, and classifies the answer.                                                                                      |
| `src/public-types.ts`                      | The public types, including the hand-written `BcdCompatTableElement`. `@bcd-embed/schema` is imported with `import type` only.                                     |
| `src/model/note.ts`                        | `parseNote`, which turns a BCD note string into text, code, emphasis, and link segments.                                                                           |
| `tests/`                                   | Vitest tests, `tests/fixtures/message-cases.ts`, the fixtures the schema package lacks, and `tests/fixtures/large-payload.ts`, which builds a payload of any size. |
| `browser/`                                 | Browser tests for the Chromium Vitest project, named `*.browser.test.ts`.                                                                                          |
| `e2e/`, `playwright.e2e.config.ts`         | Playwright Test files named `*.e2e.ts`, run in three engines with axe, and their fixtures.                                                                         |
| `screen-reader/`, `playwright.*.config.ts` | The screen reader tests and the fixture page they load (below).                                                                                                    |
| `vite.config.ts`, `tsconfig.build.json`    | The library build and its type declarations.                                                                                                                       |
| `vite.screen-reader.config.ts`             | The build of the screen reader fixture page into `dist-screen-reader/`, which is not committed.                                                                    |
| `.size-limit.json`                         | The size budget for `dist/index.js`, counted without `lit` and `@lit/task`: 8.5 kB with Brotli.                                                                    |
| `custom-elements-manifest.config.mjs`      | The Custom Elements Manifest analyzer's settings.                                                                                                                  |

`private` stays `true`, so nothing publishes yet. The package already has the shape a published one
needs: `exports` for `.` and `./package.json`, `files` set to `dist`, and `sideEffects` in array
form (`["./dist/index.js", "./dist/*.css"]`), so a bundler keeps the entry and any stylesheet and
drops the rest of an unused import. Before the package publishes, note that the emitted
`dist/public-types.d.ts` imports types from `@bcd-embed/schema`, which is only a development
dependency here. A consumer's type checker cannot resolve it unless that package is published and
listed as a dependency, or the types are inlined.

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

| Command                                      | What it does                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @bcd-embed/element build`     | Builds `dist/index.js` with Vite, emits the type declarations with `tsc`, then checks the size budget. It needs `@bcd-embed/schema` built first, because the declarations import its types. `pnpm --filter @bcd-embed/element... build` builds the package and its dependencies in order, and `pnpm build` builds everything. |
| `pnpm --filter @bcd-embed/element typecheck` | Type-checks the source, the tests and the screen reader tests.                                                                                                                                                                                                                                                                |
| `pnpm --filter @bcd-embed/element test:live` | Runs the one test that calls the live, hosted API (`e2e/live-api.live.ts` with `playwright.live.config.ts`). It requests `css.properties.line-clamp` once, in Chromium, and is not part of `pnpm check` or of the Element browser workflow.                                                                                   |
| `pnpm exec vitest run packages/element`      | Runs this package's Vitest tests from the repository root. `pnpm test` runs them with every other workspace's.                                                                                                                                                                                                                |
| `pnpm --filter @bcd-embed/element cem`       | Writes `dist/custom-elements.json`. It leaves `package.json` unchanged. It lists the `bcd-compat-table` element with its `query`, `endpoint`, `loading`, `browsers`, and `locale` attributes and its two events.                                                                                                              |

The Vitest tests include a production build into a temporary directory, which checks that
`dist/index.js` has no mention of `zod`. The element reads the schema package's types only, because
Zod would roughly double the bundle. Another test emits the type declarations into a temporary
directory under `node_modules/.cache` and follows every import from `index.d.ts`, to check that
none of those files imports from `lit`.

The size budget in `.size-limit.json` was 2 kB while the package held only the message table. The
element, the table model, and the note tokenizer measured 6.43 kB with Brotli, without Lit, so the
limit became 7 kB. Fetch mode (#203) brings the feature client and the request cache into the
bundle for the first time, and the total is now 8.26 kB (8.07 kB before the review fixes), so the limit is 8.5 kB. Measured on their
own with Vite's minifier, the client and the cache account for about 1.4 kB of the 1.64 kB of
growth, and the element's fetch logic for the rest. The entry's `name` in `.size-limit.json` records that measurement, so the
next person to raise the limit sees what it was set against. The overall budget of 25 kB with gzip, Lit included, is set and checked by the
packaging issue (#206).

## Browser tests

Two harnesses run the component in a real browser. Each was run once by the implementer of issue
#197 on macOS with Playwright 1.65.1, and again with the element's own tests by the implementer of
issue #198 on 20 November 2026. The Element browser workflow runs the three-engine one on every
pull request that changes this package.

| Harness                                      | Engines                   | Runs in         | Command                                                           |
| -------------------------------------------- | ------------------------- | --------------- | ----------------------------------------------------------------- |
| Vitest browser project (`*.browser.test.ts`) | Chromium (headless shell) | `pnpm check`    | `pnpm exec vitest run --project browser` from the repository root |
| Playwright Test with axe (`*.e2e.ts`)        | Chromium, Firefox, WebKit | Element browser | `pnpm --filter @bcd-embed/element test:e2e`                       |

Install the browsers before the first run. Chromium's headless shell is enough for the Vitest
project, and it is a smaller download than the full browser. Use the workspace's own Playwright,
because a browser build is tied to the Playwright version.

```sh
pnpm exec playwright install --only-shell chromium
pnpm --filter @bcd-embed/element exec playwright install firefox webkit
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
fixture to `data`, and its only stylesheet is the fallback rule. `e2e/data-mode.e2e.ts` runs axe on
the loaded table, with every disclosure open, after an error, and after `data = null`. It also
checks the fallback rule's computed styles, the Tab key's stops, and that a note's markup never
runs, and it records the render time of a 2,000-feature table. The page imports TypeScript source,
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
`@bcd-embed/element` as a consumer does, and the config maps that name to the library build,
`dist/index.js`, so the package's `sideEffects` list applies. The build script therefore builds
the library first. They no longer load
the static pages in `docs/planning/phase1-markup/`, which are a record of the Phase 1 decision.
Because the element renders variant A only, the walks do not cover Document 7's steps 13 and 14,
which compare variant B with variant A. Those stay with the manual pass (#186).

The page carries the fallback rule from `e2e/fixtures/fallback.css`, which hides the fallback
paragraph once the table has rendered. The base stylesheet will ship that rule, and the page
will then use the base stylesheet instead.

**The build step.** Build the page before any walk:

```sh
pnpm --filter @bcd-embed/element build:screen-reader-fixture
```

The walks fail without it, because `vite preview` exits when `dist-screen-reader/` does not
exist. The workflow runs the build as its own step before the tests, so a build that fails fails
the job instead of skipping it. Rebuild after any change to `src/`, because the walks hear the
last build, not the source.

| Screen reader | Runs on                              | Browser              | Command                                           |
| ------------- | ------------------------------------ | -------------------- | ------------------------------------------------- |
| VoiceOver     | macOS 26 (`macos-26`)                | Playwright's WebKit  | `pnpm --filter @bcd-embed/element test:voiceover` |
| Orca          | Ubuntu 26.04 (`ubuntu-26.04`)        | Playwright's Firefox | `pnpm --filter @bcd-embed/element test:orca`      |
| NVDA          | Windows Server 2025 (`windows-2025`) | Playwright's Firefox | `pnpm --filter @bcd-embed/element test:nvda`      |

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
