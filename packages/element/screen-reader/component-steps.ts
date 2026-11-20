// Document 7's steps 8 to 12, performed by VoiceOver and Orca after the shared walk
// (docs/planning/07-component-phase1-markup.md). NVDA performs the same steps in `table.nvda.ts`
// with its own moves and its own recorded wording.
//
// No VoiceOver or Orca transcript of these cells exists yet, so the expectations here are not
// recordings. Each is the cell's own sentence, built from the string table the element renders
// with (`src/strings/en.ts`): the screen reader reads a cell's accessible name, so the sentence
// must be somewhere in what it says, among its own words for the role and state. The checks are
// soft and use only the fact, never the label, so that a different order of the screen reader's
// extra words does not fail them. The first CI transcripts for these steps replace each derived
// expectation with the recorded phrase. A step with no expectation is performed for its
// transcript alone, because only a run can show how the reader says it.
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

import { en } from "../src/strings/en.js";
import { formatMessage } from "../src/strings/format.js";

import type { ExtraStep, TableMoves } from "./walk-table.js";

/** The moves the extra steps need, which VoiceOver and Orca both provide. */
export type CellMoves = TableMoves & {
  up(): Promise<void>;
  left(): Promise<void>;
  /** Activates the item under the screen reader's cursor, which opens or closes a disclosure. */
  activate(): Promise<void>;
};

/** The disclosure in the row whose header contains `feature`. */
export const disclosureIn = (page: Page, feature: string) =>
  page
    .locator("tbody tr")
    .filter({ has: page.locator("th", { hasText: feature }) })
    .locator("details");

/**
 * Opens a cell's disclosure and, when `close` is set, closes it again, as the shared walk does
 * with the first one. Orca needs the close: it enters Focus mode on the summary, and the walk's
 * later table moves answered "Not in a table" until a second Return toggled the summary back.
 */
const expandSteps = (
  page: Page,
  moves: CellMoves,
  feature: string,
  close: boolean,
): ExtraStep[] => [
  {
    step: `expand ${feature} in Chrome`,
    perform: moves.activate,
    // Soft, so that a disclosure the screen reader fails to open still leaves the later steps in
    // the transcript.
    check: () => expect.soft(disclosureIn(page, feature)).toHaveJSProperty("open", true),
  },
  ...(close
    ? [
        {
          step: `close ${feature} in Chrome`,
          perform: moves.activate,
          check: () => expect.soft(disclosureIn(page, feature)).toHaveJSProperty("open", false),
        },
      ]
    : []),
];

/**
 * The cells' sentences, from the string table. The targets, versions and feature names are those
 * of the adversarial fixture (`packages/schema/src/fixtures/v1.ts`).
 */
const sentences = {
  // Step 8: `AudioTrackList` in Chrome, supported behind a flag.
  flagged: formatMessage(en, "supported-flagged", { target: "Chrome", version: "37" }),
  // Step 9: `removed_partial` in Chrome, added and then removed.
  removed: formatMessage(en, "supported-removed", {
    target: "Chrome",
    added: "11.1",
    removed: "12.1",
  }),
  // Step 10: `unknown_runtime` in Node.js, where BCD records the support as unknown, and
  // `missing_target` in Opera, where BCD has no entry.
  unknown: formatMessage(en, "unknown", { target: "Node.js" }),
  missing: formatMessage(en, "no-data", { target: "Opera" }),
  // Step 11: `localName` in Opera, supported since an approximate version.
  orEarlier: formatMessage(en, "supported-since-or-earlier", { target: "Opera", version: "12.1" }),
};

/**
 * The steps, starting where the shared walk ends: the cursor on `preview_partial` in Node.js, the
 * fourth body row.
 */
export const componentSteps = (
  page: Page,
  moves: CellMoves,
  { closeDisclosures }: { closeDisclosures: boolean },
): ExtraStep[] => [
  { step: "move up to AudioTrackList in Node.js", perform: moves.up },
  { step: "move left to AudioTrackList in Opera", perform: moves.left },
  {
    step: "step 8: read AudioTrackList in Chrome",
    perform: moves.left,
    expected: sentences.flagged,
  },
  ...expandSteps(page, moves, "AudioTrackList", closeDisclosures),
  { step: "move down to preview_partial in Chrome", perform: moves.down },
  {
    step: "step 9: read removed_partial in Chrome",
    perform: moves.down,
    expected: sentences.removed,
  },
  ...expandSteps(page, moves, "removed_partial", closeDisclosures),
  { step: "move down to localName in Chrome", perform: moves.down },
  {
    step: "step 11: read localName in Opera",
    perform: moves.right,
    expected: sentences.orEarlier,
  },
  {
    step: "step 10: read missing_target in Opera",
    perform: moves.down,
    expected: sentences.missing,
  },
  { step: "move down to unknown_runtime in Opera", perform: moves.down },
  {
    step: "step 10: read unknown_runtime in Node.js",
    perform: moves.right,
    expected: sentences.unknown,
  },
  ...["partial_only", "notes_only", "prefixed_only", "Array", "from"].map((feature): ExtraStep => ({
    step: `move down to ${feature} in Node.js`,
    perform: moves.down,
  })),
  { step: "move left to from in Opera", perform: moves.left },
  { step: "move left to from in Chrome", perform: moves.left },
  // Step 12: the nested row headers. Their wording is for a person to review, so no check.
  { step: "step 12: read the from row header", perform: moves.left },
  { step: "step 12: read the async_iterable row header", perform: moves.down },
];
