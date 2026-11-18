// The Phase 1 walk through a compatibility table, shared by the VoiceOver, Orca and NVDA tests.
// It performs the same moves with each screen reader and records what was spoken after each one,
// so the transcripts can be compared step by step (docs/planning/07-component-phase1-markup.md).
import { writeFile } from "node:fs/promises";

import type { Page, TestInfo } from "@playwright/test";
import { expect } from "@playwright/test";

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

export type Variant = { name: string; file: string };

export const variants: readonly Variant[] = [
  { name: "variant A (scope)", file: "index.html" },
  { name: "variant B (headers and id)", file: "headers-id.html" },
];

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
   * What the screen reader should say, checked softly. Only text that the markup defines, such as
   * a cell's accessible name, belongs here. Leave it out where the wording is the screen reader's
   * own and can only be learned from a run: the step is then performed for its transcript alone.
   */
  expected?: string | RegExp;
};

type Step = { step: string; spoken: string; item: string };

const pageUrl = (file: string) =>
  new URL(`../../../docs/planning/phase1-markup/${file}`, import.meta.url).href;

/**
 * Walks the table and attaches the transcript to the test. The shared walk's checks on the page
 * (which element has focus, whether the disclosure is open) are hard failures, because every later
 * shared move depends on them. The extra steps' page checks and all checks on what was spoken are
 * soft, so a mismatch still leaves a complete transcript to read. Each step is recorded before its
 * page check, so a failed check still leaves that step's output in the transcript.
 * `readerSpecific` maps a step to a phrase that only this screen reader is expected to say there.
 * `extraSteps` run after the shared walk, in order.
 */
export async function walkTable(
  page: Page,
  reader: Reader,
  moves: TableMoves,
  variant: Variant,
  testInfo: TestInfo,
  readerSpecific: Readonly<Record<string, string>>,
  extraSteps: readonly ExtraStep[] = [],
): Promise<void> {
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
    await page.goto(pageUrl(variant.file));
    await page.getByRole("table").waitFor();
    await reader.navigateToWebContent();

    await reader.clearSpokenPhraseLog();

    // Tab to the scroll region. Firefox stops on the link in the introduction first. WebKit does
    // not, because Safari leaves links out of the tab order by default.
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
    console.log(`Transcript, ${variant.name}:\n${json}`);
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
      console.error(`Could not save the transcript for ${variant.name}:`, error);
    }
  }

  const heard = (step: string) => {
    const entry = transcript.find((candidate) => candidate.step === step);
    return `${entry?.spoken ?? ""} ${entry?.item ?? ""}`;
  };
  expect.soft(heard("Tab to the scroll region")).toContain("Browser compatibility");
  expect
    .soft(heard("Tab to the fit-content cell in Chrome"))
    .toContain("Supported since Chrome 46");
  expect.soft(heard("open the fit-content disclosure")).toMatch(/expanded/i);
  expect.soft(heard("close the fit-content disclosure")).toMatch(/collapsed/i);
  expect.soft(heard("move right to Opera")).toContain("No data for Opera");
  expect.soft(heard("move right to Node.js")).toContain("No data for Node.js");
  for (const [step, expected] of Object.entries(readerSpecific)) {
    expect.soft(heard(step), step).toContain(expected);
  }
  for (const { step, expected } of extraSteps) {
    if (typeof expected === "string") expect.soft(heard(step), step).toContain(expected);
    else if (expected) expect.soft(heard(step), step).toMatch(expected);
  }
}
