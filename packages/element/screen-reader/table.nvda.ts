// What NVDA says while walking the Phase 1 tables in Playwright's Firefox.
//
// After the walk shared with VoiceOver and Orca, NVDA also performs Document 7's manual steps 8
// to 14 and step 2 (docs/planning/07-component-phase1-markup.md), so that the owner can review
// what it says in the transcript. The owner has no Windows machine, so the transcript is the
// only record of NVDA's output.
//
// The soft checks cover only the text that the markup defines, such as a cell's accessible name.
// NVDA's own wording (roles, states, table coordinates, how it announces a header) is not
// documented by Guidepup, so the steps that depend on it carry no check: they are performed for
// the transcript, and the first runs in CI tell us what NVDA says.
import { nvdaTest as test, type NVDAPlaywright } from "@guidepup/playwright";
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

import { type ExtraStep, type Variant, variants, walkTable } from "./walk-table.js";

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

/** The disclosure in the row whose header contains `feature`. */
const disclosureIn = (page: Page, feature: string) =>
  page
    .locator("tbody tr")
    .filter({ has: page.locator("th", { hasText: feature }) })
    .locator("details");

const expandStep = (page: Page, moves: Moves, feature: string): ExtraStep => ({
  step: `expand ${feature} in Chrome`,
  perform: moves.activate,
  check: () => expect(disclosureIn(page, feature)).toHaveJSProperty("open", true),
});

/** Step 2, performed last because it moves NVDA's cursor away from the cells. */
const enterTable = (moves: Moves): ExtraStep[] => [
  { step: "move to the top of the page", perform: moves.top },
  // NVDA's wording for the table's name and size is its own, so the step has no check.
  { step: "step 2: enter the table with T", perform: moves.nextTable },
];

/**
 * Variant A, starting where the shared walk ends: NVDA's cursor on `preview_partial` in Node.js,
 * the fourth body row.
 */
const variantASteps = (page: Page, moves: Moves): ExtraStep[] => [
  { step: "move up to AudioTrackList in Node.js", perform: moves.up },
  { step: "move left to AudioTrackList in Opera", perform: moves.left },
  {
    step: "step 8: read AudioTrackList in Chrome",
    perform: moves.left,
    expected: "Supported since Chrome 37 behind a flag",
  },
  expandStep(page, moves, "AudioTrackList"),
  {
    step: "step 8: read the first AudioTrackList history item",
    perform: moves.nextListItem,
    expected: "Supported since Chrome 37 behind a flag.",
  },
  {
    step: "step 8: read the AudioTrackList flag preference",
    perform: moves.nextListItem,
    expected: /enable-experimental-web-platform-features.*enabled/,
  },
  { step: "move down to preview_partial in Chrome", perform: moves.down },
  {
    step: "step 9: read removed_partial in Chrome",
    perform: moves.down,
    expected: "No support in Chrome",
  },
  expandStep(page, moves, "removed_partial"),
  {
    step: "step 9: read the removed_partial removal history",
    perform: moves.nextListItem,
    expected: "Partially supported from Chrome 11.1, removed in Chrome 12.1",
  },
  {
    step: "step 9: read the removed_partial note",
    perform: moves.nextListItem,
    expected: "Note: The initial implementation did not abort fetch requests",
  },
  { step: "move down to localName in Chrome", perform: moves.down },
  {
    step: "step 11: read localName in Opera",
    perform: moves.right,
    expected: "Supported since Opera 12.1 or earlier",
  },
  {
    step: "step 10: read missing_target in Opera",
    perform: moves.down,
    expected: "No data for Opera",
  },
  { step: "move down to unknown_runtime in Opera", perform: moves.down },
  {
    step: "step 10: read unknown_runtime in Node.js",
    perform: moves.right,
    expected: "Support unknown in Node.js",
  },
  ...["partial_only", "notes_only", "prefixed_only", "Array", "from"].map((feature) => ({
    step: `move down to ${feature} in Node.js`,
    perform: moves.down,
  })),
  { step: "move left to from in Opera", perform: moves.left },
  { step: "move left to from in Chrome", perform: moves.left },
  {
    step: "step 12: read the from row header",
    perform: moves.left,
    expected: /from.*\(part of Array\)/,
  },
  {
    step: "step 12: read the async_iterable row header",
    perform: moves.down,
    expected: /async_iterable.*\(part of Array\.from\)/,
  },
  ...enterTable(moves),
];

/**
 * Variant B, starting where the shared walk ends: NVDA's cursor on `Array` in Node.js, the
 * fourth body row. The shared walk's moves right along the `fit-content` row are already step 14.
 */
const variantBSteps = (page: Page, moves: Moves): ExtraStep[] => [
  { step: "move left to Array in Opera", perform: moves.left },
  {
    step: "step 13: read Array in Chrome",
    perform: moves.left,
    expected: "Supported since Chrome 1",
  },
  // Whether NVDA announces the ancestor row headers here is what step 13 asks. That is NVDA's
  // own behaviour, so only the cell's name is checked.
  {
    step: "step 13: move down to from in Chrome",
    perform: moves.down,
    expected: "Supported since Chrome 45",
  },
  {
    step: "step 13: move down to async_iterable in Chrome",
    perform: moves.down,
    expected: "Supported since Chrome 121",
  },
  ...["from", "Array", "preview_partial"].map((feature) => ({
    step: `move up to ${feature} in Chrome`,
    perform: moves.up,
  })),
  {
    step: "step 8: read AudioTrackList in Chrome",
    perform: moves.up,
    expected: "Supported since Chrome 37 behind a flag",
  },
  expandStep(page, moves, "AudioTrackList"),
  {
    step: "step 8: read the first AudioTrackList history item",
    perform: moves.nextListItem,
    expected: "Supported since Chrome 37 behind a flag.",
  },
  {
    step: "step 8: read the AudioTrackList flag preference",
    perform: moves.nextListItem,
    expected: /enable-experimental-web-platform-features.*enabled/,
  },
  ...enterTable(moves),
];

const extraStepsFor: Readonly<Record<string, (page: Page, moves: Moves) => ExtraStep[]>> = {
  "index.html": variantASteps,
  "headers-id.html": variantBSteps,
};

const extraSteps = (variant: Variant, page: Page, moves: Moves): ExtraStep[] => {
  const steps = extraStepsFor[variant.file];
  if (!steps) throw new Error(`No NVDA steps for ${variant.file}`);
  return steps(page, moves);
};

for (const variant of variants) {
  test(`NVDA walks ${variant.name}`, async ({ page, nvda }, testInfo) => {
    const moves = nvdaMoves(nvda);
    await walkTable(
      page,
      nvda,
      { right: moves.right, down: moves.down },
      variant,
      testInfo,
      // Document 7's step 3 expects the platform header on entering the Node.js column. Whether
      // NVDA says it, and in which words, is still to be learned from a run, so it is not checked.
      {},
      extraSteps(variant, page, moves),
    );
  });
}
