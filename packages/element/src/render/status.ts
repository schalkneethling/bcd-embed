import { html, nothing } from "lit";
import type { TemplateResult } from "lit";

import type { TableCell } from "../model/table-model.js";

/**
 * The compact status of a cell: an icon and the short version text that a sighted reader sees
 * beside it. The span carries `aria-hidden="true"` and `hidden`, so assistive technology reads the
 * cell's full sentence instead, and so does a page with no stylesheet (Document 3 section 5). The
 * base stylesheet gives the span its `display` back.
 *
 * The icons are inline SVG, drawn for this project on a 24 by 24 grid as strokes in
 * `currentColor`. They are not taken from an icon library. Inline SVG keeps the icon's shape in
 * forced colours, where the browser replaces `color` with a system colour and the stroke follows
 * it, and in print, where background images are often left out. It also needs no URL, so a page's
 * Content Security Policy cannot block it. The icon has no `<title>`, because the span around it
 * is already hidden from assistive technology, and the cell's sentence carries the meaning.
 */

/** The icon a cell shows. Every support state has its own, and so does support behind a flag. */
export type StatusIcon =
  | "supported"
  | "partial"
  | "preview"
  | "flagged"
  | "unsupported"
  | "unknown"
  | "no-data";

/**
 * The path data of each icon. Each icon is a single `<path>`, so it adds two elements to a cell.
 * A test checks that no two icons share path data.
 */
export const ICON_PATHS: Readonly<Record<StatusIcon, string>> = {
  // A check mark.
  supported: "M4.5 12.5l5 5L19.5 7",
  // A circle split down the middle: half of it is there.
  partial: "M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16zM12 4v16",
  // A laboratory flask: support in a preview release.
  preview:
    "M9.5 3.5h5M10.5 3.5v6L5.5 18a1.75 1.75 0 0 0 1.5 2.5h10a1.75 1.75 0 0 0 1.5-2.5l-5-8.5v-6",
  // A flag on a pole.
  flagged: "M6 20.5v-17M6 4h11l-2.5 4.25L17 12.5H6",
  // A cross.
  unsupported: "M6 6l12 12M18 6L6 18",
  // A question mark, with its dot drawn as a stroke of almost no length and a round cap.
  unknown: "M9 9.5a3 3 0 1 1 4.25 2.75c-.75.35-1.25 1-1.25 1.75v.5M12 18.5v.01",
  // A dash: there is nothing to say.
  "no-data": "M6 12h12",
};

/** The class every icon carries, and the prefix of the class that names its state. */
export const ICON_CLASS = "bcd-icon";

/** Marks a cell whose summary has notes. The notes themselves are in the cell's disclosure. */
const NOTES_MARKER = "*";

type CellStatus = Pick<TableCell, "state" | "behindFlag" | "partialImplementation">;

/**
 * Chooses the icon for a cell from the summary's state and modifiers, as the payload gives them.
 * A partial preview shows the partial icon even behind a flag, which matches the cell's sentence:
 * in a preview state the sentence names the partial support and leaves the flag to the disclosure.
 * A full preview behind a flag shows the flag, as its sentence leads with the flag. O(1) time and
 * space.
 */
export const statusIcon = (cell: CellStatus): StatusIcon => {
  if (cell.state === "no-data") return "no-data";
  if (cell.state === "unknown") return "unknown";
  if (cell.state === "unsupported") return "unsupported";
  if (cell.state === "preview" && cell.partialImplementation) return "partial";
  if (cell.behindFlag) return "flagged";
  if (cell.state === "preview") return "preview";
  if (cell.state === "partial" || cell.partialImplementation) return "partial";
  return "supported";
};

/**
 * Renders the compact span: the icon, the version text, the prefix or alternative name as code,
 * and the notes marker. A summary with a prefix shows the prefix, and otherwise its alternative
 * name. O(1) elements: the span, the icon's `<svg>` and `<path>`, and one `<code>` when there is a
 * prefix or an alternative name.
 *
 * The `width` and `height` of `1em` and the stroke attributes are presentation attributes, so an
 * author who shows the span with their own stylesheet gets an icon at text size, and any CSS rule,
 * the base stylesheet's included, overrides them.
 */
export const renderCompactStatus = (cell: TableCell): TemplateResult => {
  const { text, prefix, alternativeName, hasNotes } = cell.compact;
  const identity = prefix ?? alternativeName;
  const icon = statusIcon(cell);
  // prettier-ignore
  return html`<span aria-hidden="true" hidden><svg class=${`${ICON_CLASS} ${ICON_CLASS}-${icon}`} viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d=${ICON_PATHS[icon]}></path></svg>${
    text === null ? nothing : ` ${text}`}${
    identity === null ? nothing : html` <code>${identity}</code>`}${
    hasNotes ? ` ${NOTES_MARKER}` : nothing}</span>`;
};
