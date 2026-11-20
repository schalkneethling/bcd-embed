/**
 * The table model: a pure function from a payload and the element's options to the table's
 * column groups, columns, rows, cells, and sentences. It has no DOM and no Lit, so it runs in Node
 * and the renderer only maps it to markup. The display rules are Document 3 sections 4 and 5, and
 * the target output is the Phase 1 markup in `docs/planning/phase1-markup/`.
 *
 * Cost. Let F be the number of features, T the number of displayed targets, and S the number of
 * support statements in the displayed cells, counting each statement's notes and flags with it.
 *
 * - Time is O(F × T + S + C). Choosing the columns reads the payload's `browsers` object by key, never
 *   the features (`targets.ts`). The rows are then built in one pass over the features. Each
 *   feature looks up each displayed target once, by key, which is the F × T term, and each
 *   displayed cell visits its statements once, which is the S term (`cell.ts`). The parent named
 *   by a nested row's `part-of` message comes from a stack indexed by depth, so no row searches
 *   the rows before it.
 * - Space is O(F × T + S + C): one cell for each feature and target, and one history line for each
 *   statement, flag, and note. The depth stack holds at most one key per level, and a set holds
 *   each feature's key once, to reject a payload that repeats one: one lookup for each feature.
 *
 * C is the total number of characters in the notes of the displayed cells, because a note is
 * tokenized in time proportional to its length. BCD's notes are short, so C stays small next to S.
 *
 * A test measures the cost from outside. It wraps the payload in Proxies that count every property
 * read, builds the model, and checks that the reads grow linearly when F, T, or S doubles, so a
 * hidden extra scan or a quadratic step shows up as a number the model cannot fake.
 */

import { en } from "../strings/en.js";
import type { StringTable } from "../strings/format.js";
import { buildCell, tableMessage } from "./cell.js";
import type { TableCell, TableMessage } from "./cell.js";
import {
  assertTableModelFeature,
  assertTableModelPayload,
  assertTableModelSupport,
  TablePayloadError,
} from "./payload-guard.js";
import type { TableModelPayload } from "./payload-guard.js";
import {
  COLUMN_GROUP_MESSAGES,
  groupTargets,
  parseBrowsersOption,
  selectTargets,
} from "./targets.js";
import type { ColumnGroupId, TableTarget } from "./targets.js";

export type { CellCompact, CellDisclosure, HistoryItem, TableCell, TableMessage } from "./cell.js";
export { TablePayloadError };
export type { TablePayloadErrorReason, TableModelPayload } from "./payload-guard.js";
export type { ColumnGroupId, TableTarget } from "./targets.js";

export type TableModelOptions = {
  /** The `browsers` attribute: space-separated target ids, or null when it is not set. */
  readonly browsers?: string | null;
  /** The string table for the element's locale. English when omitted. */
  readonly strings?: StringTable;
};

/** A column group header, such as "Desktop", and the targets beneath it. */
export type TableColumnGroup = {
  readonly id: ColumnGroupId;
  readonly label: TableMessage;
  readonly columns: readonly TableTarget[];
};

export type TableRow = {
  readonly key: string;
  readonly name: string;
  readonly depth: number;
  /**
   * The `part-of` message for a nested row, such as "(part of Array.from)", or null at depth 0.
   * The parent is named by its key relative to the top-level row's parent, so `async_iterable`
   * under `javascript.builtins.Array.from` reads "Array.from".
   */
  readonly partOf: TableMessage | null;
  /** One cell for each column, in the order of `TableModel.columns`. */
  readonly cells: readonly TableCell[];
};

export type TableModel = {
  readonly caption: TableMessage;
  readonly featureHeader: TableMessage;
  readonly groups: readonly TableColumnGroup[];
  /** Every displayed target, in display order: the groups' columns, one group after another. */
  readonly columns: readonly TableTarget[];
  readonly rows: readonly TableRow[];
};

/**
 * Builds the table model.
 *
 * @throws {TablePayloadError} when `payload` is not a contract 1.x feature response, and for
 * nothing else. The guard checks the envelope, each feature, and each displayed support entry. A
 * feature whose key an earlier feature already has is rejected as `invalid-feature`.
 * Deeper fields, such as a statement's flags, are not checked one by one: any error that a
 * malformed field causes while the model reads it is rethrown as a `TablePayloadError` with the
 * reason `invalid-content` and the original error as its `cause`.
 */
export const buildTableModel = (payload: unknown, options: TableModelOptions = {}): TableModel => {
  assertTableModelPayload(payload);
  try {
    return buildFromPayload(payload, options);
  } catch (error) {
    if (error instanceof TablePayloadError) throw error;
    throw new TablePayloadError("invalid-content", undefined, { cause: error });
  }
};

const buildFromPayload = (payload: TableModelPayload, options: TableModelOptions): TableModel => {
  const strings = options.strings ?? en;

  const groups = groupTargets(
    selectTargets(payload.browsers, parseBrowsersOption(options.browsers)),
  ).map((group): TableColumnGroup => ({
    id: group.id,
    label: tableMessage(strings, COLUMN_GROUP_MESSAGES[group.id], {}),
    columns: group.targets,
  }));
  const columns = groups.flatMap((group) => group.columns);

  // `ancestors[depth]` is the key of the latest row at that depth. A row at depth d names the row
  // at `ancestors[d - 1]` as its parent, relative to `rootPrefix`, the part of the top-level row's
  // key before its own name.
  const ancestors: string[] = [];
  let rootPrefix = "";
  // Every key seen so far. A key names one feature, and the renderer keys each row by it.
  const keys = new Set<string>();

  const rows = payload.features.map((feature, index): TableRow => {
    assertTableModelFeature(feature, index);
    const { key, name, depth } = feature;
    // A row is at most one level deeper than the row before it, so its parent is on the stack.
    if (depth > ancestors.length) {
      throw new TablePayloadError("invalid-feature", `features[${index}].depth`);
    }
    if (keys.has(key)) throw new TablePayloadError("invalid-feature", `features[${index}].key`);
    keys.add(key);

    let partOf: TableMessage | null = null;
    const parentKey = depth === 0 ? undefined : ancestors[depth - 1];
    if (parentKey === undefined) {
      // The guard has checked that `name` ends `key`.
      rootPrefix = key.slice(0, key.length - name.length);
    } else {
      const parent = parentKey.startsWith(rootPrefix)
        ? parentKey.slice(rootPrefix.length)
        : parentKey;
      partOf = tableMessage(strings, "part-of", { parent });
    }
    ancestors.length = depth;
    ancestors[depth] = key;

    const cells = columns.map((target) => {
      const support = Object.hasOwn(feature.support, target.id)
        ? feature.support[target.id]
        : undefined;
      if (support !== undefined) assertTableModelSupport(support, key, target.id);
      return buildCell(strings, target, name, support);
    });

    return { key, name, depth, partOf, cells };
  });

  return {
    caption: tableMessage(strings, "caption", { query: payload.query }),
    featureHeader: tableMessage(strings, "header-feature", {}),
    groups,
    columns,
    rows,
  };
};
