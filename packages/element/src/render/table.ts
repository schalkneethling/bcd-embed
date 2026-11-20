import { html, nothing } from "lit";
import type { TemplateResult } from "lit";
import { repeat } from "lit/directives/repeat.js";

import type { NoteInline, NoteSegment } from "../model/note.js";
import type { HistoryItem, TableCell, TableModel, TableRow } from "../model/table-model.js";
import { formatMessageToParts } from "../strings/format.js";
import type { StringTable } from "../strings/format.js";
import { renderCompactStatus } from "./status.js";

/**
 * Maps a table model to the markup that Phase 1 validated
 * (`docs/planning/phase1-markup/index.html`, variant A: headers associated by `scope`). The model
 * has already made every decision about what a cell says, so this module only chooses elements
 * and attributes. Every value reaches the page through a Lit text or attribute binding, which
 * never parses it as markup, so nothing in a payload can become an element or a script.
 *
 * Cost. Let F be the number of rows, T the number of displayed targets, L the number of history
 * lines (a statement's sentences, flags, and notes), and E the number of code, emphasis, and link
 * segments in the notes.
 *
 * - Time is O(F × T + L + E + C), where C is the number of characters in the rendered text. Each
 *   row, cell, history line, and note segment is visited once, and each history line's message is
 *   split into parts once, in time proportional to its length. Giving each row a key adds one
 *   set lookup for each row, which is O(F) time and space.
 * - The number of elements is at most 9 + 3T + 4F + 7 × F × T + 3L + E. The header takes 9 + 3T: the
 *   scroll region, the table, the caption, the feature column's `<colgroup>`, the `<thead>`, its
 *   two rows, the feature header, and the `<tbody>`, then at most one `<colgroup>`, one group
 *   header, and one target header for each target. A row takes 4: the `<tr>`, the `<th>`, the
 *   `<code>`, and the `part-of` span. A cell takes at most 7: the `<td>`, the two spans, the
 *   compact `<code>`, the `<details>`, the `<summary>`, and the `<ul>`. A history line takes at
 *   most 3: the `<li>`, and either the `<bdi>` of a note or a `<code>` for each of its values
 *   that is marked up as code. No message has more than two such values, which a test checks. A
 *   browser test counts the elements of a 2,000-row table against this bound.
 */

const CLASS_NAMES = {
  scroller: "bcd-scroller",
  table: "bcd-table",
  feature: "bcd-feature",
  featureDepth: "bcd-feature-depth-",
  history: "bcd-history",
  historyList: "bcd-history-list",
  visuallyHidden: "visually-hidden",
} as const;

/**
 * The placeholders whose values are identifiers a reader may have to type: a prefix, an
 * alternative name, a flag's name, and a flag's value. A history line marks them up as code.
 */
export const CODE_VALUES: ReadonlySet<string> = new Set(["prefix", "name", "value"]);

/** The placeholder of the `note` message that receives the note's segments. */
const NOTE_TEXT_VALUE = "text";

/** A `span` or `colspan` value: the count, or no attribute at all for a single column. */
const spanOf = (count: number): number | typeof nothing => (count > 1 ? count : nothing);

const renderInline = (segment: NoteInline): TemplateResult | string => {
  if (segment.kind === "code") return html`<code>${segment.text}</code>`;
  if (segment.kind === "emphasis") return html`<em>${segment.text}</em>`;
  return segment.text;
};

/**
 * Renders one note segment. A link's address comes from `parseNote`, which keeps only addresses
 * that start with `https://`, and the attribute binding sets it without decoding it again.
 */
const renderSegment = (segment: NoteSegment): TemplateResult | string =>
  segment.kind === "link"
    ? html`<a href=${segment.href}>${segment.children.map(renderInline)}</a>`
    : renderInline(segment);

/**
 * Renders one history line. The message is split into its words and its values, so a value can
 * be marked up without joining pieces of a sentence here. Neighbouring pieces of plain text are
 * merged, so a line with no markup is one text node. A note's segments sit inside `<bdi>`, which
 * isolates the note's text direction: a note that contains bidirectional control characters
 * cannot reorder the words around it.
 */
const renderHistoryItem = (strings: StringTable, item: HistoryItem): TemplateResult => {
  const content: (TemplateResult | string)[] = [];
  let text = "";
  const flushText = () => {
    if (text !== "") content.push(text);
    text = "";
  };
  for (const part of formatMessageToParts(strings, item.message.id, item.message.values)) {
    if (part.kind === "value" && part.name === NOTE_TEXT_VALUE && item.note !== null) {
      flushText();
      content.push(html`<bdi>${item.note.map(renderSegment)}</bdi>`);
    } else if (part.kind === "value" && CODE_VALUES.has(part.name)) {
      flushText();
      content.push(html`<code>${part.text}</code>`);
    } else {
      text += part.text;
    }
  }
  flushText();
  return html`<li>${content}</li>`;
};

/**
 * Rows are keyed by their feature key, and a row's cells by their target. Lit then keeps a row's
 * elements with the same feature when the table renders again, so a disclosure a reader opened
 * stays with its own cell when `browsers` adds a column, and never ends up open on another cell.
 * Lit's `repeat` needs keys that are unique, and a malformed payload can repeat a feature key, so
 * a repeated key gets its row's position added. Targets are already unique, because the model
 * drops a repeated target. O(F) time and space for F rows.
 */
const rowKeys = (rows: readonly TableRow[]): string[] => {
  const seen = new Set<string>();
  return rows.map((row, index) => {
    const key = seen.has(row.key) ? `${row.key} ${index}` : row.key;
    seen.add(key);
    return key;
  });
};

/**
 * Renders one cell. A cell with a disclosure is a native `<details>` whose `<summary>` holds the
 * cell's sentence and the label that names the cell. Any other cell is plain text and takes no
 * tab stop.
 */
const renderCell = (strings: StringTable, cell: TableCell): TemplateResult => {
  const compact = renderCompactStatus(cell);
  const { disclosure } = cell;
  if (disclosure === null) {
    // prettier-ignore
    return html`<td>${compact}<span class=${CLASS_NAMES.visuallyHidden}>${cell.name.text}</span></td>`;
  }
  // prettier-ignore
  return html`<td><details class=${CLASS_NAMES.history}><summary>${compact}<span class=${CLASS_NAMES.visuallyHidden}>${disclosure.summary.text}</span></summary><ul class=${CLASS_NAMES.historyList}>${
    disclosure.items.map((item) => renderHistoryItem(strings, item))}</ul></details></td>`;
};

const renderRow = (strings: StringTable, row: TableRow): TemplateResult => {
  const className =
    row.depth === 0
      ? CLASS_NAMES.feature
      : `${CLASS_NAMES.feature} ${CLASS_NAMES.featureDepth}${row.depth}`;
  // prettier-ignore
  return html`<tr><th scope="row" class=${className}><code>${row.name}</code>${
    row.partOf === null
      ? nothing
      : html` <span class=${CLASS_NAMES.visuallyHidden}>${row.partOf.text}</span>`}</th>${
    repeat(
      row.cells,
      (cell) => cell.target,
      (cell) => renderCell(strings, cell),
    )}</tr>`;
};

/**
 * Renders the scroll region and the table inside it.
 *
 * @param strings The string table that built `model`, so a history line splits the same template.
 * @param captionId An id that is unique in the document. The region is named by the caption.
 */
export const renderTable = (
  model: TableModel,
  strings: StringTable,
  captionId: string,
): TemplateResult => {
  const keys = rowKeys(model.rows);
  // prettier-ignore
  return html`<div class=${CLASS_NAMES.scroller} role="region" aria-labelledby=${captionId} tabindex="0"><table class=${CLASS_NAMES.table}><caption id=${captionId}>${model.caption.text}</caption><colgroup></colgroup>${
    model.groups.map((group) => html`<colgroup span=${spanOf(group.columns.length)}></colgroup>`)
  }<thead><tr><th scope="col" rowspan="2">${model.featureHeader.text}</th>${
    model.groups.map(
      (group) =>
        html`<th scope="colgroup" colspan=${spanOf(group.columns.length)}>${group.label.text}</th>`,
    )
  }</tr><tr>${
    model.columns.map((column) => html`<th scope="col">${column.name}</th>`)
  }</tr></thead><tbody>${
    repeat(
      model.rows,
      (_row, index) => keys[index],
      (row) => renderRow(strings, row),
    )
  }</tbody></table></div>`;
};
