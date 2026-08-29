# bcd-embed

Embeddable browser compatibility tables backed by live
[`@mdn/browser-compat-data`](https://github.com/mdn/browser-compat-data).

The project is currently establishing its v1 contract and implementation
foundation. The design and sequencing decisions live in
[`docs/planning`](./docs/planning/).

## Repository layout

The monorepo keeps the contract, normalization pipeline, static artifact
generator, edge adapter, and web component versioned together. The implemented
workspaces are:

- `packages/schema` — `@bcd-embed/schema`, the canonical Zod schemas, inferred
  TypeScript types, and derived JSON Schema.
- `packages/core` — `@bcd-embed/core`, the pure BCD subtree normalizer.
- `apps/docs` — the documentation, examples, and playground application.

The `generator`, `server`, and `element` packages will be added when their
implementation phases begin.

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
from `@mdn/browser-compat-data@8.0.13`. Run
`pnpm --filter @bcd-embed/schema generate:fixtures` after intentionally changing
the pinned source corpus; tests reject stale extracted data.

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
pnpm dev          # Run the documentation app
pnpm format       # Format the repository
pnpm lint         # Run JavaScript/TypeScript and CSS linting
pnpm typecheck    # Type-check every implemented workspace
pnpm test         # Run the test suite
pnpm build        # Build every implemented workspace
```

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
