// What NVDA says while walking the Phase 1 tables in Playwright's Firefox.
//
// After the walk shared with VoiceOver and Orca, NVDA also performs Document 7's manual steps 8
// to 14 and step 2 (docs/planning/07-component-phase1-markup.md), so that the owner can review
// what it says in the transcript. The owner has no Windows machine, so the transcript is the
// only record of NVDA's output.
//
// Every expected phrase below is NVDA's own wording, copied from the transcripts of CI runs
// 44345867416 to 44354307768, which were identical in every run and on every retry. NVDA speaks
// the text as a user hears it at its default punctuation level: "Node.js" is "Node dot js", an
// underscore is a pause ("missing_target" is "missing target"), and a camel-case identifier is
// split into words ("AudioTrackList" is "Audio Track List"). The checks keep that wording rather
// than the markup's spelling, so a change in what a user hears fails the test.
import { nvdaTest as test, type NVDAPlaywright } from "@guidepup/playwright";
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

import { type ExtraStep, type Variant, type Wording, variants, walkTable } from "./walk-table.js";

/**
 * NVDA's moves, all made in browse mode. Table navigation (Control+Alt+arrow) moves NVDA's
 * browse cursor, not the browser's focus, so these steps check nothing about focus.
 */
const nvdaMoves = (nvda: NVDAPlaywright) => {
  const commands = nvda.keyboardCommands;
  const run = (command: (typeof commands)[keyof typeof commands]) => () =>
    nvda.perform(command, { capture: true });
  return {
    up: run(commands.moveToPreviousRow),
    down: run(commands.moveToNextRow),
    left: run(commands.moveToPreviousColumn),
    right: run(commands.moveToNextColumn),
    // `I` reads a whole list item. The down arrow reads one line, which can split a long item.
    nextListItem: run(commands.moveToNextListItem),
    // Enter in browse mode performs the default action of the item under NVDA's cursor, which
    // for a summary opens or closes its disclosure.
    activate: () => nvda.act({ capture: true }),
    // Control+Home moves NVDA's cursor to the top of the page, and `T` moves it to the next
    // table, which announces the table as a user entering it would hear it.
    top: () => nvda.press("Control+Home", { capture: true }),
    nextTable: run(commands.moveToNextTable),
  };
};

type Moves = ReturnType<typeof nvdaMoves>;

/**
 * How NVDA names a variant's table and its columns. On a column change NVDA announces the column
 * header and its platform header. Variant A (`scope`) puts the support target first, as in
 * "Node dot js Server". Variant B (`headers`) follows the order of the cell's `headers`
 * attribute, as in "Server Node dot js".
 */
type Spoken = {
  caption: string;
  size: string;
  chrome: string;
  opera: string;
  nodejs: string;
};

const spokenA: Spoken = {
  caption: "Browser compatibility: fixture dot adversarial-v 1",
  size: "with 16 rows and 4 columns",
  chrome: "Chrome Desktop",
  opera: "Opera Desktop",
  nodejs: "Node dot js Server",
};

const spokenB: Spoken = {
  caption: "Browser compatibility: fixture dot adversarial-v 1 (six rows)",
  size: "with 8 rows and 4 columns",
  chrome: "Desktop Chrome",
  opera: "Desktop Opera",
  nodejs: "Server Node dot js",
};

/** The table as NVDA announces it on reaching it, by Tab (step 1) or by `T` (step 2). */
const tableAnnouncement = ({ caption, size }: Spoken) =>
  `${caption}, region, ${caption}, table, ${size}, caption, ${caption}`;

/**
 * NVDA's wording for the shared walk. On Tab to the region, NVDA goes on to read every cell of
 * the table, which the check does not cover: the first phrases are enough to show it arrived.
 */
const sharedWording = (spoken: Spoken, rows: readonly [string, string, string]): Wording => ({
  "Tab to the scroll region": tableAnnouncement(spoken),
  "Tab to the fit-content cell in Chrome": `fit-content, row 3, ${spoken.chrome}, column 2, , Supported since Chrome 46. History for fit-content in Chrome, button, collapsed`,
  "open the fit-content disclosure": "expanded",
  "close the fit-content disclosure": "collapsed",
  "move right to Opera": `${spoken.opera}, column 3, No data for Opera`,
  "move right to Node.js": `${spoken.nodejs}, column 4, No data for Node dot js`,
  "move down the Node.js column to row 2": rows[0],
  "move down the Node.js column to row 3": rows[1],
  "move down the Node.js column to row 4": rows[2],
});

/** The disclosure in the row whose header contains `feature`. */
const disclosureIn = (page: Page, feature: string) =>
  page
    .locator("tbody tr")
    .filter({ has: page.locator("th", { hasText: feature }) })
    .locator("details");

const expandStep = (page: Page, moves: Moves, feature: string): ExtraStep => ({
  step: `expand ${feature} in Chrome`,
  perform: moves.activate,
  // Soft, so that a disclosure NVDA fails to open still leaves the later steps in the transcript.
  check: () => expect.soft(disclosureIn(page, feature)).toHaveJSProperty("open", true),
  expected: "expanded",
});

/** Step 8's history items, read the same way in both variants. */
const audioTrackListItems = (moves: Moves): ExtraStep[] => [
  {
    step: "step 8: read the first AudioTrackList history item",
    perform: moves.nextListItem,
    expected: "list, with 2 items, bullet Supported since Chrome 37 behind a flag.",
  },
  {
    step: "step 8: read the AudioTrackList flag preference",
    perform: moves.nextListItem,
    // The final "dot" is the full stop after the closing `code` element, which NVDA reads as a
    // separate symbol.
    expected:
      "bullet To enable it, set the preference, enable-experimental-web-platform-features, to, enabled, dot",
  },
];

/** Step 2, performed last because it moves NVDA's cursor away from the cells. */
const enterTable = (moves: Moves, spoken: Spoken, heading: string): ExtraStep[] => [
  {
    step: "move to the top of the page",
    perform: moves.top,
    expected: `out of table, out of region, heading, level 1, ${heading}`,
  },
  {
    step: "step 2: enter the table with T",
    perform: moves.nextTable,
    expected: tableAnnouncement(spoken),
  },
];

/**
 * Variant A, starting where the shared walk ends: NVDA's cursor on `preview_partial` in Node.js,
 * the fourth body row.
 */
const variantASteps = (page: Page, moves: Moves): ExtraStep[] => [
  {
    step: "move up to AudioTrackList in Node.js",
    perform: moves.up,
    expected: "Audio Track List, row 5, No data for Node dot js",
  },
  {
    step: "move left to AudioTrackList in Opera",
    perform: moves.left,
    expected: "Opera Desktop, column 3, No data for Opera",
  },
  {
    step: "step 8: read AudioTrackList in Chrome",
    perform: moves.left,
    expected:
      "Chrome Desktop, column 2, button, collapsed, , Supported since Chrome 37 behind a flag. Flag details for Audio Track List in Chrome",
  },
  expandStep(page, moves, "AudioTrackList"),
  ...audioTrackListItems(moves),
  {
    step: "move down to preview_partial in Chrome",
    perform: moves.down,
    expected: "out of list, preview partial, row 6, No data for Chrome",
  },
  {
    step: "step 9: read removed_partial in Chrome",
    perform: moves.down,
    expected:
      "removed partial, row 7, button, collapsed, , No support in Chrome. History and notes for removed partial in Chrome",
  },
  expandStep(page, moves, "removed_partial"),
  {
    step: "step 9: read the removed_partial removal history",
    perform: moves.nextListItem,
    expected:
      "list, with 2 items, bullet Partially supported from Chrome 11.1, removed in Chrome 12.1.",
  },
  {
    step: "step 9: read the removed_partial note",
    perform: moves.nextListItem,
    expected: "bullet Note: The initial implementation did not abort fetch requests.",
  },
  {
    step: "move down to localName in Chrome",
    perform: moves.down,
    expected: "out of list, local Name, row 8, No data for Chrome",
  },
  {
    step: "step 11: read localName in Opera",
    perform: moves.right,
    expected: "Opera Desktop, column 3, Supported since Opera 12.1 or earlier",
  },
  {
    step: "step 10: read missing_target in Opera",
    perform: moves.down,
    expected: "missing target, row 9, No data for Opera",
  },
  {
    step: "move down to unknown_runtime in Opera",
    perform: moves.down,
    expected: "unknown runtime, row 10, No data for Opera",
  },
  {
    step: "step 10: read unknown_runtime in Node.js",
    perform: moves.right,
    expected: "Node dot js Server, column 4, Support unknown in Node dot js",
  },
  ...(
    [
      ["partial_only", "partial only, row 11"],
      ["notes_only", "notes only, row 12"],
      ["prefixed_only", "prefixed only, row 13"],
      ["Array", "Array, row 14"],
      // NVDA runs the row header's two parts together when the row changes, and separates them
      // with a pause when the column changes (step 12).
      ["from", "from(part of Array), row 15"],
    ] as const
  ).map(([feature, header]) => ({
    step: `move down to ${feature} in Node.js`,
    perform: moves.down,
    expected: `${header}, No data for Node dot js`,
  })),
  {
    step: "move left to from in Opera",
    perform: moves.left,
    expected: "Opera Desktop, column 3, No data for Opera",
  },
  {
    step: "move left to from in Chrome",
    perform: moves.left,
    expected: "Chrome Desktop, column 2, Supported since Chrome 45",
  },
  {
    step: "step 12: read the from row header",
    perform: moves.left,
    expected: "Feature, column 1, from, (part of Array)",
  },
  {
    step: "step 12: read the async_iterable row header",
    perform: moves.down,
    expected: "row 16, async iterable, (part of Array dot from)",
  },
  ...enterTable(moves, spokenA, "Phase 1 markup: variant A (scope)"),
];

/**
 * Variant B, starting where the shared walk ends: NVDA's cursor on `Array` in Node.js, the
 * fourth body row. The shared walk's moves right along the `fit-content` row are already step 14.
 */
const variantBSteps = (page: Page, moves: Moves): ExtraStep[] => [
  {
    step: "move left to Array in Opera",
    perform: moves.left,
    expected: "Desktop Opera, column 3, No data for Opera",
  },
  {
    step: "step 13: read Array in Chrome",
    perform: moves.left,
    expected: "Desktop Chrome, column 2, Supported since Chrome 1",
  },
  // Step 13's question: NVDA announces every ancestor row header that the cell lists, in order.
  {
    step: "step 13: move down to from in Chrome",
    perform: moves.down,
    expected: "Array from, row 7, Supported since Chrome 45",
  },
  {
    step: "step 13: move down to async_iterable in Chrome",
    perform: moves.down,
    expected: "Array from async iterable, row 8, Supported since Chrome 121",
  },
  {
    step: "move up to from in Chrome",
    perform: moves.up,
    expected: "Array from, row 7, Supported since Chrome 45",
  },
  {
    step: "move up to Array in Chrome",
    perform: moves.up,
    expected: "Array, row 6, Supported since Chrome 1",
  },
  {
    step: "move up to preview_partial in Chrome",
    perform: moves.up,
    expected: "preview partial, row 5, No data for Chrome",
  },
  {
    step: "step 8: read AudioTrackList in Chrome",
    perform: moves.up,
    expected:
      "Audio Track List, row 4, button, collapsed, , Supported since Chrome 37 behind a flag. Flag details for Audio Track List in Chrome",
  },
  expandStep(page, moves, "AudioTrackList"),
  ...audioTrackListItems(moves),
  // NVDA's cursor is still in the list here, so NVDA first says "out of list", which the check
  // for moving to the top of the page leaves out.
  ...enterTable(moves, spokenB, "Phase 1 markup: variant B (headers and id)"),
];

type NvdaWalk = {
  sharedWording: Wording;
  extraSteps(page: Page, moves: Moves): ExtraStep[];
};

const nvdaWalks: Readonly<Record<string, NvdaWalk>> = {
  "index.html": {
    sharedWording: sharedWording(spokenA, [
      "abort, row 4, No data for Node dot js",
      "Audio Track List, row 5, No data for Node dot js",
      "preview partial, row 6, Partial support in Node dot js 25, a preview release",
    ]),
    extraSteps: variantASteps,
  },
  "headers-id.html": {
    sharedWording: sharedWording(spokenB, [
      "Audio Track List, row 4, No data for Node dot js",
      "preview partial, row 5, Partial support in Node dot js 25, a preview release",
      "Array, row 6, No data for Node dot js",
    ]),
    extraSteps: variantBSteps,
  },
};

const nvdaWalkFor = (variant: Variant): NvdaWalk => {
  const walk = nvdaWalks[variant.file];
  if (!walk) throw new Error(`No NVDA steps for ${variant.file}`);
  return walk;
};

for (const variant of variants) {
  test(`NVDA walks ${variant.name}`, async ({ page, nvda }, testInfo) => {
    const moves = nvdaMoves(nvda);
    const walk = nvdaWalkFor(variant);
    await walkTable(
      page,
      nvda,
      { right: moves.right, down: moves.down },
      variant,
      testInfo,
      {},
      {
        sharedWording: walk.sharedWording,
        extraSteps: walk.extraSteps(page, moves),
      },
    );
  });
}
