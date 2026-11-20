# `@bcd-embed/element`

The `<bcd-compat-table>` web component (`docs/planning/03-web-component-architecture.md`). The
component class does not exist yet. The package currently holds the build, the message table, the
note tokenizer, the public types, and the screen reader tests for the Phase 1 static markup in
`docs/planning/phase1-markup/`.

## Layout

| Path                                       | Holds                                                                                         |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `src/index.ts`                             | The package entry. Everything the package exports passes through it.                          |
| `src/strings/en.ts`                        | The English message table, keyed by message id, with `{placeholders}`.                        |
| `src/strings/format.ts`                    | `formatMessage`, `MissingPlaceholderError`, and `selectStrings`, which falls back to English. |
| `src/public-types.ts`                      | The public types. `@bcd-embed/schema` is imported with `import type` only.                    |
| `src/model/note.ts`                        | `parseNote`, which turns a BCD note string into text, code, emphasis, and link segments.      |
| `tests/`                                   | Vitest tests, and `tests/fixtures/message-cases.ts`, the fixtures the schema package lacks.   |
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
address does not start with `http://` or `https://` and a host, which rules out `javascript:`,
relative, and protocol-relative links.

Entities decode once, from a closed list: `&lt;`, `&gt;`, `&amp;`, `&quot;`, and decimal or
hexadecimal numeric entities. So `&amp;lt;` reads `&lt;`, and `&lt;code&gt;` is text, not a tag.
Unknown entities, and numeric ones for control characters, surrogates, noncharacters, or code
points past U+10FFFF, stay literal.

The scanner reads each character once and never steps back, so it takes O(n) time and space for a
note of n characters. `parseNoteWithSteps` returns the number of characters it read, and a test
checks that a 100,000-character note, and a set of adversarial ones, take at most 2n reads. A test
also checks that the package source never uses an HTML string sink such as `innerHTML` or
`unsafeHTML`.

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
