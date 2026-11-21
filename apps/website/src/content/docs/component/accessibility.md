---
title: Accessibility
description: The markup bcd-compat-table renders, how a screen reader reads it, and what the screen reader tests do and do not cover.
---

`<bcd-compat-table>` renders a real `<table>`, and every cell carries a full
sentence such as "Supported since Chrome 29", so a screen reader announces the
complete fact instead of an icon. This page describes the markup on the main
branch today, the screen reader pairs that must pass before a release, and
what the automated tests leave to a person.

## The markup

The element renders the structure below, with no Accessible Rich Internet
Applications (ARIA) role on the table itself:

| Part                           | Markup                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| The scrolling region           | A `<div role="region">` named by the table's caption, with `tabindex="0"` so the keyboard can reach and scroll it |
| The table's name               | A `<caption>`, such as "Browser compatibility: css.properties.display"                                            |
| The column headers             | Two header rows: platform groups with `scope="colgroup"`, then support targets with `scope="col"`                 |
| The feature names              | A `<th scope="row">` at the start of each row; a nested row adds a hidden "(part of …)" that names its parent     |
| A cell                         | The full sentence in a visually hidden span, and the icon and short version in a span that screen readers skip    |
| A cell with a history or notes | A native `<details>` element whose `<summary>` holds the cell's sentence and a label such as "History" or "Notes" |
| A note                         | Inside a `<bdi>` element, so text direction marks in a note cannot reorder the words around it                    |

The span with the icon and the short version carries `aria-hidden="true"` and
`hidden`. Without the base stylesheet, the browser hides it, and each cell
reads as its sentence. The base stylesheet shows it to sighted readers, and
`aria-hidden` keeps it out of what a screen reader reads.

The sentence span is hidden from sight with `font-size: 0`, `clip-path`, and
`white-space: nowrap`, and it stays an inline box that is not positioned. Two
common alternatives failed in the project's screen reader tests: a positioned
span made NVDA, the NonVisual Desktop Access screen reader, run a row header's
words together, and an `inline-block` span became an object of its own that
NVDA read as an empty item.

## Keyboard and focus

On the main branch today, the Tab key stops on the scrolling region and on
each `<summary>`, and nowhere else in the table. The arrow keys scroll the
region once it has focus. Enter and Space open and close a disclosure, which
is the browser's own behaviour for `<details>`, and the browser never moves
focus when a disclosure opens.

Issue #204 is building the interaction phase: how the disclosures behave, the
keyboard paths through the table, and reduced motion. It may change what this
section describes, so read this section as the current state, not as a
promise.

## Loading and errors

The element never uses a live region and never moves focus, so a page with ten
tables makes no announcement while they load. While a request is in flight,
the element carries `aria-busy="true"`. When the page gave no fallback
content, the element shows one plain sentence while it loads and after an
error, so it is never empty. A page that needs to react to a table loading or
failing listens for the [events](/component/events/).

## Automated checks

The project runs axe, an automated accessibility checker, in Chromium,
Firefox, and WebKit on each state: loading, loaded, error, with every
disclosure open, in a narrow container where the region scrolls, and on a page
with no stylesheet. A scripted test checks where the Tab key stops.
Automated checkers cover only part of what matters, which is why screen reader
testing is part of the release gate.

## The release gate

Two pairs of screen reader and browser must pass before each release. JAWS (Job Access With Speech)
with Chrome is tested on a best-effort basis.

| Required pair         | How it is tested                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| VoiceOver with Safari | A manual pass by the project's owner, following the project's screen reader script against the built component               |
| NVDA with Firefox     | The NVDA walk in continuous integration (CI) passes on the release commit, and the owner reviews its transcript step by step |

Three walks run in CI on pull requests that change the element, the schema
package, or the lockfile. Pull requests from Dependabot, the bot that proposes
dependency updates, are skipped, except updates to the walks' own tooling; the
walks then run on the push to the main branch after the merge. Each walk
drives a real screen reader through the loaded table and records what it says.
A walk is evidence about the required pair it is closest to, not a substitute
for it:

| Walk      | Runs on             | Browser                       | Closest required pair, and how far it covers it                                                          |
| --------- | ------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| VoiceOver | macOS 26            | Playwright's build of WebKit  | VoiceOver with Safari, partly: WebKit is not Safari, so the manual Safari pass stays required            |
| NVDA      | Windows Server 2025 | Playwright's build of Firefox | NVDA with Firefox: its passing walk and the owner's review of the transcript are how that pair is tested |
| Orca      | Ubuntu 26.04        | Playwright's build of Firefox | None; it shows how another screen reader reads the same markup                                           |

## What the automated walks do not cover

The walks are evidence, not the whole gate. They leave these to a person:

- **Released browsers.** The walks run Playwright's builds of WebKit and
  Firefox, not Safari and not a released Firefox, and NVDA runs on Windows
  Server, not a desktop Windows. Safari's own behaviour, such as which
  elements take a tab stop, can differ, so the manual Safari pass stays.
- **A full Tab traversal.** Each walk uses Tab only to reach the scrolling
  region and then the first disclosure. The other
  disclosures are reached with the screen reader's table commands, not with
  Tab. The scripted keyboard test checks where focus stops, but not what a screen
  reader says at each stop.
- **Loading and error states.** The walks cover the loaded table only. What
  each screen reader says on reaching a loading element or an error sentence
  is written down as an expectation and is not verified yet.
- **A scrolled table.** The walks use a window 1280 pixels wide, where the
  test table fits, so no walk hears a table that is scrolled sideways.
- **Judgement.** Whether two announcements are clearly different, or whether
  the column group headers help or add noise, is a question the transcript
  informs but no check answers.
- **Notes in other readers.** NVDA's walk heard the `<bdi>` around each note
  and read the note as expected. Orca's and VoiceOver's transcripts of the
  notes are not checked yet.
- **A new NVDA release.** The NVDA checks pin its exact wording, so a new
  release may change it, and the transcript then shows the new wording.
- **Forced colours.** A real Windows High Contrast check is manual.

The owner's manual pass with the built component runs at the end of the
component's development, together with the release gate, and has not run yet.
