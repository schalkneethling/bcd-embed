# bcd-embed

Embeddable browser compatibility tables backed by live
[`@mdn/browser-compat-data`](https://github.com/mdn/browser-compat-data).

The data pipeline is built and lives on `main`: a contract, a normalizer, a
static artifact generator, a read-only HTTP handler, a Cloudflare Worker adapter,
a private publisher, and the freshness workflows that keep it current with new
BCD releases. Nothing is deployed yet, so no public endpoint exists. The web
component (`packages/element`) has not been started. The design and sequencing
decisions live in [`docs/planning`](./docs/planning/).

## Repository layout

The monorepo keeps the contract, normalization pipeline, static artifact
generator, edge adapter, and web component versioned together. The implemented
workspaces are:

- `packages/schema` — `@bcd-embed/schema`, the canonical Zod schemas, inferred
  TypeScript types, and derived JSON Schema.
- `packages/core` — `@bcd-embed/core`, the pure BCD subtree normalizer.
- `packages/generator` — `@bcd-embed/generator`, which validates the pinned BCD
  data, normalizes every addressable feature with `core`, and writes the static
  JSON artifacts (plus gzip and Brotli variants) to a local directory. It also
  ships a tool that compares two generated trees.
- `packages/server` — `@bcd-embed/server`, a portable, read-only Fetch handler
  that answers API requests from generated artifacts through a small storage
  interface.
- `packages/publisher` — `@bcd-embed/publisher`, a private Node tool that checks
  a candidate artifact tree against a baseline and, only when an operator
  explicitly opts in, uploads it to an R2 bucket and switches the current
  snapshot.
- `apps/worker` — `@bcd-embed/worker`, the Cloudflare Worker that runs the
  server handler against an R2 bucket binding and adds edge caching and error
  reporting. It is tested locally and has not been deployed.
- `apps/docs` — the documentation, examples, and playground application.

The `element` package, the web component, will be added when its implementation
phase begins.

Each package and app has its own README with the details of its behavior.

## Automation

Three GitHub Actions workflows live in `.github/workflows/`, and the scripts they
call live in `scripts/`:

- `ci.yml` runs `pnpm check`, a generation check at full BCD volume, and the
  `core` mutation gate on every pull request and push to `main`.
- `freshness.yml` handles Dependabot pull requests that update
  `@mdn/browser-compat-data`. It generates artifacts from both the base and the
  candidate, and fails the pull request when the output diff crosses the reviewed
  limits. Auto-merge is off unless an operator turns it on with a repository
  variable.
- `freshness-backstop.yml` runs on pushes to `main`, weekly, and on manual
  dispatch. It validates `main` and preserves a candidate artifact tree.
  Publishing to R2 only happens on a manual dispatch with `publish` set, behind a
  protected environment and an exact-hash approval, so no automatic publication
  is configured.

The design behind these is in
[`docs/planning/06-phase5-freshness.md`](./docs/planning/06-phase5-freshness.md).

## Planning documents

The design documents in [`docs/planning`](./docs/planning/) are:

- [`00-project-brief.md`](./docs/planning/00-project-brief.md) — the problem,
  goals, and scope.
- [`01-api-contract.md`](./docs/planning/01-api-contract.md) — the v1 API
  contract.
- [`02-api-server-architecture.md`](./docs/planning/02-api-server-architecture.md)
  — the static-serving architecture and the implementation phases.
- [`03-web-component-architecture.md`](./docs/planning/03-web-component-architecture.md)
  — the design of the web component, which is not built yet.

The validation records for the finished phases are:

- [`04-phase3-generator-validation.md`](./docs/planning/04-phase3-generator-validation.md)
  — generator validation and measurements.
- [`05-phase4-server-validation.md`](./docs/planning/05-phase4-server-validation.md)
  — server and endpoint verification.
- [`06-phase5-representations.md`](./docs/planning/06-phase5-representations.md)
  — compressed representations and the artifact manifest.
- [`06-phase5-output-diff.md`](./docs/planning/06-phase5-output-diff.md) — the
  semantic output-diff gate.
- [`06-phase5-freshness.md`](./docs/planning/06-phase5-freshness.md) — freshness
  workflows, publication checkpoint, and observability.

## Contract package

`@bcd-embed/schema` exports the canonical Zod schemas and inferred TypeScript
types from its package root. Standalone JSON Schema Draft 2020-12 documents are
published at these subpaths:

- `@bcd-embed/schema/json-schema/feature-response`
- `@bcd-embed/schema/json-schema/browsers-response`
- `@bcd-embed/schema/json-schema/index-response`
- `@bcd-embed/schema/json-schema/meta-response`
- `@bcd-embed/schema/json-schema/api-error-response`

Regenerate the committed documents with
`pnpm --filter @bcd-embed/schema generate:json-schema`. Package tests fail when
the committed documents differ from the canonical Zod definitions. JSON Schema
validates the portable structural contract; relational invariants that JSON
Schema cannot express, such as summary projection and response-wide target
coverage, are documented in the schema `$comment` and enforced by Zod.

The `@bcd-embed/schema/fixtures/v1` subpath publishes the adversarial normalized
golden response, its named-case catalog, and exact source fragments extracted
from `@mdn/browser-compat-data@8.1.3`. These fragments are a frozen snapshot:
automatic BCD updates do not change them, and tests check the snapshot against
its own recorded source rather than the installed BCD. See the
[schema README](packages/schema/README.md) to regenerate them deliberately.

## Core package

`@bcd-embed/core` exports `normalizeFeatureSubtree`, the framework-free,
side-effect-free transform from one addressable BCD subtree plus BCD browser
metadata to normalized `features` and the exact referenced support-target
metadata. It performs no I/O and does not add timestamps, source identity, or a
response envelope; those remain generator responsibilities. Normalization
failures throw `BcdNormalizationError` with the failing BCD key.

## Development

Requirements:

- Node.js 22.18 or newer
- pnpm 11.24.0, managed through Corepack

Install dependencies and run the complete repository check:

```sh
corepack enable
pnpm install
pnpm check
```

Useful commands:

```sh
pnpm dev              # Run the contract playground
pnpm fixtures:report  # Summarize the v1 golden fixture corpus
pnpm format           # Format the repository
pnpm lint             # Run JavaScript/TypeScript and CSS linting
pnpm typecheck        # Type-check every implemented workspace
pnpm test             # Run the test suite
pnpm build            # Build every implemented workspace
```

Validate a normalized response from a file with both the canonical Zod schema
and the corresponding published JSON Schema:

```sh
pnpm schema:validate --kind feature-response response.json
```

The accepted kinds are `feature-response`, `browsers-response`,
`index-response`, `meta-response`, and `api-error-response`. Use `-` or omit the
file to read JSON from standard input. The fixture report also supports
`--json` for machine-readable output.

## Tooling

[Calavera](https://calavera.schalkneethling.com/) owns the shared formatting,
linting, and TypeScript policy. Its repeatable recipe is stored in
`calavera.config.json`. Preview a tooling update before applying it:

```sh
pnpm dlx create-project-calavera apply --dry-run
pnpm dlx create-project-calavera apply
```

Package and application builds use Vite; tests use Vitest.

## License

[MIT](./LICENSE)
