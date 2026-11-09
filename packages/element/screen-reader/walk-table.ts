// The Phase 1 walk through a compatibility table, shared by the VoiceOver and Orca tests. It
// performs the same moves with either screen reader and records what was spoken after each one,
// so the two transcripts can be compared step by step (docs/planning/07-component-phase1-markup.md).
import type { Page, TestInfo } from "@playwright/test";
import { expect } from "@playwright/test";

/** The part of a screen reader that the walk uses. VoiceOver and Orca both provide it. */
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

type Step = { step: string; spoken: string; item: string };

const pageUrl = (file: string) =>
  new URL(`../../../docs/planning/phase1-markup/${file}`, import.meta.url).href;

/**
 * Walks the table and attaches the transcript to the test. The checks on the page (which element
 * has focus, whether the disclosure is open) are hard failures. The checks on what was spoken are
 * soft, so a wording difference still leaves a complete transcript to read. `readerSpecific`
 * maps a step to a phrase that only this screen reader is expected to say there.
 */
export async function walkTable(
  page: Page,
  reader: Reader,
  moves: TableMoves,
  variant: Variant,
  testInfo: TestInfo,
  readerSpecific: Readonly<Record<string, string>>,
): Promise<void> {
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
    await expect(region).toBeFocused();
    await record("Tab to the scroll region");

    // Every later move is made with the keyboard or the screen reader, never by the page: in
    // WebKit, VoiceOver's cursor does not follow a focus change that a script makes.
    await press("Tab");
    await expect(firstSummary).toBeFocused();
    await record("Tab to the fit-content cell in Chrome");

    await press("Enter");
    await expect(firstDetails).toHaveJSProperty("open", true);
    await expect(firstSummary).toBeFocused();
    await record("open the fit-content disclosure");

    await press("Enter");
    await expect(firstDetails).toHaveJSProperty("open", false);
    await expect(firstSummary).toBeFocused();
    await record("close the fit-content disclosure");

    await moves.right();
    await record("move right to Opera");
    await moves.right();
    await record("move right to Node.js");
    for (const row of [2, 3, 4]) {
      await moves.down();
      await record(`move down the Node.js column to row ${row}`);
    }

    // Which disclosure comes next differs: Firefox tabs on from the cell that Orca's table
    // navigation moved to, and WebKit from the summary that still has focus.
    await press("Tab");
    await expect(page.locator("summary:focus")).toHaveCount(1);
    await record("Tab to the next disclosure");
  } finally {
    await testInfo.attach("transcript.json", {
      body: JSON.stringify(transcript, null, 2),
      contentType: "application/json",
    });
    // Printed as well, so the transcript is in the job log without downloading the artifact.
    console.log(`Transcript, ${variant.name}:\n${JSON.stringify(transcript, null, 2)}`);
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
}
