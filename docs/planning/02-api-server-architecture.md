# Document 2 — API Server: Architecture and Implementation Plan

**Status:** Draft for review
**Depends on:** Document 1 (API Contract)

---

## 1. Architecture framing

This is a build pipeline that emits static files, not a server.

There is no database, no per-request computation, no user state, no write path, no authentication. The input is a single npm package — roughly 15 MB of JSON, published a few times a week — with a finite, enumerable key space known in advance. Every possible response can be precomputed and served as an immutable object from a CDN edge. MDN's own endpoint reflects the same conclusion: the path segment `current` is snapshot vocabulary, not query-engine vocabulary.

Consequences of this framing:

- Latency is a CDN read, globally, with no cold start and no origin in the hot path.
- Cost does not scale with traffic the way compute-per-request does.
- The abuse surface is minimal (Document 1 §10): no request-time work exists for an attacker to force.
- A broken generation degrades to stale data, not downtime — the previous snapshot keeps serving.
- Self-hosting is straightforward, which is the primary abuse mitigation (§7).

The cost of this approach is that freshness is bounded by generation cadence rather than being instantaneous. Given BCD's publish cadence (a few times a week), this is not material.

---

## 2. Monorepo layout

**Tooling, standardized across the monorepo.** Vite for building and bundling (the demo site's dev server, and each package's library build via `vite build --mode lib`), pnpm as the package manager (workspaces are the natural fit for the five-package layout below, and its content-addressed store keeps `node_modules` size sane across packages sharing dependencies like Zod and Vitest). Linting, formatting, and AI-tooling configuration are not hand-assembled per package; they are composed once via [Calavera](https://calavera.schalkneethling.com/) and applied at the repository root, so every package inherits the same recipe rather than accumulating its own drifted config over time. This is a monorepo-wide decision, not a per-package one, and it is made here rather than left to whoever sets up each package first.

The repository as currently scaffolded — a stock Vite+ starter using npm workspaces — is a temporary starting point and does not supersede this section: when implementation starts, layout and tooling follow this document, and the scaffold's Vite+-specific configuration is replaced rather than accumulated around.

```
bcd-embed/
├── packages/
│   ├── schema/        @bcd-embed/schema     Zod schemas (source of truth); JSON Schema + TS types derived
│   ├── core/          @bcd-embed/core       Normalization logic (pure, isomorphic)
│   ├── generator/     @bcd-embed/generator  BCD → static artifacts
│   ├── server/        @bcd-embed/server     Edge adapter (routing, errors, headers)
│   └── element/       @bcd-embed/element    The web component (Document 3)
├── apps/
│   └── docs/                                Demo site, playground, self-host guide
└── ...
```

**`schema`** — Zod schemas (Zod v4), authored once as the canonical source of truth for the Document 1 contract. TypeScript types are inferred directly from them via `z.infer`, with no separate codegen step and no risk of the types drifting from the schemas they describe. JSON Schema is derived from the same Zod schemas via Zod v4's built-in `z.toJSONSchema()` export, and is what gets published for non-TypeScript consumers who need to validate against the contract without depending on this package's JS. Depended on by both `core` and `element`, but differently. `core`, `generator`, and `server` run at build time or on the server, where Zod's size (on the order of 10 KB+ gzipped) is irrelevant and the alternative — maintaining schemas, TypeScript types, and validators as three hand-synchronized artifacts — costs far more than the library ever will. The `element` imports types only (`import type`, fully erased at compile time): Zod is roughly twice the size of Lit, the component's one accepted runtime dependency (Document 3 §2), and runtime schema validation in the browser does not earn that cost — the component treats a malformed payload as an error state (Document 3 §9), not a schema-validation report. Zero runtime dependencies beyond Zod itself.

**`core`** — the transformations: flattening the identifier tree, grouping parallel support branches, resolving version values, joining support-target releases (Document 1 §5.1 — browsers and runtimes alike), computing summary precedence. Pure, framework-free, isomorphic. Kept separate from `generator` so it is usable at build time by a consumer generating their own artifacts from the BCD npm package without running the hosted service.

**`generator`** — walks BCD, calls `core`, writes the static artifact tree. A Node CLI.

**`server`** — a thin edge adapter: route parsing, key validation, error bodies, cache headers, CORS. Minimal in the static deployment; does more in a self-hosted dynamic deployment.

**Licensing.** MIT. Checked against the project's actual dependencies: Lit is BSD-3-Clause, Zod (the `schema` package's sole dependency) is MIT, and `@mdn/browser-compat-data` itself is CC0 — none of these impose copyleft, so MIT is compatible throughout the stack. MDN's Fred code is MPL-2.0, file-level copyleft, and is not to be copied. The normalization logic is reimplemented from the published BCD schema, which is permitted since the schema and the described behavior are not the copyrighted artifact — the source files are. This should be a stated rule in `CONTRIBUTING.md`; incidental MPL contamination of `core` would impose copyleft on every downstream consumer, which MIT alone cannot undo.

**Releases.** Package publishing follows the `npm-publishing-best-practices` and `npm-trusted-publishing-github-workflow` skills from [Calavera](https://github.com/schalkneethling/create-project-calavera/tree/main/src/ai/skills): npm trusted publishing via a GitHub Actions workflow using OIDC — no long-lived npm tokens in CI — with provenance attestation. The packages version and release together (Document 0 §4).

---

## 3. Generation pipeline

**Ingest.** An exact, pinned version of `@mdn/browser-compat-data`, never a version range. The BCD version is a build input and appears in the output.

**Validate input.** Assert the BCD package matches the expected schema version before transforming. An unnoticed BCD schema change transformed as if unchanged produces plausible-looking incorrect data — the failure mode to guard against first.

**Transform.** For every key in the tree, produce a contract-conformant feature payload via `core`: flatten the subtree, group branches, resolve versions against release metadata, compute summaries. Alongside it, emit the corresponding raw artifact (Document 1 §4.5): the untouched BCD subtree for the same key, no transformation applied. Same addressability rule as the normalized artifact (defined below) — one raw file per node that carries `__compat` at its own key, not per node that merely has a descendant that does.

BCD keys are hierarchical: a query for `css.properties.display` must return that feature and everything nested beneath it, so generation is not one file per leaf. **Addressability rule, decided:** a node is independently addressable if and only if it carries a `__compat` object at that exact key — not because it has a descendant that does. `css.properties.display` is addressable because it carries `__compat` itself; `css.properties` and bare `css` are not, regardless of how many `__compat`-bearing descendants sit beneath them. The generator emits one file per addressable node, each containing its own flattened subtree (the node and everything nested beneath it, which may itself include further addressable descendants like `javascript.builtins.Array.prototype.map`). This produces redundancy across files, which is intentional — it makes every request a single read with no client-side assembly. Compression absorbs most of the storage cost.

Querying a non-addressable key (`css`, `css.properties`, any organizational namespace with no `__compat` of its own) returns `namespace_not_queryable` (§8) rather than a generated file. No rule would ever make such a query succeed, so this isn't a size cap on a valid request — it's a category the API was never going to serve. A consumer wanting everything under a namespace uses the index (§4.3) to discover the addressable keys beneath it, then queries them individually or aggregates at build time — consistent with not offering batch or query-language endpoints (Document 0 §3).

By construction, no consumer ever needs to join data across files: whatever key is queried, that file already contains the full flattened subtree beneath it. A query for `javascript.builtins.Array` is self-contained — it returns `Array` plus every nested static and prototype method in one file — and so is a query for a single leaf like `javascript.builtins.Array.prototype.map`. A consumer fetching two feature files and stitching them together would indicate the generator failed to make some node addressable, not an intended pattern.

What this trades away, instead, is uniform payload size: a large subtree like `Array` produces one large file rather than several small ones, since splitting it would reintroduce the client-side joining this architecture avoids. Compression mitigates this genuinely, not just nominally (Document 1 §9): Brotli — supported natively at Cloudflare's edge (§4) and materially better than gzip here — compresses this shape of data well, since a large subtree repeats a small vocabulary of field names and values (`versionAdded`, `partialImplementation`, browser identifiers) across many entries. But it reduces transfer size only, not parse or memory cost — the file still has to be downloaded, decompressed, and held as JSON — so it narrows the concern without eliminating the need to measure it. Same root cause as the bare-namespace problem in §10, at smaller scale: `Array` has dozens of members, not thousands, and likely doesn't need the same treatment, but both should be checked once real payload sizes are measured (Phase 3, §9).

**Validate output.** Every emitted normalized artifact is validated by parsing it through the `schema` Zod schemas directly (`.parse()`, not `.safeParse()` — a failure here should throw and stop the build, not be swallowed). This is the same schema definition used to infer the TypeScript types and derive the published JSON Schema (§2), so there is exactly one place this validation logic can go wrong, not two definitions that could quietly disagree. A generation producing one non-conformant file fails the whole build.

Raw artifacts are a different case: validated against BCD's own published JSON Schema, which we don't author and have no reason to reimplement in Zod. That validation uses Ajv (compiled validators, not interpreted, given the ~30,000-artifact volume per generation) — the one place in this pipeline where Ajv remains the right tool, because the schema belongs to someone else. Raw artifacts carry no contract guarantee (Document 1 §4.5) and are not checked against `schema`.

**Emit.** Write the artifact tree, index shards, support-target metadata, and `meta.json`.

**Publish atomically.** Write the new snapshot to its immutable path, verify it, then repoint the `current` alias. A partially-written `current` must be impossible. This ordering is what makes a failed generation degrade to staleness rather than a broken endpoint.

Snapshot identifiers encode the BCD version and the generator version (`bcd-7.1.3-gen-1.2.0`, Document 1 §7), because the output is a function of both: a `core` or `generator` fix regenerates from the same BCD release and must land at a new path, not overwrite an immutable one. As a guard against anything else varying the output without a version bump, the publish step refuses to write to a snapshot path that already exists with different content — an identical re-run is idempotent, a differing one fails the build.

### Artifact tree

```
/v1/meta.json
/v1/current/                    → alias to the newest snapshot
/v1/bcd-7.1.3-gen-1.2.0/
    ├── features/
    │   ├── css.properties.display.json
    │   ├── api.AbortController.json
    │   └── ...  (~15k files)
    ├── raw/
    │   ├── css.properties.display.json
    │   ├── api.AbortController.json
    │   └── ...  (~15k files, untouched BCD subtrees)
    ├── browsers.json
    ├── index.json
    └── index/
        ├── css.json
        ├── api.json
        └── ...
```

The dotted key is used directly as the filename rather than mapping dots to directories, so the key-to-path mapping is trivially auditable — relevant since path traversal is the one real input-validation risk (§6).

### Snapshot retention

Snapshots are retained for a bounded rolling window, not indefinitely. Recommended default: the most recent 90 days, pruned by a scheduled cleanup job that runs alongside the freshness pipeline in §5.

This is a deliberate departure from "keep everything": this project's value is in serving accurate, current data, not archiving historical browser support. A consumer wanting to know what support looked like six months ago has no real reason to prefer this service over reading `@mdn/browser-compat-data`'s own git history, which already does that job properly. Retaining snapshots indefinitely would mean carrying storage and operational surface for a use case (historical/archival lookup) that is explicitly not a goal of this project (Document 0 §3).

What the bounded window is actually for is short-to-medium-term build stability, not archival: a consumer's CI pipeline pinning to a specific snapshot so a given deploy is reproducible for the length of a release cycle, or a staged rollout that needs the data to hold still for a few weeks while it validates. Ninety days comfortably covers that. It does not, and is not meant to, support someone rebuilding a years-old pinned reference.

Requesting a snapshot outside the retention window returns the existing `snapshot_not_found` error (§8) — the "or has been retired" case in that error's definition is precisely this, and needs no new mechanism. `current` is unaffected either way: it is an alias, not a retained object, and always points at the newest snapshot regardless of the window.

The 90-day figure is a starting recommendation, not a hard constraint — it can be tuned once real usage patterns (how long consumers actually stay pinned before re-pinning) are observed.

---

## 4. Hosting

**Target: Cloudflare — R2 for artifacts, Workers for the adapter.**

R2 has no egress fees, which matters directly given the cost model is bandwidth and success means being embedded on many third-party sites. A traffic spike on a metered host is a bill; on R2 it is not. The Worker validates keys, maps key to object, sets cache and CORS headers, and constructs JSON error bodies. Cloudflare's cache absorbs most requests, so the Worker itself runs rarely, and rate limiting is available at the edge with no added infrastructure.

On a miss — the mapped object does not exist — the Worker distinguishes the two 404 cases using the snapshot's own index shards (Document 1 §4.3), which exist regardless: fetch the shard for the key's top-level namespace and check whether the key is absent from it (`feature_not_found`) or is a dot-boundary prefix of entries in it (`namespace_not_queryable`); a top-level segment that is not a shard at all resolves against the shard list in `meta.json`. This costs one extra R2 read on misses only, and the 404 it produces is itself cacheable (Document 1 §9), so each unique bad key does this work once. No dedicated manifest artifact is needed.

This is the only hosted target for the project's own deployment. `server` is still written against a minimal adapter interface, not because another host is under consideration for us, but because self-hosting (§7) needs to remain viable on whatever infrastructure a self-hoster already runs — plain nginx serving the static tree, another CDN, or a different edge platform entirely. That is their choice to make, not a decision this document needs to make on their behalf.

---

## 5. Data freshness

This mechanism is what makes the table a live view rather than a static copy, so it is specified explicitly.

Dependabot watches `@mdn/browser-compat-data` and opens a pull request on a new release — the project's source lives on GitHub, and Dependabot's native integration is a better fit here than a third-party bot, given nothing in this pipeline needs Renovate's cross-platform support, custom scheduling, or grouping. CI runs the generator against the new version and diffs the generated *output* against the current snapshot — not the input. A BCD release producing no change in the emitted contract needs no action; a release changing an unexpectedly large number of features signals a likely upstream problem and should block rather than deploy.

Pipeline gates: schema validation of the input, schema validation of every output artifact, and a sanity check on the magnitude and shape of the output diff. On green: generation, atomic publish to a new immutable snapshot, alias flip. A scheduled job runs the same pipeline as a backstop in case a release is missed.

Two operational specifics are decided here rather than discovered later. First, the Dependabot bump PR auto-merges when every gate is green: freshness must not depend on a maintainer being available to click merge, or "live data" quietly degrades into "data as fresh as the maintainer's week." Second, a blocked gate is a notification, not a log line. Sentry is the error-tracking and alerting mechanism throughout — the generation pipeline reports failures and blocked gates to it, and the Worker reports runtime errors. The pipeline silently stopping while the service keeps serving aging data is precisely the failure this project exists to prevent, so "it stopped and nobody noticed" has to be impossible by construction, not merely unlikely by habit.

The output diff is also a reusable artifact in its own right — a machine-readable record of what changed in browser and runtime support over a given period. Out of scope here; noted as a candidate for later.

---

## 6. Security

Document 1 §10 establishes that the abuse surface is small. In implementation terms:

**Key validation is the primary control.** The key from the URL is validated against `^[A-Za-z0-9][A-Za-z0-9._-]*$` and length-bounded before being used to construct an object path — no `..`, no slashes, no encoded traversal. This is the single highest-value test in the repository and should be fuzzed, not only unit-tested.

**Cross-origin access is intentionally unrestricted.** `access-control-allow-origin: *` is correct: the data is CC0 and identical for every caller, and restricting origins would prevent the component from working at all.

**Rate limiting is bandwidth protection, not access control.** Per-IP, generous, at the edge. Should not be tight enough to break a documentation page with fifty tables.

**No dynamic query evaluation.** A query language, filter expression, or batch body would reintroduce request-time compute and a denial-of-service vector. Document 1 declines a batch endpoint for this reason; this is a constraint to maintain, not a gap to close later.

Additional controls: strict `content-type`, no reflection of caller input into HTML (there is no HTML in this service), dependency pinning with automated auditing. This is the full extent of the required security work.

---

## 7. Self-hosting

Self-hosting is a first-class deployment path: it is the mechanism that keeps the hosted service a convenience rather than a dependency, and the primary mitigation against sustained abuse of the hosted origin.

Three supported paths, in increasing order of independence:

1. Point the component at the hosted service. Default; requires no setup.
2. Run the generator, publish the artifact tree to a self-hosted CDN, point the component at it via a single attribute. Recommended for consumers with substantial traffic.
3. Skip the service entirely: consume `@bcd-embed/core` against the BCD npm package at build time, and pass the resulting data to the component as a property. This produces a fully static, zero-runtime-fetch deployment, and is the reason `core` is a separate package from `generator`.

Required deliverables: a documented one-command generation step, a deployment recipe for at least Cloudflare and one generic static host, and an explicit statement that the hosted endpoint is a convenience, not a dependency.

---

## 8. Testing

Vitest throughout. Test-driven development. The default assumption for every piece of this pipeline is that the happy path is the easy 20% and the failure modes are the point — a generator that produces correct output for well-formed input but fails silently or ambiguously on the messy cases is not done. Coverage below is organized by failure category rather than by package, because that is where completeness actually gets checked or missed.

**Transformation correctness (`core`).** The highest-priority surface, because an error here produces confidently wrong output rather than a crash — the worst failure mode this project has, argued in Document 0 §7. Branch grouping needs adversarial fixtures specifically: features with `-webkit-` and `-moz-` and unprefixed implementations interleaved; features where the prefixed implementation predates the unprefixed one; features with support added, removed, and re-added; a feature with three or more parallel branches at once. Each of these exists in real BCD data and produces an incorrect timeline if grouped naively. The `state` enum (Document 1 §6) needs a fixture for every one of its five conditions individually, plus at least one fixture per pair of conditions that could plausibly be confused (e.g. `partial` vs. `preview` when both apply). Coverage is not considered complete until every branch of the summary-selection precedence (Document 1 §6) has a fixture that specifically exercises it, not just a fixture that happens to pass through it.

**Malformed and edge-case BCD input.** Not just well-formed data with awkward shapes — genuinely malformed input, since BCD is community-edited and errors do land in it. A feature with an empty support array. A feature where every browser entry is `null`. A `version_added` that is an unexpected type. A feature with `notes` but no other modifier. A feature with no `__compat` at any level of a subtree (must be excluded from generation entirely, not generate an empty file). Each of these should be checked against the pipeline's `invalid_key` / build-failure boundary — a malformed feature is a different failure mode from a malformed *key*, and both need to fail loudly rather than being silently skipped or half-processed.

**Pipeline behavior under failure, not just under success.** Every gate described in §5 needs a test that actually forces the gate to fire: a BCD input that fails schema validation (does the build actually stop, or does it warn and continue?); a generation that produces one non-conformant output artifact (does one bad file fail the whole build, as §3 requires, or only log a warning?); an output diff that exceeds the magnitude threshold (does it block, and is the block visible to a human rather than silently retried?); a publish that is interrupted mid-write (does the atomic-publish ordering in §3 actually prevent a half-written `current`, under a simulated crash, not just in the logic on paper?).

**Every documented error response, exercised deliberately.** Document 1 §8 defines six error codes. Each needs a test that provokes that specific code and asserts the exact shape of the response, not just the HTTP status: `invalid_key` from a genuinely malformed key (including path-traversal attempts, §6); `feature_not_found` from a well-formed key with no data; `namespace_not_queryable` from both a bare top-level namespace (`css`) and a mid-tree organizational node (`css.properties`), exercising the Worker's index-shard resolution path that distinguishes it from `feature_not_found` (§4); `snapshot_not_found` for both a snapshot that never existed and one that has aged out of the retention window (§3) — these are different code paths and both need coverage; `rate_limited` under actual rate-limit pressure in a deployed environment, not only unit-tested in isolation; `generation_in_progress`, which only applies to self-hosted dynamic deployments and is easy to leave untested precisely because the primary deployment never exercises it.

**Schema conformance at volume, not on a sample.** Property-based tests asserting every emitted normalized artifact parses successfully against the `schema` Zod definitions (§3), and every raw artifact validates against BCD's own published JSON Schema via the same Ajv validators used in generation — both run against the full BCD tree, all ~30,000 artifacts of each kind, rather than a representative subset. A sample can pass while a real, rare shape elsewhere in the tree fails; at this volume, running the full tree is not expensive enough to justify sampling instead.

**Adversarial input to the parts that face the public.** Fuzzing of key validation specifically (§6), since it is the one required input-validation control and the one place a subtle regex mistake becomes a path-traversal vector rather than a cosmetic bug.

**Fixtures chosen for complexity, not familiarity.** Golden-file snapshots for features selected because they are hard to get right, not because they are commonly reached for: a heavily prefixed CSS property, a feature with flags across multiple support targets — including at least one runtime, not only browsers — a feature marked removed. Separately, at least one large-data-set fixture — the `Array`-scale large-subtree case from §3 — covers payload size specifically, which is a different concern from structural complexity and needs its own coverage rather than being assumed to follow from it. Trivial features like `css.properties.display` are not useful test cases on their own; they pass regardless of correctness and should not be mistaken for coverage.

**Making "complete" a checkable claim, not an aspiration.** Line coverage on `core` is a weak signal on its own — it is easy to execute the branch-grouping code without a fixture that would catch it being wrong. Mutation testing on `core` specifically (deliberately breaking the precedence order, the grouping key, or a boundary condition in the `state` enum, and confirming the test suite fails) is the more honest check that the adversarial fixtures above are actually doing their job, not merely executing the code they claim to cover.

---

## 9. Implementation plan

**Phase 1 — contract and fixtures.** Author `schema` as Zod schemas (Zod v4): the canonical definition, from which TypeScript types are inferred and JSON Schema is derived via `z.toJSONSchema()`. Hand-write golden fixtures before any transformation code exists, so they encode intended output rather than whatever the code happens to produce. This phase unblocks Document 3 to proceed in parallel and should not be rushed.

**Phase 2 — `core`.** Test-driven against the Phase 1 fixtures. Flattening, branch grouping, version resolution, support-target release joining, summary precedence. No I/O, no dependencies beyond BCD's types.

**Phase 3 — `generator`.** Walk, transform, validate, emit. Run against the full BCD tree; validate every artifact. Measure output size to inform caching and index-sharding decisions.

**Phase 4 — `server` and deployment.** Worker, key validation, error bodies, cache headers. Deploy a snapshot. Fuzz the validator against the live deployment.

**Phase 5 — freshness.** Dependabot, the output-diff gate, atomic publish, alias flip. Validate end to end against a real BCD update.

**Phase 6 — self-hosting.** Documentation and deployment recipes, verified by following them.

The component's critical-path dependency is Phase 1 only. Once the schema and fixtures exist, Document 3's work proceeds against fixture files with no service running, converging with this track at integration.

---

## 10. Open questions

**Artifact count.** Roughly 30,000 objects (normalized plus raw artifacts, §3) is well within R2's limits. No longer a concern for the primary deployment; would need rechecking only if a self-hoster's chosen platform (§7) has a lower ceiling.

**Behavior for non-addressable intermediate nodes and large addressable ones.** Resolved for the non-addressable case: a node is addressable only if it carries `__compat` at its own key, never by virtue of a descendant carrying one (§3). A bare namespace like `css` is never generated and returns `namespace_not_queryable` (Document 1 §8). Still open: whether a large but legitimately addressable subtree (e.g. `javascript.builtins.Array`, which does carry `__compat` at its own key) needs its own size cap. That threshold, if one is needed, can only be set once Phase 3 (§9) measures real payload sizes — `Array`'s subtree is modest by comparison to a namespace like `css` (dozens of members, not thousands), so it may not need special treatment at all.

**Index size.** Unmeasured until Phase 3. May force the namespace-sharding decision, or make it unnecessary.
