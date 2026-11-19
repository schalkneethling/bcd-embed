# @bcd-embed/schema

Canonical schemas and TypeScript types for the bcd-embed API contract, plus the
published v1 golden fixtures (`@bcd-embed/schema/fixtures/v1`).

## Contract versions

`CONTRACT_VERSION` is the contract this code generates, and every response
schema accepts only that version. A bucket can still hold snapshots published
under an earlier v1 contract until they expire, so `storedMetaResponseSchema`
and `storedIndexResponseSchema` accept any version in
`STORED_CONTRACT_VERSIONS`. Only code that reads a bucket uses them: the server
and the publisher. Add a version to that list when you raise
`CONTRACT_VERSION`, and remove one once no retained snapshot can carry it.

## Source fragments are a frozen snapshot

`src/fixtures/source-fragments.json` holds raw `@mdn/browser-compat-data` (BCD)
fragments and one subtree (`javascript.builtins.Array`). They are a frozen
snapshot of BCD 8.1.3, and the file records that in its `source` field.

The snapshot does not follow the installed BCD. The normalized golden fixture and
its tests assert exact values from these fragments, so they must stay stable when
automatic dependency updates move the BCD pin. `tests/fixtures.test.ts` therefore
checks the snapshot's recorded source and internal consistency, not equality
with the installed package.

## Regenerating the snapshot

Regeneration is a deliberate manual step. It rewrites the file from whichever BCD
version is installed in this package's `devDependencies`:

```sh
pnpm --filter @bcd-embed/schema generate:fixtures
```

Afterwards, review the diff, update the expected version in
`tests/fixtures.test.ts` and `tests/utilities.test.ts`, and fix any fixture
assertions (for example, the Array subtree size) that changed with the data.
