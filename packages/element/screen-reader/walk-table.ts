// The walk through the compatibility table that `<bcd-compat-table>` renders, shared by the
// VoiceOver, Orca and NVDA tests. It performs the same moves with each screen reader and records
// what was spoken after each one, so the transcripts can be compared step by step
// (docs/planning/07-component-phase1-markup.md). The page is the built fixture
// (`fixtures/component.html`), which `server.ts` serves.
import { writeFile } from "node:fs/promises";

import type { Page, TestInfo } from "@playwright/test";
import { expect } from "@playwright/test";

import { en } from "../src/strings/en.js";
import { formatMessage } from "../src/strings/format.js";

import { fixturePath } from "./server.js";

/** The part of a screen reader that the walk uses. VoiceOver, Orca and NVDA all provide it. */
export type Reader = {
  navigateToWebContent(): Promise<void>;
  press(key: string, options?: { capture: true }): Promise<void>;
  spokenPhraseLog(): Promise<string[]>;
  clearSpokenPhraseLog(): Promise<void>;
  itemText(): Promise<string>;
};

/** How one screen reader moves between table cells. */
export type TableMoves = {
  right(): Promise<void>;
  down(): Promise<void>;
};

/** What the transcript's log line calls the page. */
const fixtureName = "the component fixture";

/**
 * A step that one screen reader performs after the shared walk, so that what it says lands in the
 * same transcript. Step names must be unique within a walk, because the soft checks find a step's
 * output by its name.
 */
export type ExtraStep = {
  step: string;
  perform(): Promise<void>;
  /**
   * A check on the page, made after the step is recorded. It must use `expect.soft`, so that a
   * mismatch fails the test but the remaining steps still run and reach the transcript. It never
   * checks what was spoken.
   */
  check?(): Promise<void>;
  /**
   * What the screen reader should say, checked softly. Write it from the screen reader's wording
   * as a transcript recorded it, or from the markup's own text where no transcript exists yet.
   * Leave it out where the wording can only be learned from a run: the step is then performed for
   * its transcript alone.
   */
  expected?: string | RegExp;
};

type Step = { step: string; spoken: string; item: string };

/**
 * Walks the table and attaches the transcript to the test. The shared walk's checks on the page
 * (which element has focus, whether the disclosure is open) are hard failures, because every later
 * shared move depends on them. The extra steps' page checks and all checks on what was spoken are
 * soft, so a mismatch still leaves a complete transcript to read. Each step is recorded before its
 * page check, so a failed check still leaves that step's output in the transcript.
 * `readerSpecific` maps a step to a phrase that only this screen reader is expected to say there,
 * checked in addition to the shared checks. `more.sharedWording` instead replaces the shared check
 * for each step it names, for a screen reader whose real wording differs from the markup's text,
 * as NVDA's "Node dot js" differs from "Node.js". `more.extraSteps` run after the shared walk, in
 * order.
 */
export async function walkTable(
  page: Page,
  reader: Reader,
  moves: TableMoves,
  testInfo: TestInfo,
  readerSpecific: Readonly<Record<string, string>>,
  more: { extraSteps?: readonly ExtraStep[]; sharedWording?: Wording } = {},
): Promise<void> {
  const { extraSteps = [], sharedWording = {} } = more;
  // `heard()` finds a step's output by its name, so a repeated name would check the wrong step.
  const extraNames = extraSteps.map(({ step }) => step);
  const repeated = extraNames.filter((name, index) => extraNames.indexOf(name) !== index);
  if (repeated.length > 0) throw new Error(`Extra step names repeat: ${repeated.join(", ")}`);

  const transcript: Step[] = [];
  const record = async (step: string) => {
    // Everything spoken since the last recorded step. Orca echoes the key first ("tab"), so the
    // last phrase alone would miss what it says about the item.
    transcript.push({
      step,
      spoken: (await reader.spokenPhraseLog()).join(" | "),
      item: await reader.itemText(),
    });
    await reader.clearSpokenPhraseLog();
  };
  // `capture: true` keeps listening until the screen reader goes quiet.
  const press = (key: string) => reader.press(key, { capture: true });
  const firstSummary = page.locator("summary").first();
  const firstDetails = page.locator("details").first();

  try {
    // The path is relative to the `baseURL` of the config, which points at the preview server.
    await page.goto(fixturePath);
    // The table is in the page once the element has set `loaded`, which also hides the fallback.
    // The timeout is short so that a page that fails to render fails here, not after the test's
    // ten minutes.
    await page.locator("bcd-compat-table[loaded]").getByRole("table").waitFor({ timeout: 30_000 });
    await reader.navigateToWebContent();

    await reader.clearSpokenPhraseLog();

    // Tab to the scroll region. The page has no link before it, but an engine may stop on
    // something else first, so the walk allows a few presses before it gives up.
    const region = page.getByRole("region");
    for (let presses = 0; presses < 3; presses += 1) {
      await press("Tab");
      if (await region.evaluate((element) => element === document.activeElement)) break;
      await reader.clearSpokenPhraseLog();
    }
    await record("Tab to the scroll region");
    await expect(region).toBeFocused();

    // Every later move is made with the keyboard or the screen reader, never by the page: in
    // WebKit, VoiceOver's cursor does not follow a focus change that a script makes.
    await press("Tab");
    await record("Tab to the fit-content cell in Chrome");
    await expect(firstSummary).toBeFocused();

    await press("Enter");
    await record("open the fit-content disclosure");
    await expect(firstDetails).toHaveJSProperty("open", true);
    await expect(firstSummary).toBeFocused();

    await press("Enter");
    await record("close the fit-content disclosure");
    await expect(firstDetails).toHaveJSProperty("open", false);
    await expect(firstSummary).toBeFocused();

    await moves.right();
    await record("move right to Opera");
    await moves.right();
    await record("move right to Node.js");
    for (const row of [2, 3, 4]) {
      await moves.down();
      await record(`move down the Node.js column to row ${row}`);
    }

    for (const extra of extraSteps) {
      await extra.perform();
      await record(extra.step);
      await extra.check?.();
    }
  } finally {
    const json = JSON.stringify(transcript, null, 2);
    // Printed first, so the transcript is in the job log even if writing the file fails.
    console.log(`Transcript, ${fixtureName}:\n${json}`);
    // Written to the test's output directory, which the workflow uploads as an artifact on a pass
    // and on a failure. An attachment given as a `body` is not written there as a file: after a
    // pass it reaches only the reporters, and after a failure it is only inside `trace.zip`.
    try {
      const transcriptPath = testInfo.outputPath("transcript.json");
      await writeFile(transcriptPath, json);
      await testInfo.attach("transcript.json", {
        path: transcriptPath,
        contentType: "application/json",
      });
    } catch (error) {
      // Logged rather than thrown, so a failed write never hides the walk's own error.
      console.error(`Could not save the transcript for ${fixtureName}:`, error);
    }
  }

  const heard = (step: string) => {
    const entry = transcript.find((candidate) => candidate.step === step);
    return `${entry?.spoken ?? ""} ${entry?.item ?? ""}`;
  };
  const check = (step: string, expected: string | RegExp) => {
    if (typeof expected === "string") expect.soft(heard(step), step).toContain(expected);
    else expect.soft(heard(step), step).toMatch(expected);
  };
  for (const [step, expected] of Object.entries({ ...sharedChecks, ...sharedWording })) {
    check(step, expected);
  }
  // Checked for every screen reader, including one whose `sharedWording` replaces the step's
  // other check: each one speaks the cell's sentence in its own words around it.
  check("Tab to the fit-content cell in Chrome", firstCellSummary);
  for (const [step, expected] of Object.entries(readerSpecific)) check(step, expected);
  for (const { step, expected } of extraSteps) if (expected) check(step, expected);
}

/** What a screen reader should say at each named step: a phrase it contains, or a pattern. */
export type Wording = Readonly<Record<string, string | RegExp>>;

/**
 * The summary of the first cell, `fit-content` in Chrome, as the string table builds it: the
 * cell's fact and its label joined by `disclosure-summary`. The walk reads the table, so the
 * sentence is written once, in `strings/en.ts`, and a change to either message changes the check.
 * The target, version and feature are the first row of the adversarial fixture
 * (`packages/schema/src/fixtures/v1.ts`).
 */
export const firstCellSummary = formatMessage(en, "disclosure-summary", {
  fact: formatMessage(en, "supported-since", { target: "Chrome", version: "46" }),
  label: formatMessage(en, "disclosure-history", { feature: "fit-content", target: "Chrome" }),
});

/** The shared walk's soft checks, written from the markup's own text. */
const sharedChecks: Wording = {
  "Tab to the scroll region": "Browser compatibility",
  "open the fit-content disclosure": /expanded/i,
  "close the fit-content disclosure": /collapsed/i,
  "move right to Opera": "No data for Opera",
  "move right to Node.js": "No data for Node.js",
};
