# Document 0 — Project Brief

**Name:** `bcd-embed`
**Status:** Draft for review
**Companion documents:** 01 API Contract · 02 API Server Architecture · 03 Web Component Architecture

---

## 1. Problem

MDN Web Docs renders a browser compatibility table on every page about a web platform feature. The table has no embeddable counterpart. A writer covering a feature elsewhere — a blog post, a talk, a course, a book — has two options: a screenshot, which is inaccurate the day support next changes, or a copied HTML snippet, which goes stale with no signal to the reader that it has.

`bcd-embed` provides an embeddable compatibility table backed by live data. An author embeds it once; it reflects current support without further maintenance.

---

## 2. Prior art and current gap

**`@mdn/browser-compat-data` (BCD).** The canonical compatibility dataset. Published several times a week, CC0-licensed, with a published JSON Schema. Distributed as an npm package for build-time consumption. No hosted query API is part of the published product.

**`<baseline-status>`.** A web component published by the W3C WebDX Community Group. Fetches live from `api.webstatus.dev`, backed by the `web-features` dataset. Reports a tri-state (Limited / Newly / Widely available) per feature. Does not report per-browser, per-version support.

**`bcd.developer.mozilla.org/bcd/api/v0/...`.** A hosted JSON endpoint that MDN's own front end (`mdn/fred`) calls to render its compat table. Returns compatibility data joined with browser release metadata. Served with `access-control-allow-origin: *`, so it is technically callable from any origin. It is unversioned and undocumented, with no published stability guarantee. Suitable for prototyping; not suitable as a dependency.

**CanIUse Embed.** The current option for an embeddable, live compatibility table. A reasonable choice for many use cases. Its presentation and data source are not under the embedding author's control.

**Gap.** No published, versioned, embeddable component renders per-version compatibility data from a stable, documented, live API. `bcd-embed` fills this gap.

---

## 3. Goals

- Render browser compatibility data at the same granularity as MDN's table (per support target — browser or runtime, Document 1 §5.1 — per version, with flags/prefixes/partial-support modifiers), not the coarser Baseline tri-state.
- Serve that data from a versioned, documented, publicly accessible API.
- Make the API optional: the component must also work from build-time data with no network dependency.
- Make the hosted API replaceable: the generator, contract, and normalization logic are published so anyone can self-host an equivalent service.
- Treat accessibility as a first-class design constraint, not a remediation pass.
- Give the embedding author full control over presentation.

### Non-goals

- Not a replacement for MDN's documentation or table.
- Not a competitor to `<baseline-status>`; the two answer different questions and can be used together.
- No hosted version of the component itself. Only the API is hosted; the component is always installed and served by the consumer.
- No query language, search endpoint, or batch endpoint in v1. The API surface is a fixed, enumerable set of static resources (Document 1, Document 2 §6).
- Not an archival or historical-lookup service. This project's value is accurate, current data; historical lookups are already served by `@mdn/browser-compat-data`'s own git history, and duplicating that is out of scope. This shapes the bounded snapshot retention window in Document 2 §3.

---

## 4. Product shape

Three artifacts.

**Repository structure.** All three are developed in a single monorepo, versioned and released together — keeping the contract in sync with both consumers as the project evolves. Layout and the standardized toolchain (Vite, pnpm, Calavera for lint/format/AI-tooling configuration) are specified in Document 2 §2.

**Contract.** Zod schemas (Zod v4), authored once as the canonical source of truth and published as their own package; TypeScript types are inferred directly from them and JSON Schema is derived from them for non-TypeScript consumers (Document 2 §2). Defines the response shape both other artifacts depend on. Specified in Document 1.

**API.** Generates contract-conformant JSON from BCD and serves it as static files from a CDN edge, with no database and no per-request computation. Specified in Document 2.

**Component.** A Lit custom element that renders the contract's JSON as an accessible HTML table. Uses light DOM by default. Can consume the hosted API, a self-hosted copy of it, or build-time data with no fetch at all — three supported paths, none mandatory. Specified in Document 3.

---

## 5. Design principles

**The contract is the primary deliverable.** Both other artifacts depend on it and neither owns it. It is what allows a third party to build an alternative renderer against our API, or an alternative API under our component.

**A transformation must never make data less correct or more ambiguous.** This is the rule that decides what the API computes and what it leaves to the consumer (Document 1 §2). It requires computing branch-grouping, support-target release joins, and version normalization, because omitting them invites incorrect rendering. It forbids collapsing a real distinction into a single opinionated value — for example, folding "supported behind a flag" into "unsupported" — because that discards information a consumer may legitimately need.

**Reference MDN's implementation; do not reuse its code.** `mdn/fred`'s compat components (`compat-section`, `compat-table-lazy`, `compat-table`) are the best available reference for the harder logic: branch grouping, support precedence, feature flattening. They are MPL-2.0 (file-level copyleft) and coupled to MDN's internal infrastructure. `bcd-embed` reimplements this logic from the published BCD schema rather than porting the code.

**Web platform first.** Semantic HTML, native table elements, ARIA only where native semantics are insufficient, plain CSS the consuming author can override. Lit is the one dependency accepted in the component, justified in Document 3 §2.

**Self-hosting is a supported deployment path, not a fallback.** The generator, the contract, and the normalization core are published so the hosted API is a convenience rather than a requirement.

---

## 6. References

| | |
|---|---|
| MDN's rendering implementation | [`compat-section`](https://github.com/mdn/fred/tree/main/components/compat-section), [`compat-table-lazy`](https://github.com/mdn/fred/tree/main/components/compat-table-lazy), [`compat-table`](https://github.com/mdn/fred/tree/main/components/compat-table) — MPL-2.0. Domain logic is concentrated in `compat-table`'s `utils.js` and `feature-row.js`. |
| BCD data and schema | [`mdn/browser-compat-data`](https://github.com/mdn/browser-compat-data), [package contents](https://github.com/mdn/browser-compat-data#package-contents), [schemas](https://github.com/mdn/browser-compat-data/blob/main/schemas) — CC0. |
| MDN's hosted endpoint | `https://bcd.developer.mozilla.org/bcd/api/v0/current/{query}.json`. Reference only; unversioned, undocumented, no stability guarantee. |
| Baseline component and API | [`<baseline-status>`](https://github.com/web-platform-dx), [Web Platform Status API](https://api.webstatus.dev), `web-features` dataset. Coarser granularity; complementary, not competing. |
| Embeddable alternative | CanIUse Embed. Current best option for consumers who do not need per-version data or full presentational control. |

---

## 7. Principal risks

**Branch-grouping and support-precedence logic.** BCD support arrays interleave parallel implementations (unprefixed, `-webkit-`, alternative names) and can include multiple add/remove cycles. Naive rendering of these arrays produces chronologically incorrect tables. This logic is the most likely source of subtle, hard-to-detect bugs.

Mitigation: strict TDD (red/green) against hand-written fixtures, written before the transformation code. MDN's existing rendering serves as a reference implementation for expected output, making fixture derivation more reliable here than it typically is.

**Accessible table structure.** The data is multi-dimensional (feature × support target [browser or runtime] × version × modifier); compressing it into a two-dimensional grid is where accessibility failures typically originate, and they are not fixable after the fact. Mitigation: the first implementation pass is scoped to semantic structure and accessibility-tree exposure only — header association, per-cell accessible names, disclosure semantics — validated against a screen reader before any visual design work begins. Styling in that pass is limited to readability; the design system is a later, separate phase (Document 3 §10, Phase 1–3).

**Scope creep toward a general-purpose data API.** Search, batch queries, and a query language are each individually reasonable additions and collectively would reintroduce request-time computation, undermining the static-serving architecture in Document 2. v1 scope is fixed; these are deferred, not rejected outright. Baseline status is a separate case and is excluded outright rather than deferred: it belongs to a different dataset (`web-features`) with different granularity and governance, and is only reconsidered if that data becomes part of BCD itself (Document 1 §3).

---

## 8. Sequencing

The contract and its fixtures (Document 1, Document 2 Phase 1) are the only hard dependency. Once they exist, the API and the component are built in parallel — the component tested entirely against fixture files, with no API running — and converge at integration. Sequencing within each artifact is defined in its own document.

Resolved since the last draft: behavior for a query against a bare BCD namespace (e.g. `css`), which has no `__compat` of its own but has thousands of descendants. A node is addressable only if it carries `__compat` at its own key, never because a descendant does; querying a bare namespace returns a dedicated error (`namespace_not_queryable`, Document 1 §8) rather than an unusably large payload (Document 2 §3). Still open: whether a large but legitimately addressable subtree — one that does carry `__compat` at its own key, such as `javascript.builtins.Array` — needs its own size cap once real payload sizes are measured (Document 2 §10).
