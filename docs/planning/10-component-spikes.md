# Component spikes

This document records the findings of the time-boxed spikes that settle open questions in the
web component plan (Documents 3 and 7). Each spike has its own section, titled with its issue
number and subject, and states what it settled, what it did not, and what is still unverified.

## #215: NVDA with Firefox in the screen reader CI on a Windows runner

**Question.** Can NVDA with Firefox run the screen reader walks on a GitHub-hosted Windows runner
reliably enough to be part of the required `screen-readers` check, and how many of Document 7's
manual steps can it automate?

**Status.** Written and ready for its first CI run, not yet run. The change was written on macOS,
where NVDA cannot run, so nothing below about NVDA's behaviour has been observed yet. The five
consecutive manual runs that the issue requires decide whether NVDA stays in the required check.

### What the change does

The workflow `.github/workflows/screen-readers.yml` gains a third matrix entry: NVDA on
`windows-2025` with Playwright's Firefox. Its result feeds the same `screen-readers` job as
VoiceOver and Orca, so an NVDA failure fails the required check. The job's steps now run in Bash
on every runner, which on Windows is the Bash that comes with Git for Windows. That keeps one set
of steps for all three runners, including the empty `run` prefix that NVDA shares with
VoiceOver. The job's time limit rises from 30 to 45 minutes, because each NVDA test may take up
to ten minutes and is retried once.

`packages/element` gains `playwright.nvda.config.ts`, the `test:nvda` script, and
`screen-reader/table.nvda.ts`. The test uses `nvdaTest` from `@guidepup/playwright`, whose
`navigateToWebContent` already works around a Firefox focus problem under NVDA
(`lib/navigateNVDAtoWebContent.js`, which cites nvaccess/nvda#5758).

The walk shared with VoiceOver and Orca (`screen-reader/walk-table.ts`) gains an optional list of
extra steps that one reader performs after the shared moves, recorded into the same transcript.
NVDA uses it for Document 7's steps 2 and 8 to 14. Every check in an extra step is soft, so a
mismatch fails the test but the walk still runs to its end and every step reaches the transcript.
The walk refuses extra steps whose names repeat, because the soft checks look a step up by name. Document 7's section "NVDA in CI" lists, step
by step, which are asserted, which are performed for transcript review, and which stay manual.

Two fixes to the shared walk came out of the issue's requirement that the artifact hold a
transcript for every performed step, on a pass and on a failure. Both also apply to VoiceOver and
Orca:

1. The transcript was attached as a `body`, which Playwright does not write to `test-results/` as
   a file. After a pass it reaches only the reporters, so the uploaded artifact held no
   transcript. After a failure it is inside `trace.zip`, because the configs keep the trace on
   failure and tracing includes attachments, so reading it meant opening the trace. The walk now
   writes `transcript.json` into the test's output directory and attaches that file.
2. Each step was recorded after its page check, so a failed check dropped that step's output from
   the transcript. Each step is now recorded first.

### How many manual steps NVDA performs

Guidepup's NVDA class exposes every NVDA keyboard command, including table navigation
(Control+Alt+arrows), next table (`T`), next list item (`I`) and the default action (Enter). That
is enough to perform every step from 8 to 14, and step 2. Step 7, a full Tab traversal, is left
manual because it tests the page's tab order more than NVDA, and Document 3 §9 already asks for
it as a scripted keyboard test of the component.

| Document 7 state                      | Steps                       |
| ------------------------------------- | --------------------------- |
| Asserted in CI                        | 1, 3, 5, 6, 8, 9, 10, 11, 12 |
| Performed in CI for transcript review | 2, 4, 13, 14                |
| Manual                                | 7                           |

### How the checks were chosen

Guidepup documents NVDA's API, not NVDA's wording. Its own NVDA example for Firefox
(`examples/playwright-nvda` in guidepup/guidepup-playwright) shows phrases such as "Guidepup,
heading, level 1" and "link, Get Started", but nothing about tables, disclosures or states. So:

- The soft checks cover only text the markup defines: cell names, row header names, and history
  items. A wrong cell name means NVDA's cursor is not where the walk thinks it is, or the name is
  not exposed.
- NVDA's own wording (its role names, "table with … rows", how it announces a header) carries no
  check. Those steps are performed so that the first run records the wording, and the checks can
  be written from it.
- The shared walk's soft checks for "expanded" and "collapsed" also apply to NVDA. NVDA is
  expected to use those words, but this is not yet observed.
- VoiceOver checks that it says "Server and Node.js" on entering the Node.js column. NVDA has no
  such check, because its wording for column headers is not known yet.

### Still unverified until CI runs

- **The runner setup.** `@guidepup/setup@0.29.3 setup --ci` and `install nvda` on `windows-2025`.
  The closest evidence is guidepup/guidepup-playwright's `.github/workflows/test-nvda.yml` at
  commit `b017456b`: lines 18 and 25 to 29 run `@guidepup/setup@0.29.2 setup --ci`, then
  `install`, then `yarn test:nvda:firefox` with no wrapper, on `windows-2022` and `windows-2025`.
  We use 0.29.3, one patch release later.
- **pnpm under Git Bash on Windows.** pnpm/action-setup's `.github/workflows/test.yaml` at the
  pinned commit `73e46992` runs `pnpm --version` with `shell: bash` (lines 73 and 85) in a matrix
  that includes `windows-latest` (lines 47 and 50). This repository has not run pnpm on Windows
  before.
- **Where NVDA's cursor starts.** After `navigateToWebContent`, the walk tabs up to three times to
  reach the region. Guidepup's helper presses Tab once itself, so focus may already be on the
  introduction's link.
- **Whether Enter on the summary toggles it under NVDA.** NVDA in browse mode handles Enter
  itself and performs the item's default action. The shared walk's hard check on `open` settles
  this on the first run. In steps 8 and 9 the same check is soft, so a disclosure that does not
  open fails the test without stopping the later steps.
- **Whether table navigation works from inside an open disclosure's list.** Steps 8 and 9 read the
  history items with `I` and then move on with Control+Alt+Down from inside the list. If NVDA
  does not treat that position as inside the cell, the later cell-name checks fail, and the
  transcript shows where the cursor went.
- **Whether `I` reads each history item whole.** A history item with `code` elements may be read
  in more than one phrase. The checks allow for phrases split by the transcript's ` | `
  separator only where they use a pattern (`enable-experimental-web-platform-features.*enabled`).
- **The time per test.** The NVDA walk makes 27 more captured moves than the other readers in
  variant A, and 13 more in variant B. The ten-minute test limit and the 45-minute job limit are estimates.
- **Reliability.** Guidepup's own NVDA Firefox example config sets `retries: 5`, which suggests
  NVDA with Firefox flakes on hosted runners. This repository keeps `retries: 1`, as for the other
  readers. A test that passes on its retry is reported as flaky in the list reporter's summary,
  and the issue counts that as a failed run.

### Decision rule

If any of the five manual runs fails or passes only on a retry, the spike names the flaky step
and its failure rate, and NVDA leaves the required check until that is fixed: either by removing
the matrix entry or by making the NVDA job advisory. If NVDA cannot run reliably within the
two-day time box, the spike stops here and the owner chooses again. The owner passes in #186 and
#212 then fall back to a tester or a virtual machine.

### Results of the manual runs

| Run | Run ID | Variant A | Variant B | Retried | Notes |
| --- | ------ | --------- | --------- | ------- | ----- |
| 1   |        |           |           |         |       |
| 2   |        |           |           |         |       |
| 3   |        |           |           |         |       |
| 4   |        |           |           |         |       |
| 5   |        |           |           |         |       |
