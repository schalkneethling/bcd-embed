# Component Phase 1 — static markup and screen-reader validation

**Status:** Markup written; screen-reader validation pending.
**Depends on:** Document 3 §5 and §10 (Phase 1).

Phase 1 settles the table's accessible structure before any component code
exists. This document records the candidate markup, the decisions it encodes,
the questions only a screen reader can answer, and the strings the markup
needs.

## What is here

The pages are static HTML with no script. Open them from disk or serve the
directory.

| File                             | Content                                                                 |
| -------------------------------- | ----------------------------------------------------------------------- |
| `phase1-markup/index.html`       | Variant A: all 14 rows of the adversarial fixture, headers by `scope`   |
| `phase1-markup/headers-id.html`  | Variant B: six of those rows, headers by explicit `headers` and `id`    |
| `phase1-markup/phase1.css`       | Readability only. It is not a proposal for the base stylesheet          |

The data is `v1NormalizedFixture` from `@bcd-embed/schema`
(`packages/schema/src/fixtures/v1.ts`). Its three support targets give a
two-tier header: Desktop over Chrome and Opera, Server over Node.js.

The glyphs (✓, ✕, ◐, ⚑, ?, —) are placeholders for the icons that Phase 3
chooses. They are hidden from assistive technology.

## Decisions the markup encodes

**A cell's accessible name states the whole fact, including the support
target.** A cell reads "Supported since Chrome 46", not "46". The visible
glyph and version are `aria-hidden`, and a visually hidden span carries the
sentence. The name repeats the target because a screen reader announces the
column header only when the column changes, so a reader moving down a column
would otherwise hear versions with no browser.

**A cell gets a disclosure only when it has more to say than its name.** The
disclosure is a native `<details>`, and its `<summary>` holds the cell's fact
followed by a label that names the cell: "Supported since Chrome 46. History
for fit-content in Chrome". A keyboard user who tabs through the table
therefore hears a complete fact at every stop. Cells with nothing further,
such as "Supported since Chrome 1", are plain text and take no tab stop.

**Notes and flag details sit inside the disclosure of their own cell.** There
are no footnote markers that point elsewhere.

**An absent support target and an explicitly unknown one read differently.**
"No data for Opera" means BCD has no entry. "Support unknown in Node.js" means
BCD records the support as unknown.

**A removed feature states today's fact first.** The name is "No support in
Chrome", and the disclosure gives the history: "Partially supported from
Chrome 11.1, removed in Chrome 12.1".

**The scroll region is focusable and named by the caption.** The wrapper has
`role="region"`, `tabindex="0"`, and `aria-labelledby` pointing at the
`<caption>`.

## What the two variants differ in

|                      | Variant A (`scope`)                                    | Variant B (`headers` and `id`)                          |
| -------------------- | ------------------------------------------------------ | ------------------------------------------------------- |
| Column headers       | `scope="colgroup"` on the platform, `scope="col"` below | Each cell lists its platform and target header ids      |
| Row header           | `scope="row"`                                          | Each cell lists its row header id                       |
| Nested feature       | Hidden text in the row header: "(part of Array)"       | The cell lists every ancestor row header as a header    |
| Markup cost per cell | None                                                   | One `headers` attribute with three to five ids          |

Variant A is the simpler markup, so it wins unless a screen reader announces
variant B more completely.

## Screen-reader test script

Run each step in both required combinations (Document 3 §9): VoiceOver with
Safari, and NVDA with Firefox. Record what was announced, word for word where
it differs from the expectation.

| #   | Action                                                                        | Expectation                                                                                  |
| --- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | Tab into the page until focus reaches the table's scroll region               | Announced as a region named "Browser compatibility: fixture.adversarial-v1"                  |
| 2   | Enter the table with the table navigation commands                            | The caption and the size (16 rows in A, 4 columns) are announced                             |
| 3   | Move right along the `fit-content` row from Chrome to Opera to Node.js        | Each move announces the new column header. Entering Node.js also announces "Server"          |
| 4   | Move down the Chrome column for five rows                                     | Each move announces the row header, then the cell's full sentence                            |
| 5   | On `fit-content` in Chrome, activate the disclosure with Enter or Space       | "expanded" is announced, the three history items are reachable, and focus stays on the summary |
| 6   | Collapse it again                                                             | "collapsed" is announced, and focus stays on the summary                                     |
| 7   | Tab through the whole table without table navigation                          | Stops only on the region and on the five disclosures, and each stop names its cell           |
| 8   | Read `AudioTrackList` in Chrome, then expand it                               | The name says "behind a flag", and the disclosure names the preference and its value         |
| 9   | Read `removed_partial` in Chrome, then expand it                              | "No support in Chrome" first, then the removal history and the note                          |
| 10  | Read `unknown_runtime` in Node.js and `missing_target` in Opera               | "Support unknown in Node.js" and "No data for Opera" are clearly different                   |
| 11  | Read `localName` in Opera                                                     | "Supported since Opera 12.1 or earlier"                                                      |
| 12  | Variant A: read the `from` and `async_iterable` row headers                   | "from (part of Array)" and "async_iterable (part of Array.from)"                             |
| 13  | Variant B: move down the Chrome column from `Array` to `async_iterable`       | Note whether the ancestor row headers are announced, and whether that helps or is noise      |
| 14  | Variant B: repeat step 3                                                      | Note any difference from variant A in what is announced for the platform row                 |

## Questions the test must answer

1. Does `scope` alone announce the platform header ("Desktop", "Server") in
   both combinations, or does only `headers` and `id` do so?
2. Is the support target's name in every cell welcome, or is it noise once the
   column header has been announced?
3. Is the summary too long with the fact and the label together? The
   alternative keeps the fact as plain cell text and gives the summary a short
   visible label such as "History".
4. Is "(part of Array)" in the row header enough to convey nesting, or do the
   ancestor headers of variant B work better?
5. Do the visible glyph and version, hidden from assistive technology, cause
   any trouble with find-in-page or copy and paste?

## Results

| Combination         | Tester | Date | Variant A | Variant B | Notes |
| ------------------- | ------ | ---- | --------- | --------- | ----- |
| VoiceOver + Safari  |        |      |           |           |       |
| NVDA + Firefox      |        |      |           |           |       |
| JAWS + Chrome       |        |      |           |           | Best effort |

## String inventory

Document 3 §4 requires every rendered string to be a message with
placeholders, never concatenated fragments. Hand-writing the markup produced
this first inventory. The message ids are proposals.

| Message id                  | Text                                                                       |
| --------------------------- | -------------------------------------------------------------------------- |
| `caption`                   | Browser compatibility: {query}                                             |
| `header-feature`            | Feature                                                                    |
| `platform-desktop`          | Desktop                                                                    |
| `platform-server`           | Server                                                                     |
| `supported-since`           | Supported since {target} {version}                                         |
| `supported-since-or-earlier` | Supported since {target} {version} or earlier                             |
| `supported-prefixed`        | Supported since {target} {version} with the prefix {prefix}                |
| `supported-flagged`         | Supported since {target} {version} behind a flag                           |
| `partial-since`             | Partial support since {target} {version}                                   |
| `partial-preview`           | Partial support in {target} {version}, a preview release                   |
| `no-support`                | No support in {target}                                                     |
| `unknown`                   | Support unknown in {target}                                                |
| `no-data`                   | No data for {target}                                                       |
| `part-of`                   | (part of {parent})                                                         |
| `disclosure-history`        | History for {feature} in {target}                                          |
| `disclosure-history-notes`  | History and notes for {feature} in {target}                                |
| `disclosure-notes`          | Notes for {feature} in {target}                                            |
| `disclosure-flag`           | Flag details for {feature} in {target}                                     |
| `history-prefixed`          | With the prefix {prefix}: supported since {target} {version}.              |
| `history-alternative-removed` | Under the name {name}: supported from {target} {added}, removed in {target} {removed}. |
| `history-removed`           | Supported from {target} {added}, removed in {target} {removed}.            |
| `history-partial-removed`   | Partially supported from {target} {added}, removed in {target} {removed}.  |
| `flag-preference`           | To enable it, set the preference {name} to {value}.                        |
| `note`                      | Note: {text}                                                               |

The inventory is not complete. The fixture has no mobile or XR (extended
reality) target, no runtime flag, no full-support preview, and no
`versionLast` value, so those messages are still to be written in Phase 2.

## Not covered by Phase 1

Visual design, icons, the palette, container-query reflow, the sticky first
column, and print styles belong to Phase 3. The filtering of the default
target set (`chrome firefox safari nodejs`) belongs to Phase 2. The fixture
has no Firefox or Safari entry, so the pages show its own three targets.
