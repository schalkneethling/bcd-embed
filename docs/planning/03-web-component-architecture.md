# Document 3 — Web Component: Architecture, Accessibility, and Implementation Plan

**Status:** Draft for review
**Depends on:** Document 1 (API Contract). Independent of Document 2.

---

## 1. Purpose and constraints

The component renders a browser compatibility table from the data in Document 1. Purpose: let an author embed a table that stays correct as support changes, without manually maintaining it.

Three constraints follow and shape every decision below.

**Unopinionated about style, by design.** The component makes no aesthetic decisions on the author's behalf — no opinion on color, typography, or visual identity beyond what the underlying semantics require. What it provides is a clean, semantic, accessible table structure, plus just enough base CSS to make that structure usable without requiring the author to write any styling at all. That base styling stays deliberately minimal and neutral by default, and where color is used to convey meaning — a support state, for instance — it never carries that meaning alone; it is paired with shape or iconography, detailed in §5. Full control over how the table actually looks belongs to the author. This is the primary argument for light DOM (§3).

**Accessible by design, not by remediation.** The multi-dimensional nature of the data (§5) makes this the section with the most engineering risk and the most room for improvement over existing implementations of this kind of table.

**Cheap.** A single documentation page may embed several tables. The component must not require a framework runtime or block on a network round trip to render.

---

## 2. Dependency: Lit

Lit is used. Cost/benefit:

**Gained:** declarative templating with targeted updates, a properties/attributes reflection model that is error-prone to hand-roll, a tested async task primitive for the fetch lifecycle.

**Paid:** roughly 5 KB compressed, plus a reactivity runtime the table does not strictly require given how little post-load state it has (the disclosure interaction is the only state change after data arrives).

A hand-rolled element is feasible given the low dynamism, but correct attribute reflection, batched updates, and lifecycle handling are non-trivial to implement reliably, and the resulting custom implementation would need the same testing investment as Lit already has. Lit is the more efficient choice.

**Constraint:** Lit is an implementation detail, not part of the public contract. No Lit type appears in any exposed attribute, property, event, or CSS surface. Replacing Lit later should require no consumer-facing change.

---

## 3. Light DOM default

The component renders into light DOM by default — not as a fallback, but as the primary design.

Rationale specific to this component: the table is the author's content and should inherit the author's existing table styles, typography scale, color tokens, and print stylesheet without reintroduction through custom properties. A shadow root would sever all of that and require rebuilding it property-by-property.

**Decided: no shadow DOM anywhere in this component.** The disclosure (§5) is built on native `<details>`/`<summary>` rather than a custom widget, and native elements carry their own semantics without needing encapsulation to protect them — there is nothing left that would justify a shadow root. This resolves what was previously an open question in favor of the simpler answer: light DOM throughout, full stop.

**Declarative Shadow DOM (DSD) is not needed.** DSD exists to let a server or build step emit shadow content as HTML that hydrates without a flash — but with no shadow root anywhere in this component, there is no shadow content to declare, in any mode, current or deferred. If full server-side rendering of the markup is ever built (§7 — currently deferred, not v1), it would be plain server-rendered light-DOM HTML, including the native `<details>`/`<summary>` disclosure, functional before any hydration attaches; no DSD-equivalent mechanism would be required.

### Cascade layers

Light DOM means base styles have no encapsulation and can collide with author styles. Mitigation: cascade layers — declared explicitly, with the actual CSS imported into the declared layer rather than wrapped inline in one large block.

```css
/* base.css, the opt-in stylesheet an author imports */
@layer bcd-embed.base;

@import "./table.css" layer(bcd-embed.base);
@import "./tokens.css" layer(bcd-embed.base);
@import "./container-queries.css" layer(bcd-embed.base);
```

Declaring the layer name up front, separately from importing content into it, is deliberate rather than a stylistic preference: it fixes this layer's position in the cascade order the moment the stylesheet is parsed, before any of the actual rules are known, and it lets the base styles live as ordinary, layer-agnostic CSS files in the source tree — each `@import ... layer(...)` is what assigns a file to the layer, not a wrapping block inside it. This also scales cleanly if the base styles end up split across more than one concern (table structure, design tokens, container-query breakpoints) without needing repeated `@layer bcd-embed.base { }` wrappers in every file.

Any un-layered author style overrides layered styles regardless of specificity, so authors override the component with ordinary CSS and no `!important`. Authors using layers themselves can order this layer explicitly relative to their own, since its name is declared and stable.

Base styles are shipped as a separate, opt-in stylesheet. A consumer wanting only semantic markup imports nothing.

Two standing rules govern every line of CSS this project authors and ships, not just the base stylesheet: every custom property is registered via `@property` unless there is a specific, stated reason not to — the token surface in §4 is where this is worked through in detail — and every property and value is logical, not physical: `inline-size`/`block-size` rather than `width`/`height`, `margin-inline`/`margin-block` rather than `margin-left`/`margin-right`/`margin-top`/`margin-bottom`, `inset-inline-start` rather than `left`, and so on throughout. This is what makes the component's layout correct under RTL and vertical writing modes without separate handling, and it costs nothing extra to do from the start.

---

## 4. Public API

### Element

```html
<bcd-compat-table query="css.properties.display"></bcd-compat-table>
```

**Attributes/properties.**
- `query` — BCD dotted key. Only required input.
- `endpoint` — overrides the API base URL. This is the entire self-hosting mechanism.
- `browsers` — optional space-separated override of the displayed support-target set (browsers and runtimes, Document 1 §5.1). Defaults to `chrome firefox safari nodejs` — the three independent rendering engines plus Node.js, not a popularity pick (§11). The API itself returns everything; this attribute is the only curation point.
- `locale` — selects the string table.
- `loading` — `lazy` (default) or `eager`. Mirrors native `<img loading>` rather than inventing new vocabulary. `lazy` is the `IntersectionObserver`-deferred behavior in §6, the right default given several tables per page is the stated design case; `eager` opts a specific instance out — a table already known to be above the fold, or test automation where waiting on intersection timing adds flakiness rather than value.
- `.data` (property only) — a contract-conformant payload set directly. When present, no fetch occurs, so `loading` has no effect: there is nothing to defer. This is the build-time property-assignment path (§7).
- `source` — the `id` of a sibling `<script type="application/json">` element carrying a contract-conformant payload. Read once in `connectedCallback`, synchronously, no fetch, no script execution required beyond the component's own (§7). Takes priority in a documented, fixed order if `query`, `.data`, and `source` are somehow set simultaneously — `source` and `.data` before `query`, since an already-present payload should never be discarded in favor of a network request.

**Multiple features.** Use multiple elements rather than a `query` list attribute. Each element needs independent loading state, error state, and cache entry, and stacking several features into one table is an authoring decision, not a component default. BCD's own key nesting (a query returning a parent and its descendants) is already one table by definition and is handled without special-casing.

**Events.** Lifecycle events for load and error, so a host page can detect and surface a failed table rather than let it fail silently.

**Slots.** Author-supplied fallback content for the no-JavaScript and error cases (§7). In light DOM this means rendering provided children rather than replacing them, distinct from shadow-DOM slotting but similar in authoring model.

### Styling surface

Theming uses registered custom properties. This is the default for every custom property the component exposes, not just the color example below — registration gives type checking via `syntax`, a guaranteed `initial-value` so nothing silently inherits an unset value, and animatability that an unregistered `--custom-prop` doesn't get. A property is left unregistered only for a specific, stated reason (for instance, a value type `@property`'s `syntax` grammar cannot express), not by default or oversight:

```css
@property --bcd-color-supported {
  syntax: "<color>";
  inherits: true;
  initial-value: canvastext;
}
```

The token surface covers support-state colors, spacing, border treatment, and the icon set. Layout and typography are controlled through the ordinary cascade, since light DOM already exposes them; custom properties are the design-token surface, not the primary styling mechanism. This distinction should be stated in the documentation, since it differs from typical shadow-DOM component conventions.

Rendered class names are part of the public contract once anyone styles against them. They are namespaced, documented, and versioned.

---

## 5. Accessibility

The data is multi-dimensional: feature, by support target (browser or runtime), by version, with modifiers for partial support, flags, prefixes, alternative names, removal, and notes. Compressing this into a two-dimensional grid is where accessibility failures typically originate, and the failure cannot be corrected after the fact with added ARIA — the underlying structure has to be right.

### Native semantics

A real `<table>` with `<thead>`, `<tbody>`, `<th>`, `<td>` — not a grid of `div`s with `role="table"`. This also preserves compatibility with print stylesheets, reader modes, and copy-to-spreadsheet.

The header is two-tiered (a platform row above a support-target row — Chrome, Node, Deno, and so on, per Document 1 §5.1), so `scope` alone may be insufficient. `scope="colgroup"` on platform headers and `scope="col"` on support-target headers is the baseline; for a header this dense, explicit `headers`/`id` association may be required to guarantee correct announcement (e.g., "display, Chrome, supported since version 1"). This must be verified against actual assistive technology, not assumed from the specification. A `<caption>` names the table; the feature name is a row header (`<th scope="row">`), not a data cell.

### Per-cell accessible names

Every cell requires a programmatically determinable name stating the complete fact — "Supported since Chrome 29," not a bare checkmark; "No support," not a colored box; "Partial support since Firefox 63, see note," not an icon alone. A cell whose meaning depends solely on icon color fails WCAG 1.4.1 and communicates nothing to a screen reader.

Lucide is a reasonable source for the icon set: MIT-licensed (matches the project's own licensing decision, Document 2 §2), plain SVG at its core rather than tied to a specific framework, so it fits a light-DOM component without needing a React-specific wrapper, and its line-icon style pairs cleanly with the shape-based non-color affordances this section already requires — a check for supported, an x for unsupported, a dash or slash for unknown, and so on. The specific icon-to-state mapping is an implementation detail to settle during Phase 3 (§10), alongside the ColorADD/ColorSym-informed palette (below), not a decision this document needs to fix in advance.

Implementation: the icon is decorative and hidden from assistive technology; visible cell text carries the version; a visually hidden span carries the full accessible name. Modifiers (flag, prefix, alternative name, partial, removed) are part of that name, not separate icons requiring reconstruction by the reader.

Color is never the sole carrier of meaning: each support state needs a distinguishable non-color affordance (shape, glyph, or text), and the default palette must meet WCAG 1.4.11 (non-text contrast) for icons and 1.4.3 for text. Both are asserted in automated tests. Two systems built specifically for this problem, worth designing from rather than inventing ad hoc: [ColorADD](https://www.coloradd.net/en/) and [ColorSym](https://colorsym.com/), both pairing color with shape for colorblind users. Directly relevant to the default support-state palette and its paired iconography (§4's token surface).

### Disclosure pattern for version history

Expanding a cell to reveal its full timeline uses native `<details>`/`<summary>` rather than a hand-built disclosure. This removes most of the custom-ARIA burden a hand-rolled version would carry: `<summary>` is natively focusable and keyboard-operable (Enter and Space toggle it with no added script), and the browser exposes and maintains open/closed state to assistive technology without a manually managed `aria-expanded`. Notably, focus is never moved by the browser on toggle, so the custom focus-management logic a hand-built version would need — returning focus to the trigger on collapse — simply isn't a problem here.

What still needs deliberate authoring: the `<summary>` content must be an accessible name identifying *which* cell is expanding, not a generic "show more" repeated identically across every cell, and hover must never be the sole means of conveying information, as with any interactive element.

Notes/footnotes are revealed inline within the disclosure, associated with their cell, rather than referenced via a separate superscript marker — a pattern that otherwise strands screen reader users.

### Responsive behavior

A semantic `<table>` reflowing correctly at narrow widths without losing its semantics is an unresolved problem generally. Default approach: a horizontally scrolling region with `tabindex="0"` (keyboard focusability; a non-focusable scroll region is a WCAG 2.1.1 failure), a `role="region"` accessible name, and a visible focus indicator.

Browser behavior here has been shifting, worth being precise about: Firefox has made scroll containers focusable by default for a long time, and Chrome added the same from 130/132 onward — but only when the scroller has no focusable children. That condition doesn't hold for this table specifically: the version-history disclosures (§5, above) use native `<summary>`, which is itself focusable, so Chrome's auto-focusable-scroller feature does not apply here — Tab would land on the first `<summary>` inside the scroller, not on the scroller itself. Support also isn't universal regardless: MDN's current guidance (`overflow`'s [Accessibility section](https://developer.mozilla.org/en-US/docs/Web/CSS/overflow#accessibility)) still recommends explicit `tabindex="0"` to guarantee keyboard access "in some browsers" that don't do this automatically. So the explicit `tabindex="0"` above isn't legacy caution — for this component specifically it's necessary, not just a safe default, and it costs nothing in browsers that would have handled it natively anyway.

Preferred refinement: container queries, since the reflow decision depends on the component's container rather than the viewport. Shared First discipline applies to container queries as it does to media queries — shared styles outside the query block, each size range self-contained. This lives in `container-queries.css`, one of the files imported into the `bcd-embed.base` layer above — the layer wrapper is declared once at import time (§3), not repeated per file:

```css
/* container-queries.css — no @layer wrapper needed; layer(bcd-embed.base)
   at the import site (§3) already assigns everything in this file */

/* shared — true at every container size */
.bcd-table { inline-size: 100%; border-collapse: collapse; }

@container (width < 40em) {
  /* narrow container: sticky feature column, horizontal scroll */
}

@container (width >= 40em) {
  /* wide container: full grid */
}
```

A sticky first column keeps the feature name visible while support-target columns scroll. `position: sticky` interacting with `border-collapse` inside a scroll container has known quirks, and this needs verification, not assumption, against the component's actual markup.

Worth tracking, not relying on yet: a genuine fix for the classic sticky-header-plus-sticky-first-column problem — this table's exact requirement — is in progress in the CSS Working Group, letting `position: sticky` track a different scroll container per axis (first column against the table wrapper, header against the document) instead of one shared scroller for both. Per [Bramus Van Damme](https://www.bram.us/2026/03/30/css-sticky-per-axis/), it requires `overflow: auto clip` on the wrapper rather than plain `overflow-x: auto`, which implicitly enables vertical scrolling too and re-traps the header. As of this writing it's Chrome-only and experimental (landed behind a flag in Chrome 148, `@supports` detection following in Chrome 150, stable shipping still pending); Firefox and Safari don't implement it. Not something v1 can depend on — the container-query approach above remains the cross-browser default — but worth revisiting at Phase 3 (§10), since it would let the design drop the duplicated-header workaround once support broadens.

Alternative considered and rejected: a card-per-support-target layout at very narrow widths, which abandons the `<table>` element and its semantics.

### Motion and preference

Expansion animation respects `prefers-reduced-motion`. Default palette respects `prefers-color-scheme`; `light-dark()` follows an author-set `color-scheme` where present.

---

## 6. Performance

Multiple tables per page is the expected case.

The component does not fetch until needed, by default: an `IntersectionObserver` defers both payload and rendering code until the section nears the viewport. This is the `loading="lazy"` default (§4); `loading="eager"` skips the observer and fetches immediately, for the specific cases where deferral costs more than it saves (§4).

Requests are deduplicated and cached at module level, so multiple tables querying overlapping keys on one page produce one fetch, not several.

Rendering happens once from fully resolved data rather than progressively, avoiding layout thrash. Payloads are compressed at the service (Document 1 §9); this is load-bearing for the performance budget.

The package ships as ESM, tree-shakeable, with the table renderer in a separate chunk from the element shell. `sideEffects` in `package.json` is deliberately **not** a blanket `false`: the element package's entry point calls `customElements.define(...)` at module scope — a genuine side effect a bundler must not remove, and exactly what a bare `"sideEffects": false` risks dropping ([rollup/rollup#5538](https://github.com/rollup/rollup/issues/5538) documents this happening for prototype-mutation side effects; the underlying `sideEffects`/`moduleSideEffects` confusion is tracked in [rollup/rollup#5987](https://github.com/rollup/rollup/issues/5987)). [vitejs/vite#14321](https://github.com/vitejs/vite/issues/14321) covers the equivalent gap for CSS imported via JS, relevant if base styles are ever distributed that way rather than as a plain `.css` file. Correct configuration: the array form, `"sideEffects": ["./dist/element.js"]` (or whichever file(s) call `customElements.define`), leaving `core`, `schema`, and the pure rendering helpers genuinely tree-shakeable. Worth verifying with an actual bundle-analyzer pass (Phase 7, §10), not assumed from the package.json alone.

---

## 7. Data-flow modes

Fetch-from-API and works-without-JavaScript are not simultaneously achievable without a build-time path, so this needs resolving explicitly rather than being discovered later.

**v1 priority is fetch mode, then data mode.** Full server-side rendering of the markup is deferred (see below) — it is a reasonable thing to want eventually, but committing to it now, before fetch mode has shipped and been used, is scope creep this document should not lock in.

**Fetch mode (default).** Set `query`; the component fetches and renders. No-JavaScript fallback is author-supplied content rendered as the element's children, defaulting to a link to the corresponding MDN page.

**Data mode has two variants, both no-fetch, differing in how the payload arrives.**

The first is the `.data` property: set directly with a contract-conformant payload obtained at build time via `@bcd-embed/core` (Document 2 §7). This requires a script to run and assign the property, so it depends on a build step or a small hydration script executing before the element does anything useful.

The second, worth building because it removes that dependency, is an inline JSON island — a sibling `<script type="application/json">` carrying the payload, referenced by the element rather than assigned to it:

```html
<script type="application/json" id="bcd-data-css-properties-display">
  { "contract": "1.0.0", "query": "css.properties.display", ... }
</script>
<bcd-compat-table query="css.properties.display" source="bcd-data-css-properties-display"></bcd-compat-table>
```

`source` takes the `id` of a JSON script element anywhere in the document; the component reads and parses it in `connectedCallback`, synchronously — no fetch, no property assignment from any script. A static-site generator only has to emit two plain HTML fragments — the script tag and the element referencing it — a lower bar than requiring a hydration script to run and set a property in the right order. `id` naming is the author's responsibility; a documented convention (`bcd-data-{query-with-dots-as-dashes}`) avoids collisions across multiple tables per page without the component enforcing anything. Both `.data` and `source` are no-fetch, no-loading-state paths; `source` is the one requiring no script execution at all beyond the component's own.

**Server-side rendering of the markup — deferred, not v1.** Rendering the actual table HTML on the server (rather than just the data) would extend data mode's no-JavaScript story to cover markup as well, and Lit's SSR support makes it technically tractable. But it adds a real implementation and testing surface (Document 3 §9, §10) for a capability neither fetch mode nor the inline-JSON variant of data mode requires, and nothing in the project's stated goals (Document 0 §3) commits to it. It is left as a candidate future addition once the two v1 modes have shipped and are in use, rather than designed and built now on spec.

Fetch mode and both data-mode variants are one component with configurable data-flow, not three components, keeping the contract and documentation single.

---

## 8. Framework interoperability

React 19 handles custom elements correctly (non-primitive values as properties, primitives as attributes), so `.data` works without a wrapper. Older React versions do not handle this consistently; the props-vs-attributes distinction should be documented explicitly, since it affects `.data` directly.

A thin React wrapper is a plausible future addition, not a `v1` deliverable.

---

## 9. Testing

Vitest for unit/integration, Playwright for end-to-end, component, and visual regression. Test-driven throughout.

Rendering logic is tested against the golden fixtures from Document 2 Phase 1: given a fixture payload, verify the markup produced. This allows the component to be built and tested to completion before the service exists, proceeding in parallel with Document 2 and converging at integration.

Required non-happy-path fixtures: a feature with three parallel prefixed branches; a feature supported only behind a flag; a feature added, removed, and re-added; a support target absent from the payload versus present with `state: "unknown"` (covering at least one runtime, not only browsers); a 404 response; a malformed payload; a `source` reference to a missing element id; a `source` script containing invalid JSON; `query`, `.data`, and `source` all set at once, asserting the documented priority order (§4) is actually what runs.

Accessibility: automated auditing (axe) via Playwright on every state — loading, loaded, error, expanded, narrow container, wide container. Automated tooling covers a subset of what matters; manual verification with a screen reader is a release gate, particularly for header association and cell-naming (§5). Keyboard-only traversal of the full table, including the scroll region and every disclosure, is a scripted test.

Visual regression covers the support-state palette and container-query breakpoints. Contrast ratios are asserted in tests, not checked visually.

---

## 10. Implementation plan

**Phase 1 — semantic structure, statically.** Hand-write target table markup for a set of fixtures chosen for complexity, not familiarity, with no component code. Establish header association, cell naming, and disclosure structure; validate against a screen reader before any Lit code is written. This ordering is deliberate: the accessible structure is the load-bearing constraint and should not be retrofitted around a rendering approach chosen for other reasons.

**Phase 2 — element in data mode.** Lit element taking `.data`, producing the Phase 1 markup. No fetching. Fully testable against fixtures; completable before the service exists.

**Phase 3 — styling.** Base styles in the cascade layer, registered custom properties, container queries under Shared First, `light-dark()` for dark mode, print styles. Verify that un-layered author CSS overrides every base style, since this is the core assumption behind the light-DOM decision.

**Phase 4 — fetch mode.** Async task, loading/error states, request cache and deduplication, `IntersectionObserver` deferral and the `loading` attribute that controls it, `endpoint` override. Integrate against the live service.

**Phase 5 — interaction.** Disclosure, focus management, keyboard paths, reduced motion.

**Phase 6 — the `source` inline-JSON variant of data mode.** Reading and parsing the referenced `<script type="application/json">` in `connectedCallback` (§7), with the same rendering path as the `.data` property. No SSR, no hydration — this is still client-side parsing of an already-present payload, not markup rendered on the server.

**Phase 7 — documentation, demo site, and packaging verification.** Including a bundle-analyzer pass confirming the `sideEffects` configuration (§6) actually tree-shakes as intended and does not drop the custom element registration.

**Deferred, not scheduled as a v1 phase: full server-side rendering of the markup** (§7). Revisit once fetch mode and both data-mode variants have shipped and are in real use — building it now, ahead of that, is the scope creep the project should avoid locking in.

---

## 11. Design decisions settled during review

**Default support-target set — resolved: Chrome, Firefox, Safari, Node.js.** The API returns every browser and runtime BCD tracks, including Deno, Bun, Edge, Opera, and mobile variants; showing all of them by default would be noisy. Chrome, Firefox, and Safari are included because they map to the three independent rendering engines (Blink, Gecko, WebKit) — the actual signal a reader needs for "does this work everywhere" — not a popularity pick. Chromium-based browsers like Edge and Opera track Chrome's Blink closely enough that including them by default would mostly repeat the same answer.

Node.js is included alongside them, not treated as an opt-in extra: a large share of what this table renders is JavaScript API compatibility (`javascript.builtins.*`, `api.*`), and "does this run in Node" is a first-class question for that data, not a specialist one. Deno and Bun stay out of the default — a real but smaller audience — added via `browsers` (§4) without imposing the extra column on everyone else.

**"Flag means unsupported" convention — resolved: no.** Document 1 §6 leaves `behindFlag` orthogonal to `state` and defers the display decision to the consumer; the component now makes that call. Flag-gated support displays as its own distinct state rather than collapsing into unsupported, since collapsing it discards information a reader may specifically want (a technical writer covering an experimental feature, for instance, needs to know it exists behind a flag, not just that it's a flat "no"). A consumer wanting MDN's stricter convention can still compute `state === "supported" && !behindFlag` themselves (Document 1 §6); the component's own default does not make that choice for them.

**Element name — resolved: `<bcd-compat-table>`.** Not bikeshedded further; it is clear, matches the `bcd-embed` project naming, and is worth shipping over continuing to deliberate a permanent-but-not-consequential choice.
