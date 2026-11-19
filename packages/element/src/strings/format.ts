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

// Each key is a language subtag. Locale tables beyond English will join this object, loaded on
// demand, when a second locale ships.
const stringTables: Readonly<Record<string, StringTable>> = { en };

/**
 * Selects the string table for a `locale` attribute value. A region or script suffix is ignored
 * (`en-GB` selects `en`), and an unknown or missing tag selects English.
 */
export const selectStrings = (locale: string | null | undefined): StringTable => {
  const language = locale?.trim().split("-")[0]?.toLowerCase() ?? "";
  return Object.hasOwn(stringTables, language) ? (stringTables[language] ?? en) : en;
};
