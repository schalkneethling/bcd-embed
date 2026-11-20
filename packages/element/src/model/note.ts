/**
 * Turns a BCD (`@mdn/browser-compat-data`) note string into a closed set of segments: text, code,
 * emphasis, and links with a checked address. The renderer writes the segments through Lit's text
 * and attribute bindings, so nothing in a note ever becomes markup. This module never builds an
 * HTML string and needs no HTML parser, so it runs in Node and under a strict
 * Content-Security-Policy.
 *
 * The grammar is the markup BCD uses, and nothing more. In BCD 8.1.9, 18,008 notes use three tags:
 * `<code>`, `<a href="…">`, and `<em>`. A link's only attribute is a double-quoted `href`, and a
 * link may contain code and emphasis. Code and emphasis contain only text. The notes use four
 * named entities (`&lt;`, `&gt;`, `&amp;`, `&quot;`) and one numeric one (`&#62;`).
 *
 * The scanner reads the note once, from left to right:
 *
 * - `&` starts an entity. A named entity from the closed list, or a numeric one for an allowed
 *   code point, decodes to its character. Anything else stays literal. A decoded character is
 *   never read again, so `&amp;lt;` is the text `&lt;`, and `&lt;code&gt;` is text, not a tag.
 * - `<` starts a tag only when the exact spelling of a tag allowed at that point follows it. Inside
 *   code or emphasis, only the matching closing tag is allowed. Inside a link, code, emphasis, and
 *   `</a>` are allowed. Any other `<` is literal text.
 * - A link opens only when its address starts with `http://` or `https://` and a host, after its
 *   entities are decoded. Otherwise the whole tag is literal text, and so is its closing tag.
 * - An element still open at the end of the note is not an element: its opening tag becomes
 *   literal text, and its content joins the enclosing content unchanged.
 *
 * When a tag or entity turns out not to match, the characters already read are literal text and
 * the scanner continues from the character that did not match. It never steps back. Each
 * character is therefore consumed once, and each tag or entity attempt reads at most one
 * character that it does not consume, which the next step reads again. For a note of n
 * characters, that is at most 2n reads: O(n) time. The output, the stack of open elements (at most
 * three deep: the note, a link, and code or emphasis inside it), and the text buffers are O(n)
 * space.
 */

/** Plain text. A renderer writes it as a text node. */
export type NoteText = { readonly kind: "text"; readonly text: string };

/** Text from a `<code>` element. */
export type NoteCode = { readonly kind: "code"; readonly text: string };

/** Text from an `<em>` element. */
export type NoteEmphasis = { readonly kind: "emphasis"; readonly text: string };

/** The segments a link may contain. */
export type NoteInline = NoteText | NoteCode | NoteEmphasis;

/**
 * A link from an `<a href>` element. `href` is decoded and starts with `http://` or `https://`.
 * `children` is never empty: a link with no content gets its address as its text, so it always
 * has an accessible name.
 */
export type NoteLink = {
  readonly kind: "link";
  readonly href: string;
  readonly children: readonly NoteInline[];
};

export type NoteSegment = NoteInline | NoteLink;

/**
 * The tag names the tokenizer turns into segments. A test fails when the installed BCD uses any
 * other tag, which is the signal to extend the tokenizer.
 */
export const SUPPORTED_NOTE_TAGS: readonly string[] = ["a", "code", "em"];

const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ["amp", "&"],
  ["gt", ">"],
  ["lt", "<"],
  ["quot", '"'],
]);

// The longest name in NAMED_ENTITIES. A longer name cannot match, so the scanner stops there.
const LONGEST_ENTITY_NAME = 4;

const AMPERSAND = 0x26;
const DOUBLE_QUOTE = 0x22;
const GREATER_THAN = 0x3e;
const HASH = 0x23;
const LESS_THAN = 0x3c;
const SEMICOLON = 0x3b;
const SLASH = 0x2f;

type ElementKind = "code" | "emphasis" | "link";

type Frame = {
  readonly kind: ElementKind | "note";
  // The opening tag as literal text, used when the element is never closed.
  readonly opener: string;
  readonly href: string;
  readonly children: NoteSegment[];
};

// The exact spelling of each tag after its `<`, and where it may appear.
const OPENERS: ReadonlyMap<Frame["kind"], readonly ElementKind[]> = new Map([
  ["note", ["code", "emphasis", "link"]],
  ["link", ["code", "emphasis"]],
  ["code", []],
  ["emphasis", []],
]);
const OPENING_TAG: Readonly<Record<ElementKind, string>> = {
  code: "code>",
  emphasis: "em>",
  link: 'a href="',
};
// The spelling of each closing tag after its `</`.
const CLOSING_TAG: Readonly<Record<ElementKind, string>> = {
  code: "code>",
  emphasis: "em>",
  link: "a>",
};

/**
 * Whether a numeric entity may decode to this code point. Tab, line feed, carriage return, and
 * printable characters may. Other control characters, surrogates, noncharacters, and values past
 * U+10FFFF stay literal, so an entity can never produce a character the note could not show.
 */
const isAllowedCodePoint = (codePoint: number): boolean => {
  if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) return true;
  if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f)) return false;
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) return false;
  if (codePoint >= 0xfdd0 && codePoint <= 0xfdef) return false;
  if ((codePoint & 0xfffe) === 0xfffe) return false;
  return codePoint <= 0x10ffff;
};

/**
 * Whether a character may appear in a link's address: printable ASCII other than the quotes, the
 * angle brackets, the backtick, and the backslash. A URL never needs any of them unescaped.
 */
const isAddressCharacter = (code: number): boolean =>
  code > 0x20 &&
  code < 0x7f &&
  code !== DOUBLE_QUOTE &&
  code !== 0x27 &&
  code !== LESS_THAN &&
  code !== GREATER_THAN &&
  code !== 0x5c &&
  code !== 0x60;

const isLinkAddress = (href: string): boolean => /^https?:\/\/[a-z0-9]/i.test(href);

// The value of a decimal or hexadecimal digit, or -1 for any other character.
const digitValue = (code: number, hexadecimal: boolean): number => {
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  if (!hexadecimal) return -1;
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10;
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10;
  return -1;
};

const isAsciiAlphanumeric = (code: number): boolean =>
  (code >= 0x30 && code <= 0x39) ||
  (code >= 0x41 && code <= 0x5a) ||
  (code >= 0x61 && code <= 0x7a);

const pushText = (children: NoteSegment[], value: string): void => {
  if (value === "") return;
  const last = children.at(-1);
  if (last?.kind === "text") {
    children[children.length - 1] = { kind: "text", text: last.text + value };
  } else {
    children.push({ kind: "text", text: value });
  }
};

/**
 * Tokenizes a note and also returns the number of characters the scanner read, which tests use to
 * check that the work is linear in the note's length.
 */
export const parseNoteWithSteps = (note: string): { segments: NoteSegment[]; steps: number } => {
  const length = note.length;
  let steps = 0;
  // Every character the scanner looks at passes through here, so `steps` counts every read.
  const read = (index: number): number => {
    steps += 1;
    return note.charCodeAt(index);
  };
  // Reads the character at `index`, or returns -1 past the end without counting a read.
  const readAt = (index: number): number => (index < length ? read(index) : -1);

  const root: Frame = { kind: "note", opener: "", href: "", children: [] };
  const stack: Frame[] = [root];
  const top = (): Frame => stack[stack.length - 1] ?? root;

  // Reads an entity that starts with the `&` at `start`. Returns the index after the entity and
  // its decoded text, or the index of the first character that is not part of it and the
  // characters before that as literal text.
  const readEntity = (start: number): { end: number; value: string } => {
    let index = start + 1;
    // The character at `index`, read once. Each branch below consumes it or stops in front of it.
    let code = readAt(index);
    const literal = () => ({ end: index, value: note.slice(start, index) });

    if (code === HASH) {
      index += 1;
      code = readAt(index);
      const hexadecimal = code === 0x78 || code === 0x58;
      if (hexadecimal) {
        index += 1;
        code = readAt(index);
      }
      const digitsStart = index;
      let codePoint = 0;
      for (
        let digit = digitValue(code, hexadecimal);
        digit >= 0;
        digit = digitValue(code, hexadecimal)
      ) {
        // Stop growing past the last code point, so a long run of digits cannot overflow.
        if (codePoint <= 0x10ffff) codePoint = codePoint * (hexadecimal ? 16 : 10) + digit;
        index += 1;
        code = readAt(index);
      }
      if (index === digitsStart || code !== SEMICOLON) return literal();
      index += 1;
      return isAllowedCodePoint(codePoint)
        ? { end: index, value: String.fromCodePoint(codePoint) }
        : literal();
    }

    const nameStart = index;
    // A name longer than the longest known one cannot match, so the scan stops there.
    while (isAsciiAlphanumeric(code) && index - nameStart < LONGEST_ENTITY_NAME) {
      index += 1;
      code = readAt(index);
    }
    if (code !== SEMICOLON) return literal();
    const decoded = NAMED_ENTITIES.get(note.slice(nameStart, index));
    if (decoded === undefined) return literal();
    index += 1;
    return { end: index, value: decoded };
  };

  // Matches `expected` at `start`, one character at a time. Returns the index after the match, or
  // the negative of one past the index of the first character that differs or is missing.
  const matchLiteral = (start: number, expected: string): number => {
    for (let offset = 0; offset < expected.length; offset += 1) {
      const index = start + offset;
      if (index >= length || read(index) !== expected.charCodeAt(offset)) return -(index + 1);
    }
    return start + expected.length;
  };

  // Reads a link's address and the `">` that ends its opening tag. `start` is the index after
  // `<a href="`. Returns the index after `">` and the decoded address, or the index to continue
  // from and the decoded characters read so far.
  const readAddress = (start: number): { end: number; value: string; complete: boolean } => {
    let index = start;
    let value = "";
    while (index < length) {
      const code = read(index);
      if (code === DOUBLE_QUOTE) {
        index += 1;
        if (index < length && read(index) === GREATER_THAN) {
          return { end: index + 1, value, complete: true };
        }
        return { end: index, value: `${value}"`, complete: false };
      }
      if (code === AMPERSAND) {
        const entity = readEntity(index);
        index = entity.end;
        value += entity.value;
        if (![...entity.value].every((character) => isAddressCharacter(character.charCodeAt(0)))) {
          return { end: index, value, complete: false };
        }
        continue;
      }
      if (!isAddressCharacter(code)) break;
      value += note[index];
      index += 1;
    }
    return { end: index, value, complete: false };
  };

  const closeElement = (): void => {
    const frame = stack.pop() ?? root;
    const parent = top().children;
    if (frame.kind === "link") {
      // A link cannot open inside a link, so a link's children are text, code, and emphasis only.
      const children = frame.children as NoteInline[];
      parent.push({
        kind: "link",
        href: frame.href,
        children: children.length > 0 ? children : [{ kind: "text", text: frame.href }],
      });
      return;
    }
    // Code and emphasis allow no tags inside, so their content is one text segment or none.
    const first = frame.children[0];
    const text = first?.kind === "text" ? first.text : "";
    parent.push(frame.kind === "code" ? { kind: "code", text } : { kind: "emphasis", text });
  };

  // Handles the `<` at `start`. Returns the index to continue from.
  const readTag = (start: number): number => {
    const frame = top();
    const next = start + 1;
    if (next >= length) {
      pushText(frame.children, "<");
      return next;
    }
    const code = read(next);

    if (code === SLASH) {
      const kind = frame.kind;
      if (kind === "note") {
        pushText(frame.children, "</");
        return next + 1;
      }
      const end = matchLiteral(next + 1, CLOSING_TAG[kind]);
      if (end < 0) {
        pushText(frame.children, note.slice(start, -end - 1));
        return -end - 1;
      }
      closeElement();
      return end;
    }

    const kind = OPENERS.get(frame.kind)?.find(
      (candidate) => OPENING_TAG[candidate].charCodeAt(0) === code,
    );
    if (kind === undefined) {
      pushText(frame.children, "<");
      return next;
    }
    const end = matchLiteral(next + 1, OPENING_TAG[kind].slice(1));
    if (end < 0) {
      pushText(frame.children, note.slice(start, -end - 1));
      return -end - 1;
    }
    if (kind !== "link") {
      stack.push({ kind, opener: note.slice(start, end), href: "", children: [] });
      return end;
    }

    const address = readAddress(end);
    const opener = `<a href="${address.value}${address.complete ? '">' : ""}`;
    if (address.complete && isLinkAddress(address.value)) {
      stack.push({ kind, opener, href: address.value, children: [] });
    } else {
      pushText(frame.children, opener);
    }
    return address.end;
  };

  let index = 0;
  let runStart = 0;
  const flushRun = (end: number) => {
    pushText(top().children, note.slice(runStart, end));
  };
  while (index < length) {
    const code = read(index);
    if (code === LESS_THAN) {
      flushRun(index);
      index = readTag(index);
      runStart = index;
    } else if (code === AMPERSAND) {
      flushRun(index);
      const entity = readEntity(index);
      pushText(top().children, entity.value);
      index = entity.end;
      runStart = index;
    } else {
      index += 1;
    }
  }
  flushRun(index);

  // Elements still open are not elements: their opening tag is text, and their content stays.
  while (stack.length > 1) {
    const frame = stack.pop() ?? root;
    const parent = top().children;
    pushText(parent, frame.opener);
    for (const child of frame.children) {
      if (child.kind === "text") pushText(parent, child.text);
      else parent.push(child);
    }
  }

  return { segments: root.children, steps };
};

/** Tokenizes a BCD note into text, code, emphasis, and checked link segments. */
export const parseNote = (note: string): NoteSegment[] => parseNoteWithSteps(note).segments;
