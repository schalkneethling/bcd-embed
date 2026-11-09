// The Phase 1 walk through a compatibility table, shared by the VoiceOver and Orca tests. It
// performs the same moves with either screen reader and records what was spoken after each one,
// so the two transcripts can be compared step by step (docs/planning/07-component-phase1-markup.md).
import type { Page, TestInfo } from "@playwright/test";
import { expect } from "@playwright/test";

/** The part of a screen reader that the walk uses. VoiceOver and Orca both provide it. */
export type Reader = {
  navigateToWebContent(): Promise<void>;
  press(key: string): Promise<void>;
  lastSpokenPhrase(): Promise<string>;
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
 * soft, so a wording difference still leaves a complete transcript to read.
 */
export async function walkTable(
  page: Page,
  reader: Reader,
  moves: TableMoves,
  variant: Variant,
  testInfo: TestInfo,
): Promise<void> {
  const transcript: Step[] = [];
  const record = async (step: string) => {
    transcript.push({
      step,
      spoken: await reader.lastSpokenPhrase(),
      item: await reader.itemText(),
    });
  };

  try {
    await page.goto(pageUrl(variant.file));
    await page.getByRole("table").waitFor();
    await reader.navigateToWebContent();

    // Keyboard focus moves the screen reader to a known cell: fit-content in Chrome.
    const firstSummary = page.locator("summary").first();
    await firstSummary.focus();
    await record("focus the fit-content cell in Chrome");

    await moves.right();
    await record("move right to Opera");
    await moves.right();
    await record("move right to Node.js");
    for (const row of [2, 3, 4]) {
      await moves.down();
      await record(`move down the Node.js column to row ${row}`);
    }

    await firstSummary.focus();
    await reader.press("Enter");
    await record("open the fit-content disclosure");
    await expect(page.locator("details").first()).toHaveJSProperty("open", true);
    await expect(firstSummary).toBeFocused();

    await reader.press("Enter");
    await record("close the fit-content disclosure");
    await expect(page.locator("details").first()).toHaveJSProperty("open", false);
    await expect(firstSummary).toBeFocused();

    await page.getByRole("region").focus();
    await record("focus the scroll region");
    await reader.press("Tab");
    await record("Tab from the scroll region");
    await expect(firstSummary).toBeFocused();
    await reader.press("Tab");
    await record("Tab again");
    await expect(page.locator("summary").nth(1)).toBeFocused();
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
  expect.soft(heard("focus the fit-content cell in Chrome")).toContain("Supported since Chrome 46");
  expect.soft(heard("move right to Opera")).toContain("No data for Opera");
  expect.soft(heard("move right to Node.js")).toContain("No data for Node.js");
  // Question 1 of the Phase 1 document: is the platform header announced on entering its column?
  expect.soft(heard("move right to Node.js")).toContain("Server");
  expect.soft(heard("focus the scroll region")).toContain("Browser compatibility");
}
