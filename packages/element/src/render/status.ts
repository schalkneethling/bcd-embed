import { html, nothing } from "lit";
import type { TemplateResult } from "lit";

import type { TableCell } from "../model/table-model.js";

/**
 * The compact status of a cell: a glyph and the short version text that a sighted reader sees
 * beside it. The span carries `aria-hidden="true"` and `hidden`, so assistive technology reads the
 * cell's full sentence instead, and so does a page with no stylesheet (Document 3 section 5). The
 * base stylesheet gives the span its `display` back.
 *
 * The glyphs are the placeholders of the Phase 1 markup
 * (`docs/planning/phase1-markup/index.html`). Phase 3 replaces them with icons. They are symbols,
 * not sentences, and nothing reads them aloud, so they are not messages in the string table.
 */
const GLYPHS = {
  supported: "✓",
  unsupported: "✕",
  partial: "◐",
  flagged: "⚑",
  unknown: "?",
  noData: "—",
} as const;

/** Marks a cell whose summary has notes. The notes themselves are in the cell's disclosure. */
const NOTES_MARKER = "*";

type CellStatus = Pick<TableCell, "state" | "behindFlag" | "partialImplementation">;

/**
 * Chooses the glyph for a cell from the summary's state and modifiers, as the payload gives them.
 * A partial preview shows the partial glyph even behind a flag, which matches the cell's sentence:
 * in a preview state the sentence names the partial support and leaves the flag to the disclosure.
 * O(1) time and space.
 */
export const statusGlyph = (cell: CellStatus): string => {
  if (cell.state === "no-data") return GLYPHS.noData;
  if (cell.state === "unknown") return GLYPHS.unknown;
  if (cell.state === "unsupported") return GLYPHS.unsupported;
  if (cell.state === "preview" && cell.partialImplementation) return GLYPHS.partial;
  if (cell.behindFlag) return GLYPHS.flagged;
  if (cell.state === "partial" || cell.partialImplementation) return GLYPHS.partial;
  return GLYPHS.supported;
};

/**
 * Renders the compact span: the glyph, the version text, the prefix or alternative name as code,
 * and the notes marker. A summary with a prefix shows the prefix, and otherwise its alternative
 * name. O(1) elements: one span, and one `<code>` when there is a prefix or an alternative name.
 */
export const renderCompactStatus = (cell: TableCell): TemplateResult => {
  const { text, prefix, alternativeName, hasNotes } = cell.compact;
  const identity = prefix ?? alternativeName;
  // prettier-ignore
  return html`<span aria-hidden="true" hidden>${statusGlyph(cell)}${
    text === null ? nothing : ` ${text}`}${
    identity === null ? nothing : html` <code>${identity}</code>`}${
    hasNotes ? ` ${NOTES_MARKER}` : nothing}</span>`;
};
