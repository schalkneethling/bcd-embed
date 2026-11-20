import type { SupportFlag, SupportState, SupportStatement } from "@bcd-embed/schema";

import { formatMessage } from "../strings/format.js";
import type { MessageId, MessageValues, StringTable } from "../strings/format.js";
import { parseNote } from "./note.js";
import type { NoteSegment } from "./note.js";
import type { TableModelSummary, TableModelSupport } from "./payload-guard.js";
import type { TableTarget } from "./targets.js";

/**
 * Builds one cell: the sentence that names it, the short visible text, and the disclosure with
 * its history. The cell's sentence comes from the support summary as the payload gives it. The
 * model never selects a statement or computes a state, because the API answers what the support
 * is (Document 3 section 5). The history lists every statement of every branch, in the payload's
 * order.
 *
 * Every sentence is a message from the string table, formatted with its placeholder values. A
 * placeholder can receive another formatted message, such as `version-or-earlier`, but no
 * sentence is ever built by joining fragments.
 *
 * Time is O(s + c) for a cell with s statements whose notes have c characters in total, because
 * each statement is visited once and each note is tokenized once in linear time. Every message
 * has a fixed template, so formatting one costs time in proportion to its values. Space is the
 * same as time.
 */

/** A formatted message, with its id and values kept so a renderer can mark up the values. */
export type TableMessage = {
  readonly id: MessageId;
  readonly values: Readonly<Record<string, string>>;
  readonly text: string;
};

/** One line of a cell's history. A note line carries the note's segments for the renderer. */
export type HistoryItem = {
  readonly message: TableMessage;
  readonly note: readonly NoteSegment[] | null;
};

/** A cell's disclosure: the label that names the cell, the summary text, and the history. */
export type CellDisclosure = {
  readonly label: TableMessage;
  /** The cell's sentence followed by the label, the text of the `<summary>`. */
  readonly summary: TableMessage;
  readonly items: readonly HistoryItem[];
};

/**
 * The short visible text beside the icon, hidden from assistive technology. The renderer chooses
 * the icon from the cell's `state` and `behindFlag`, and marks up `prefix` as code.
 */
export type CellCompact = {
  /** The version text, such as "46", "≤12.1", or "11.1 – 12.1". Null when there is no version. */
  readonly text: string | null;
  readonly prefix: string | null;
  readonly alternativeName: string | null;
  readonly hasNotes: boolean;
};

export type TableCell = {
  readonly target: string;
  /** The summary's state, or "no-data" when the payload has no entry for this target. */
  readonly state: SupportState | "no-data";
  readonly behindFlag: boolean;
  /** The cell's accessible name: the whole fact, including the target. */
  readonly name: TableMessage;
  readonly compact: CellCompact;
  /** Null when the cell has nothing to say beyond its name. */
  readonly disclosure: CellDisclosure | null;
};

/** The context every message in one cell needs. */
type CellContext = {
  readonly strings: StringTable;
  readonly target: TableTarget;
  readonly feature: string;
};

/** Formats a message and keeps its id and values beside the text. */
export const tableMessage = <Id extends MessageId>(
  strings: StringTable,
  id: Id,
  values: MessageValues<Id>,
): TableMessage => ({ id, values, text: formatMessage(strings, id, values) });

const message = tableMessage;

/**
 * The text for a version placeholder in a sentence. BCD's literal "preview" names no version, so
 * it becomes the target's preview name, such as "Nightly", or `version-preview`. An approximate
 * version becomes `version-or-earlier`.
 */
const sentenceVersion = (context: CellContext, version: string, approximate: boolean): string => {
  if (version === "preview") {
    return context.target.previewName ?? formatMessage(context.strings, "version-preview", {});
  }
  return approximate ? formatMessage(context.strings, "version-or-earlier", { version }) : version;
};

/** The text for a version in the compact text, where an approximate version reads "≤12.1". */
const compactVersion = (strings: StringTable, version: string, approximate: boolean): string => {
  if (version === "preview") return formatMessage(strings, "compact-preview-unversioned", {});
  return approximate ? formatMessage(strings, "compact-or-earlier", { version }) : version;
};

/** What the cell's name says, and whether it names the summary's prefix or alternative name. */
type CellName = { readonly name: TableMessage; readonly namesIdentity: boolean };

/**
 * Chooses the cell's sentence from the summary. A sentence carries at most one modifier, chosen
 * in the order flag, prefix, alternative name. A modifier the sentence leaves out is still in the
 * disclosure: a flag always opens one, and `namesIdentity: false` opens one for a prefix or an
 * alternative name the sentence does not name (see `restatesName` in `buildCell`).
 */
const nameFromSummary = (context: CellContext, summary: TableModelSummary): CellName => {
  const { strings } = context;
  const target = context.target.name;
  const hasIdentity = summary.prefix !== null || summary.alternativeName !== null;
  const plain = (name: TableMessage): CellName => ({ name, namesIdentity: !hasIdentity });

  if (summary.state === "unknown") return plain(message(strings, "unknown", { target }));
  if (summary.state === "unsupported" || typeof summary.versionAdded !== "string") {
    return plain(message(strings, "no-support", { target }));
  }

  const added = summary.versionAdded;
  // Read as given: true only when the payload says so. Contract 1.0.0 has no such field.
  const approximate = summary.versionAddedIsApproximate === true;
  const version = sentenceVersion(context, added, approximate);

  if (summary.state === "preview") {
    const unversioned = added === "preview";
    if (summary.partialImplementation) {
      return plain(
        unversioned
          ? message(strings, "partial-preview-unversioned", { target })
          : message(strings, "partial-preview", { target, version }),
      );
    }
    if (summary.behindFlag) {
      return plain(
        unversioned
          ? message(strings, "supported-preview-unversioned-flagged", { target })
          : message(strings, "supported-preview-flagged", { target, version }),
      );
    }
    return plain(
      unversioned
        ? message(strings, "supported-preview-unversioned", { target })
        : message(strings, "supported-preview", { target, version }),
    );
  }

  const partial = summary.state === "partial";
  if (summary.behindFlag) {
    const id = partial ? "partial-flagged" : "supported-flagged";
    return plain(message(strings, id, { target, version }));
  }
  if (summary.prefix !== null) {
    const id = partial ? "partial-prefixed" : "supported-prefixed";
    return {
      name: message(strings, id, { target, version, prefix: summary.prefix }),
      namesIdentity: true,
    };
  }
  if (summary.alternativeName !== null) {
    const id = partial ? "partial-alternative-name" : "supported-alternative-name";
    return {
      name: message(strings, id, { target, version, name: summary.alternativeName }),
      namesIdentity: true,
    };
  }
  if (partial) return plain(message(strings, "partial-since", { target, version }));
  // The plain supported sentence has its own message for an approximate version.
  return plain(
    approximate
      ? message(strings, "supported-since-or-earlier", { target, version: added })
      : message(strings, "supported-since", { target, version }),
  );
};

const compactFromSummary = (strings: StringTable, summary: TableModelSummary): string | null => {
  const added = summary.versionAdded;
  if (summary.state === "unknown" || typeof added !== "string") return null;
  const addedText = compactVersion(strings, added, summary.versionAddedIsApproximate === true);
  if (summary.state === "unsupported") {
    if (summary.versionRemoved === null) return null;
    const removed = compactVersion(
      strings,
      summary.versionRemoved,
      summary.versionRemovedIsApproximate,
    );
    return formatMessage(strings, "compact-range", { added: addedText, removed });
  }
  if (summary.state === "preview" && added !== "preview") {
    return formatMessage(strings, "compact-preview", { version: addedText });
  }
  return addedText;
};

/**
 * The main sentence for one statement. A statement with a prefix or an alternative name has its
 * own sentence for the forms since, partial since, removed, and partially removed. Every other
 * form uses the plain sentence and adds `history-uses-prefix` or `history-uses-alternative-name`
 * after it, so no statement loses its name.
 */
const statementSentences = (context: CellContext, statement: SupportStatement): TableMessage[] => {
  const { strings } = context;
  const target = context.target.name;
  const { prefix, alternativeName: name } = statement;
  const identityLine = (): TableMessage[] => {
    if (prefix !== null) return [message(strings, "history-uses-prefix", { prefix })];
    if (name !== null) return [message(strings, "history-uses-alternative-name", { name })];
    return [];
  };

  const added = statement.versionAdded;
  if (added === false)
    return [message(strings, "history-no-support", { target }), ...identityLine()];
  if (added === null) return [message(strings, "history-unknown", { target }), ...identityLine()];

  const partial = statement.partialImplementation;
  const flagged = statement.flags.length > 0;

  if (statement.versionRemoved !== null) {
    const values = {
      target,
      added: sentenceVersion(context, added, statement.versionAddedIsApproximate),
      removed: sentenceVersion(
        context,
        statement.versionRemoved,
        statement.versionRemovedIsApproximate,
      ),
    };
    if (prefix !== null) {
      const id = partial ? "history-prefixed-partial-removed" : "history-prefixed-removed";
      return [message(strings, id, { ...values, prefix })];
    }
    if (name !== null) {
      const id = partial ? "history-alternative-partial-removed" : "history-alternative-removed";
      return [message(strings, id, { ...values, name })];
    }
    const id = partial ? "history-partial-removed" : "history-removed";
    return [message(strings, id, values)];
  }

  if (statement.isPreview) {
    const version = sentenceVersion(context, added, statement.versionAddedIsApproximate);
    const sentence =
      added === "preview"
        ? message(
            strings,
            partial ? "history-partial-preview-unversioned" : "history-preview-unversioned",
            { target },
          )
        : message(strings, partial ? "history-partial-preview" : "history-preview", {
            target,
            version,
          });
    return [sentence, ...identityLine()];
  }

  const version = sentenceVersion(context, added, statement.versionAddedIsApproximate);
  if (prefix !== null) {
    const id = partial ? "history-prefixed-partial" : "history-prefixed";
    return [message(strings, id, { target, version, prefix })];
  }
  if (name !== null) {
    const id = partial ? "history-alternative-partial" : "history-alternative";
    return [message(strings, id, { target, version, name })];
  }
  const id = partial
    ? flagged
      ? "history-partial-flagged"
      : "history-partial"
    : flagged
      ? "history-flagged"
      : "history-supported";
  return [message(strings, id, { target, version })];
};

const flagSentence = (context: CellContext, flag: SupportFlag): TableMessage => {
  const { strings } = context;
  const { name, valueToSet: value } = flag;
  if (flag.type === "preference") {
    return value === null
      ? message(strings, "flag-preference-no-value", { name })
      : message(strings, "flag-preference", { name, value });
  }
  const target = context.target.name;
  return value === null
    ? message(strings, "flag-runtime", { target, name })
    : message(strings, "flag-runtime-value", { target, name, value });
};

/** The plain text of a tokenized note, for the `note` message's `{text}` value. */
const noteText = (segments: readonly NoteSegment[]): string => {
  let text = "";
  for (const segment of segments) {
    if (segment.kind === "link") {
      for (const child of segment.children) text += child.text;
    } else {
      text += segment.text;
    }
  }
  return text;
};

const noData = (context: CellContext): TableCell => ({
  target: context.target.id,
  state: "no-data",
  behindFlag: false,
  name: message(context.strings, "no-data", { target: context.target.name }),
  compact: { text: null, prefix: null, alternativeName: null, hasNotes: false },
  disclosure: null,
});

/**
 * Builds the cell for one support target of one feature. `support` is the payload's entry, or
 * `undefined` when the payload has none. `onStatement` is called once for each statement visited,
 * so a test can count the work.
 */
export const buildCell = (
  strings: StringTable,
  target: TableTarget,
  feature: string,
  support: TableModelSupport | undefined,
  onStatement: () => void,
): TableCell => {
  const context: CellContext = { strings, target, feature };
  if (support === undefined) return noData(context);

  const { summary } = support;
  const { name, namesIdentity } = nameFromSummary(context, summary);

  const items: HistoryItem[] = [];
  let statementCount = 0;
  let hasFlags = false;
  let hasNotes = false;
  let hasEnded = false;
  let approximationDiffers = false;
  for (const branch of support.branches) {
    for (const statement of branch.statements as readonly SupportStatement[]) {
      onStatement();
      statementCount += 1;
      // The name reads the summary's approximation. A statement that says otherwise, as in a
      // contract 1.0.0 payload, keeps its disclosure, so its "or earlier" is not lost. This
      // compares the statement with the name; it never changes the name.
      if (
        typeof statement.versionAdded === "string" &&
        statement.versionAddedIsApproximate !== (summary.versionAddedIsApproximate === true)
      ) {
        approximationDiffers = true;
      }
      for (const sentence of statementSentences(context, statement)) {
        items.push({ message: sentence, note: null });
      }
      if (statement.versionRemoved !== null || statement.versionLast !== null) hasEnded = true;
      if (statement.versionLast !== null) {
        const version = sentenceVersion(
          context,
          statement.versionLast,
          statement.versionLastIsApproximate,
        );
        items.push({
          message: message(strings, "history-last-supported", { target: target.name, version }),
          note: null,
        });
      }
      for (const flag of statement.flags) {
        hasFlags = true;
        items.push({ message: flagSentence(context, flag), note: null });
      }
      for (const note of statement.notes) {
        hasNotes = true;
        const segments = parseNote(note);
        items.push({
          message: message(strings, "note", { text: noteText(segments) }),
          note: segments,
        });
      }
    }
  }

  // A single statement that the name already states in full needs no history of its own.
  const restatesName = statementCount === 1 && !hasEnded && namesIdentity && !approximationDiffers;
  let disclosure: CellDisclosure | null = null;
  if (!restatesName || hasFlags || hasNotes) {
    const labelId =
      restatesName && hasFlags && !hasNotes
        ? "disclosure-flag"
        : restatesName && hasNotes && !hasFlags
          ? "disclosure-notes"
          : hasNotes
            ? "disclosure-history-notes"
            : "disclosure-history";
    const label = message(strings, labelId, { feature, target: target.name });
    disclosure = {
      label,
      summary: message(strings, "disclosure-summary", { fact: name.text, label: label.text }),
      items,
    };
  }

  return {
    target: target.id,
    state: summary.state,
    behindFlag: summary.behindFlag,
    name,
    compact: {
      text: compactFromSummary(strings, summary),
      prefix: summary.prefix,
      alternativeName: summary.alternativeName,
      hasNotes: summary.hasNotes,
    },
    disclosure,
  };
};
