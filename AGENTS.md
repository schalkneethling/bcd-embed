# Repository guidance

This project is a pnpm monorepo. Its architecture and implementation sequence
are documented in `docs/planning/`.

## Getting started

- Run `pnpm install` after pulling changes and before starting work.
- Run `pnpm exec playwright install --only-shell chromium` once, and again when
  the Playwright version changes. `pnpm check` runs a Chromium Vitest project,
  which fails without the browser.
- Use the package manager version declared in the root `package.json`.
- Run `pnpm check` before handing work back. It formats-checks, lints,
  type-checks, tests, and builds all implemented workspaces.
- Use `pnpm dev` for the contract playground (`apps/docs`),
  `pnpm dev:website` for the documentation site (`apps/website`), and
  `pnpm dev:home` for the introduction page (`apps/home`).

## Tooling ownership

Calavera owns `.editorconfig`, `oxlint.json`, `.stylelintrc.json`, and the root
`tsconfig.json`. Its recipe is `calavera.config.json`, and its ownership state
is `.calavera/state.json`.

When changing shared linting, formatting, or TypeScript policy:

1. Update the Calavera recipe rather than hand-editing managed files.
2. Run `pnpm dlx create-project-calavera apply --dry-run` and inspect the result.
3. Apply the recipe only after the dry run is understood.
4. Run `pnpm check`.

Workspace-specific TypeScript files may extend the managed root configuration.

## Architecture guardrails

- Treat `@bcd-embed/schema` and its fixtures as the first product dependency.
- Do not add empty future workspaces. The `schema`, `core`, `generator`,
  `server`, `publisher`, and `element` packages and the `docs`, `website`,
  `home`, and `worker` apps already exist. `home` is the introduction page at
  `browser-compat.dev`.
- Reimplement normalization from the published BCD schema. Do not copy code
  from MDN Fred, which is MPL-2.0 licensed.
- Treat time and space complexity as design constraints because BCD is a very
  large dataset. Evaluate and document the Big O behavior of hot-path
  transformations, avoid repeated full-dataset scans and accidental quadratic
  work, and validate performance against realistically sized data.
- Keep transformation logic out of the component; the API answers what the
  support is, and consumers decide how it is shown.

## Publishing the component

- `packages/element` publishes to npm as `@schalkneethling/bcd-embed`, a beta
  under the `beta` dist-tag. Every other workspace keeps `"private": true`.
- A pull request that changes what a consumer of the component sees adds a
  changeset: run `pnpm exec changeset` and commit the file it writes.
- `.github/workflows/release.yml` stages releases on npm, and the owner
  approves them with two-factor authentication. Never run `npm publish`,
  `npm stage`, `npm trust`, `npm dist-tag`, or `npx fledgling` without
  `--dry-run`. `apps/website/src/content/docs/releasing.md` describes the flow.
- The published type declarations may import only relative files and the
  package's `dependencies`. The contract types the element exposes are plain
  copies in `packages/element/src/contract.ts`, checked against
  `@bcd-embed/schema` by `packages/element/tests/contract.test.ts`.
