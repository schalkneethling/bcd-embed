# `@bcd-embed/element`

The `<bcd-compat-table>` web component (`docs/planning/03-web-component-architecture.md`). The
component itself does not exist yet. The workspace currently holds the screen reader tests for
the Phase 1 static markup in `docs/planning/phase1-markup/`.

## Screen reader tests

[Guidepup](https://www.guidepup.dev/) drives a real screen reader through Playwright and records
what it says. `screen-reader/walk-table.ts` makes the same moves through a table with either
screen reader, so the two transcripts can be compared step by step.

| Screen reader | Runs on | Browser              | Command                                           |
| ------------- | ------- | -------------------- | ------------------------------------------------- |
| VoiceOver     | macOS   | Playwright's WebKit  | `pnpm --filter @bcd-embed/element test:voiceover` |
| Orca          | Linux   | Playwright's Firefox | `pnpm --filter @bcd-embed/element test:orca`      |

The tests are not part of `pnpm check`, because the screen reader takes over the machine while
they run. The Screen readers workflow (`.github/workflows/screen-readers.yml`) runs both on
pull requests that change this workspace or the markup. It is advisory, not a required check.

Each test attaches a `transcript.json` and prints it to the job log. The checks on the page
(which element has focus, whether a disclosure is open) fail the test. The checks on the spoken
wording are soft: they are reported, and the transcript is still complete.

To run them locally, set the machine up once with `pnpm dlx @guidepup/setup@0.29.3 setup`. Then,
in `packages/element`, install the assets with `pnpm dlx @guidepup/setup@0.29.3 install` and the
browser with `pnpm exec playwright install webkit` (or `firefox` on Linux). On Linux, run the
tests inside `xvfb-run dbus-run-session --`.

The setup tool is not a dependency of this workspace, because it only prepares a machine and
the tests never import it. Running it with `pnpm dlx` keeps its version pinned in one command.

`@guidepup/guidepup` is pinned to 0.38.0, the version `@guidepup/playwright` 0.21.0 was built
against. Version 0.40.0 groups the Orca commands by service, and `@guidepup/playwright` 0.21.0
still looks them up by their old flat names, so moving Orca into the page fails with "Cannot read
properties of undefined (reading 'service')". Update the two packages together.

These tests do not replace the release gate in Document 3 §9, which names NVDA with Firefox and
VoiceOver with Safari. Playwright's WebKit is not Safari, and Orca is not NVDA.
