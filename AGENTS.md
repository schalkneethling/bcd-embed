# Repository guidance

This project is a pnpm monorepo. Its architecture and implementation sequence
are documented in `docs/planning/`.

## Getting started

- Run `pnpm install` after pulling changes and before starting work.
- Use the package manager version declared in the root `package.json`.
- Run `pnpm check` before handing work back. It formats-checks, lints,
  type-checks, tests, and builds all implemented workspaces.
- Use `pnpm dev` for the documentation application.

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
- Do not add empty future workspaces. Add `core`, `generator`, `server`, and
  `element` when their implementation phases begin.
- Reimplement normalization from the published BCD schema. Do not copy code
  from MDN Fred, which is MPL-2.0 licensed.
- Keep transformation logic out of the component; the API answers what the
  support is, and consumers decide how it is shown.
