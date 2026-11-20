import { en } from "./en.js";

/** The id of a message in the string table. */
export type MessageId = keyof typeof en;

/**
 * A complete string table for one locale. Every locale supplies every id, so a lookup never
 * misses and a missing translation is a type error in the table, not a blank in the page.
 */
export type StringTable = Readonly<Record<MessageId, string>>;

/** The names of the `{placeholders}` in a message, as a union of string literals. */
type PlaceholderNames<Message extends string> =
  Message extends `${string}{${infer Name}}${infer Rest}` ? Name | PlaceholderNames<Rest> : never;

/** The values a message needs: one string for each of its placeholders. */
export type MessageValues<Id extends MessageId> = Readonly<
  Record<PlaceholderNames<(typeof en)[Id]>, string>
>;

/** Thrown when a message is formatted without a value for one of its placeholders. */
export class MissingPlaceholderError extends Error {
  readonly messageId: MessageId;
  readonly placeholder: string;

  constructor(messageId: MessageId, placeholder: string) {
    super(`Message "${messageId}" needs a value for the placeholder {${placeholder}}.`);
    this.name = "MissingPlaceholderError";
    this.messageId = messageId;
    this.placeholder = placeholder;
  }
}

const placeholderPattern = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

/**
 * Formats a message by replacing each `{placeholder}` with its value.
 *
 * Time is O(m + v), where m is the length of the message and v is the total length of the
 * substituted values. Space is O(m + v) for the result. One pass reads the template, and the
 * inserted values are never scanned again, so a value that contains `{braces}` is kept as it is.
 *
 * @throws {MissingPlaceholderError} when `values` has no string for a placeholder.
 */
export const formatMessage = <Id extends MessageId>(
  table: StringTable,
  id: Id,
  values: MessageValues<Id>,
): string => {
  const lookup: Readonly<Record<string, unknown>> = values;
  return table[id].replaceAll(placeholderPattern, (_match, name: string) => {
    const value = Object.hasOwn(lookup, name) ? lookup[name] : undefined;
    if (typeof value !== "string") throw new MissingPlaceholderError(id, name);
    return value;
  });
};

/**
 * One piece of a formatted message: the template's own words, or the value of a placeholder with
 * the placeholder's name. A renderer uses the parts to mark up a value, such as a prefix as code,
 * without joining pieces of a sentence itself.
 */
export type MessagePart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "value"; readonly name: string; readonly text: string };

/**
 * Formats a message as a list of parts, in the template's order. Joining every part's `text`
 * gives the same string as `formatMessage`. An empty stretch of template text gives no part.
 *
 * Time and space are O(m + v), as for `formatMessage`: one pass reads the template, and each
 * value is copied once and never scanned.
 *
 * @throws {MissingPlaceholderError} when `values` has no string for a placeholder.
 */
export const formatMessageToParts = (
  table: StringTable,
  id: MessageId,
  values: Readonly<Record<string, unknown>>,
): MessagePart[] => {
  const template = table[id];
  const parts: MessagePart[] = [];
  let textStart = 0;
  for (const match of template.matchAll(placeholderPattern)) {
    const name = match[1] ?? "";
    const value = Object.hasOwn(values, name) ? values[name] : undefined;
    if (typeof value !== "string") throw new MissingPlaceholderError(id, name);
    if (match.index > textStart) {
      parts.push({ kind: "text", text: template.slice(textStart, match.index) });
    }
    parts.push({ kind: "value", name, text: value });
    textStart = match.index + match[0].length;
  }
  if (textStart < template.length) parts.push({ kind: "text", text: template.slice(textStart) });
  return parts;
};

// Each key is a language subtag. Locale tables beyond English will join this object, loaded on
// demand, when a second locale ships.
const stringTables: Readonly<Record<string, StringTable>> = { en };

/**
 * Selects the string table for a `locale` value. A region or script suffix is ignored (`en-GB`
 * and `en_GB` select `en`), and an unknown tag selects English. The parameter is `unknown`
 * because a script can set the `locale` property to anything, and a value that is not a string
 * selects English too.
 */
export const selectStrings = (locale: unknown): StringTable => {
  if (typeof locale !== "string") return en;
  const language = locale.trim().split(/[-_]/)[0]?.toLowerCase() ?? "";
  return Object.hasOwn(stringTables, language) ? (stringTables[language] ?? en) : en;
};
