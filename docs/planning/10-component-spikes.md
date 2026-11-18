# Component spikes

This document records the findings of the time-boxed spikes that settle open questions in the
web component plan (Documents 3 and 7). Each spike has its own section, titled with its issue
number and subject, and states what it settled, what it did not, and what is still unverified.

## #215: NVDA with Firefox in the screen reader CI on a Windows runner

**Question.** Can NVDA with Firefox run the screen reader walks on a GitHub-hosted Windows runner
reliably enough to be part of the required `screen-readers` check, and how many of Document 7's
manual steps can it automate?

**Status.** NVDA runs on `windows-2025`. Four manual runs on 18 November 2026 completed, and in
all four NVDA performed every step and gave the same transcript, word for word, on every attempt.
All four failed, and only on soft checks written in the markup's spelling rather than NVDA's
("Node.js" where NVDA says "Node dot js"). The checks are now written from NVDA's real wording. The
five consecutive passing runs that the issue requires have to be run again on that change, so
NVDA has not yet earned its place in the required check.

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
The walk refuses extra steps whose names repeat, because the soft checks look a step up by name.
The walk also takes `sharedWording`, which replaces the shared checks for a reader whose real
wording differs from the markup's text, as NVDA's does. Document 7's section "NVDA in CI" lists,
step by step, which are asserted, which are performed for transcript review, and which stay
manual.

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
| Asserted in CI                        | 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14 |
| Manual                                | 7                                       |

Steps 10, 13 and 14 also ask for a person's judgment ("clearly different", "helps or is noise",
"any difference"), which the transcript informs but no check can give.

### How the checks were chosen

Guidepup documents NVDA's API, not NVDA's wording, so the first version checked only text the
markup defines and left NVDA's own wording unchecked until a run recorded it. The first four runs
recorded it, and every NVDA step now checks the phrase NVDA actually spoke there, copied from the
transcripts of run 44354307768 and confirmed against run 44345867416. That includes NVDA's role
and state words ("button, collapsed", "expanded", "list, with 2 items, bullet"), the table size,
and the header announcements.

The checks keep NVDA's spelling of what it speaks, such as "Node dot js", rather than normalising
punctuation in the test. A user hears that wording, so a change in it should fail the test. Each
check is a phrase the transcript must contain, so the parts NVDA reads before or after it are not
checked: on Tab to the region, for example, only the region and table announcement is checked,
not the reading of every cell that follows.

### What the first runs showed

The transcripts were identical in all four runs and on every retry, so the failures were not
flaky. Three soft checks failed in every run, because they were written in the markup's spelling:

| Check                              | Expected                              | NVDA said                                                      |
| ---------------------------------- | ------------------------------------- | -------------------------------------------------------------- |
| "move right to Node.js", A and B   | "No data for Node.js"                 | "Node dot js Server, column 4, No data for Node dot js" (A)    |
| Step 10, `unknown_runtime`         | "Support unknown in Node.js"          | "Node dot js Server, column 4, Support unknown in Node dot js" |
| Step 12, `async_iterable` header   | `async_iterable.*\(part of Array\.from\)` | "row 16, async iterable, (part of Array dot from)"         |

The cause is NVDA's default punctuation level. It speaks "." inside a word as "dot", reads an
underscore as a pause, and splits a camel-case identifier into words: "missing_target" is "missing
target", "AudioTrackList" is "Audio Track List", and "localName" is "local Name". That is what an
NVDA user hears, so the expectations follow it.

Every move landed on the cell the walk intended, and every disclosure opened. The other findings,
which Document 7 records step by step:

- **Column headers.** NVDA announces the column header on every column change, unlike Orca, and
  includes the platform: "Node dot js Server, column 4" in variant A and "Server Node dot js,
  column 4" in variant B.
- **Row headers.** NVDA announces the row header on every row change. In variant B it announces
  every ancestor row header too: "Array from async iterable, row 8" (step 13).
- **The region reads the whole table.** On Tab to the region, NVDA announces the region and the
  table, then reads every header and cell of the table, all 16 rows in variant A, before it
  stops. That is a long announcement for one tab stop, and a question for the owner rather than
  a test failure.
- **A stray "dot".** The flag preference item ends "to, enabled, dot", because the full stop sits
  after the closing `code` element and NVDA reads it as a separate symbol.
- **Variant A's row header runs together on a row change.** Moving down to `from` gives
  "from(part of Array), row 15", without the pause NVDA gives it on a column change ("from, (part
  of Array)").

### Still unverified

- **Reliability with the corrected checks.** The four runs say NVDA is deterministic, but no run
  has yet passed, so none has shown a pass without a retry.
- **Reliability over time.** Guidepup's own NVDA Firefox example config sets `retries: 5`, which
  suggests NVDA with Firefox flakes on hosted runners, though these four runs did not. This
  repository keeps `retries: 1`, as for the other readers. A test that passes on its retry is
  reported as flaky in the list reporter's summary, and the issue counts that as a failed run.
- **Wording across NVDA releases.** The checks pin NVDA's exact wording, so a new NVDA release
  installed by `@guidepup/setup` may change it. The transcript then shows the new wording.

Settled by the first runs: the runner setup (`@guidepup/setup@0.29.3 setup --ci` and `install
nvda`), pnpm under Git Bash on Windows, NVDA's starting position, Enter toggling a summary in
browse mode, table navigation from inside an open disclosure's list, and `I` reading a history
item whole. The time limits were generous: the NVDA job took about five minutes.

### Decision rule

If any of the five manual runs fails or passes only on a retry, the spike names the flaky step
and its failure rate, and NVDA leaves the required check until that is fixed: either by removing
the matrix entry or by making the NVDA job advisory. If NVDA cannot run reliably within the
two-day time box, the spike stops here and the owner chooses again. The owner passes in #186 and
#212 then fall back to a tester or a virtual machine.

### Results of the manual runs

The first four runs used the checks written before NVDA had run, so they count as the spike's
first evidence, not as the five consecutive runs. Each test took 40 seconds to a minute on each
attempt.

| Run | Run ID      | NVDA job | Variant A | Variant B | Retried | Notes |
| --- | ----------- | -------- | --------- | --------- | ------- | ----- |
| 1   | 44345867416 | 5 min 2 s | Failed   | Failed    | Yes, failed again | The three wording failures above, on both attempts. VoiceOver and Orca passed. |
| 2   | 44349309077 | 4 min 58 s | Failed  | Failed    | Yes, failed again | The same failures. VoiceOver and Orca passed. |
| 3   | 44350926720 | 4 min 46 s | Failed  | Failed    | Yes, failed again | The same failures. VoiceOver was cancelled because no hosted macOS runner picked the job up ("The job was not acquired by Runner of type hosted"), which this change does not affect. |
| 4   | 44354307768 | 5 min 8 s | Failed   | Failed    | Yes, failed again | The same failures. VoiceOver was cancelled for the same macOS capacity reason. |
| 5   | 44357655471 |          |           |           |         | Still queued for a macOS runner when this was written. It runs the old checks too. |

The five consecutive runs on the corrected checks are still to be made and recorded here.
