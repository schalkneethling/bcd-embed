# `@bcd-embed/element`

The `<bcd-compat-table>` web component (`docs/planning/03-web-component-architecture.md`). The
component class does not exist yet. The package currently holds the build, the message table, the
public types, and the screen reader tests for the Phase 1 static markup in
`docs/planning/phase1-markup/`.

## Layout

| Path                                       | Holds                                                                                         |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `src/index.ts`                             | The package entry. Everything the package exports passes through it.                          |
| `src/strings/en.ts`                        | The English message table, keyed by message id, with `{placeholders}`.                        |
| `src/strings/format.ts`                    | `formatMessage`, `MissingPlaceholderError`, and `selectStrings`, which falls back to English. |
| `src/public-types.ts`                      | The public types. `@bcd-embed/schema` is imported with `import type` only.                    |
| `tests/`                                   | Vitest tests, and `tests/fixtures/message-cases.ts`, the fixtures the schema package lacks.   |
| `browser/`                                 | Browser tests for the Chromium Vitest project, named `*.browser.test.ts`.                     |
| `e2e/`, `playwright.e2e.config.ts`         | Playwright Test files named `*.e2e.ts`, run in three engines with axe, and their fixtures.    |
| `screen-reader/`, `playwright.*.config.ts` | The screen reader tests (below).                                                              |
| `vite.config.ts`, `tsconfig.build.json`    | The library build and its type declarations.                                                  |
| `.size-limit.json`                         | The size budget for `dist/index.js`, counted without `lit` and `@lit/task`.                   |
| `custom-elements-manifest.config.mjs`      | The Custom Elements Manifest analyzer's settings.                                             |

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

## Build and tests

| Command                                      | What it does                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @bcd-embed/element build`     | Builds `dist/index.js` with Vite, emits the type declarations with `tsc`, then checks the size budget. It needs `@bcd-embed/schema` built first, because the declarations import its types. `pnpm --filter @bcd-embed/element... build` builds the package and its dependencies in order, and `pnpm build` builds everything. |
| `pnpm --filter @bcd-embed/element typecheck` | Type-checks the source, the tests and the screen reader tests.                                                                                                                                                                                                                                                                |
| `pnpm exec vitest run packages/element`      | Runs this package's Vitest tests from the repository root. `pnpm test` runs them with every other workspace's.                                                                                                                                                                                                                |
| `pnpm --filter @bcd-embed/element cem`       | Writes `dist/custom-elements.json`. It leaves `package.json` unchanged. It lists nothing until a class exists.                                                                                                                                                                                                                |

The Vitest tests include a production build into a temporary directory, which checks that
`dist/index.js` has no mention of `zod`. The element reads the schema package's types only, because
Zod would roughly double the bundle.

## Browser tests

Two harnesses run the component in a real browser. Each was run once by the implementer of issue
#197 on macOS with Playwright 1.65.1, and the Element browser workflow runs the three-engine one on
every pull request that changes this package.

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

`e2e/fixtures/smoke.html` is an inert page, and `e2e/smoke.e2e.ts` runs axe on it, so the harness
proves itself before the element exists. A violation fails the test with the rule's id and the
elements it flags, for example `image-alt` with `img`.

The Element browser workflow (`.github/workflows/element-browser.yml`) has a `changes` job, one
test job per engine, and a final `element-browser` job that is the required status check. It
reports on every pull request, passes when the tests passed or had nothing to test, and fails when
any engine failed or was cancelled. A failed run uploads `test-results/` with the traces.

## Screen reader tests

[Guidepup](https://www.guidepup.dev/) drives a real screen reader through Playwright and records
what it says. `screen-reader/walk-table.ts` makes the same moves through a table with every
screen reader, so the transcripts can be compared step by step. The NVDA test then performs
more of Document 7's script (`docs/planning/07-component-phase1-markup.md`), steps 2 and 8 to
14, so that NVDA's output for those steps lands in its transcript too.

| Screen reader | Runs on                              | Browser              | Command                                           |
| ------------- | ------------------------------------ | -------------------- | ------------------------------------------------- |
| VoiceOver     | macOS 26 (`macos-26`)                | Playwright's WebKit  | `pnpm --filter @bcd-embed/element test:voiceover` |
| Orca          | Ubuntu 26.04 (`ubuntu-26.04`)        | Playwright's Firefox | `pnpm --filter @bcd-embed/element test:orca`      |
| NVDA          | Windows Server 2025 (`windows-2025`) | Playwright's Firefox | `pnpm --filter @bcd-embed/element test:nvda`      |

The tests are not part of `pnpm check`, because the screen reader takes over the machine while
they run. The Screen readers workflow (`.github/workflows/screen-readers.yml`) runs all three on
pull requests that change this workspace or the markup, and on manual runs. Its `screen-readers`
job is a required status check: it reports on every pull request and blocks the merge when any
screen reader fails or is cancelled.

Each test writes a `transcript.json` to its directory under `test-results/`, attaches it, and
prints it to the job log. The workflow uploads `test-results/` as the artifact
`screen-reader-results-<reader>` after a pass and after a failure. The checks on the page (which
element has focus, whether a disclosure is open) stop the test at once. The checks on the spoken
wording are soft: a mismatch still fails the test, but only after the walk has finished, so the
transcript is complete. Where the wording is the screen reader's own and is not yet known, the
step has no check and is performed for the transcript alone.

To run them locally, set the machine up once with `pnpm dlx @guidepup/setup@0.29.3 setup`. Then,
in `packages/element`, install the assets with `pnpm dlx @guidepup/setup@0.29.3 install` and the
browser with `pnpm exec playwright install webkit` on macOS, or `firefox` on Linux and Windows.
On Linux, run the tests inside `xvfb-run dbus-run-session --`.

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
