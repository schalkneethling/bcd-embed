import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import bcd from "@mdn/browser-compat-data" with { type: "json" };
import type { Identifier, SimpleSupportStatement } from "@mdn/browser-compat-data/types";
import { describe, expect, it } from "vitest";

import { parseNote, parseNoteWithSteps, SUPPORTED_NOTE_TAGS } from "../src/model/note.js";
import type { NoteSegment } from "../src/model/note.js";

const text = (value: string): NoteSegment => ({ kind: "text", text: value });

// Joins every text-bearing segment, so a test can check what a reader would see.
const visibleText = (segments: readonly NoteSegment[]): string =>
  segments
    .map((segment) => (segment.kind === "link" ? visibleText(segment.children) : segment.text))
    .join("");

const allSegments = (segments: readonly NoteSegment[]): NoteSegment[] =>
  segments.flatMap((segment) =>
    segment.kind === "link" ? [segment, ...allSegments(segment.children)] : [segment],
  );

describe("parseNote with the markup BCD uses", () => {
  it("splits code and a link into five segments: text, code, text, link, text", () => {
    expect(parseNote('Use <code>a</code>, see <a href="https://example.com/x">bug</a>.')).toEqual([
      text("Use "),
      { kind: "code", text: "a" },
      text(", see "),
      { kind: "link", href: "https://example.com/x", children: [text("bug")] },
      text("."),
    ]);
  });

  it("returns emphasis segments", () => {
    expect(parseNote("max<em>In</em>Stage")).toEqual([
      text("max"),
      { kind: "emphasis", text: "In" },
      text("Stage"),
    ]);
  });

  it("keeps code and emphasis inside a link as the link's children", () => {
    expect(
      parseNote(
        'See <a href="https://example.com/p"><code>Animation.pending</code> and <em>x</em></a>',
      ),
    ).toEqual([
      text("See "),
      {
        kind: "link",
        href: "https://example.com/p",
        children: [
          { kind: "code", text: "Animation.pending" },
          text(" and "),
          { kind: "emphasis", text: "x" },
        ],
      },
    ]);
  });

  it("returns no segments for an empty note", () => {
    expect(parseNote("")).toEqual([]);
  });

  it("gives a link with no visible text its address as its text, so it always has a name", () => {
    const notes = [
      '<a href="https://example.com/"></a>',
      '<a href="https://example.com/"><code></code></a>',
      '<a href="https://example.com/"><em></em></a>',
      '<a href="https://example.com/">  </a>',
      '<a href="https://example.com/"> <code></code>\t</a>',
    ];
    for (const note of notes) {
      expect(parseNote(note), note).toEqual([
        { kind: "link", href: "https://example.com/", children: [text("https://example.com/")] },
      ]);
    }
  });

  it("keeps a link's whitespace when the link also has visible text", () => {
    expect(parseNote('<a href="https://example.com/"> <code>x</code> </a>')).toEqual([
      {
        kind: "link",
        href: "https://example.com/",
        children: [text(" "), { kind: "code", text: "x" }, text(" ")],
      },
    ]);
  });

  it("drops empty code and emphasis, and joins the text around them", () => {
    expect(parseNote("a<code></code>b<em></em>c")).toEqual([text("abc")]);
    expect(parseNote("<code></code>")).toEqual([]);
  });
});

describe("parseNote entity decoding", () => {
  it("decodes the four named entities into one text segment and never builds markup from them", () => {
    expect(parseNote("Use &lt;video&gt; &amp; &quot;lazy&quot;")).toEqual([
      text('Use <video> & "lazy"'),
    ]);
    expect(parseNote("&lt;code&gt;x&lt;/code&gt;")).toEqual([text("<code>x</code>")]);
  });

  it("decodes entities once, never twice", () => {
    expect(parseNote("&amp;lt;")).toEqual([text("&lt;")]);
    expect(parseNote("&amp;amp;")).toEqual([text("&amp;")]);
    expect(parseNote("&#38;lt;")).toEqual([text("&lt;")]);
  });

  it("decodes decimal and hexadecimal numeric entities", () => {
    expect(parseNote("&#62;")).toEqual([text(">")]);
    expect(parseNote("&#x3C;")).toEqual([text("<")]);
    expect(parseNote("&#X3c;")).toEqual([text("<")]);
    expect(parseNote("&#0000062;")).toEqual([text(">")]);
    expect(parseNote("&#x1F600;")).toEqual([text("\u{1F600}")]);
    expect(parseNote("<code>(width &#62; 500px)</code>")).toEqual([
      { kind: "code", text: "(width > 500px)" },
    ]);
  });

  it("leaves unknown, unterminated, and uppercase named entities literal", () => {
    expect(parseNote("a &notreal; b")).toEqual([text("a &notreal; b")]);
    expect(parseNote("&lt")).toEqual([text("&lt")]);
    expect(parseNote("&lt b")).toEqual([text("&lt b")]);
    expect(parseNote("&LT;")).toEqual([text("&LT;")]);
    expect(parseNote("&apos;")).toEqual([text("&apos;")]);
    expect(parseNote("& &; &#; &#x; &#xG;")).toEqual([text("& &; &#; &#x; &#xG;")]);
    expect(parseNote("a & b && c")).toEqual([text("a & b && c")]);
  });

  it("leaves numeric entities for control characters, surrogates, noncharacters, and out-of-range code points literal", () => {
    const literal = [
      "&#0;",
      "&#x0;",
      "&#1;",
      "&#8;",
      "&#11;",
      "&#x1B;",
      "&#127;",
      "&#x80;",
      "&#x9F;",
      "&#xD800;",
      "&#xDFFF;",
      "&#xFDD0;",
      "&#xFFFE;",
      "&#x10FFFF;",
      "&#x110000;",
      "&#1114112;",
      "&#99999999999999999999;",
      "&#xFFFFFFFFFFFFFFFFFFFF;",
    ];
    for (const entity of literal) {
      expect(parseNote(entity), entity).toEqual([text(entity)]);
    }
  });

  it("decodes numeric entities for tab, line feed, and carriage return", () => {
    expect(parseNote("a&#9;b&#10;c&#13;d")).toEqual([text("a\tb\nc\rd")]);
  });

  it("decodes entities in a link's address once", () => {
    expect(parseNote('<a href="https://example.com/?a=1&amp;b=2">x</a>')).toEqual([
      { kind: "link", href: "https://example.com/?a=1&b=2", children: [text("x")] },
    ]);
    expect(parseNote('<a href="https://example.com/?q=&amp;lt;">x</a>')).toEqual([
      { kind: "link", href: "https://example.com/?q=&lt;", children: [text("x")] },
    ]);
  });
});

describe("parseNote with hostile or broken markup", () => {
  it("returns script, an image with an event handler, and a javascript: link as literal text", () => {
    const notes = [
      "<script>alert(1)</script>",
      "<img src=x onerror=alert(1)>",
      '<a href="javascript:alert(1)">x</a>',
    ];
    for (const note of notes) {
      expect(parseNote(note), note).toEqual([text(note)]);
    }
  });

  it("drops links that use any scheme other than https", () => {
    const notes = [
      '<a href="JavaScript:alert(1)">x</a>',
      '<a href="data:text/html,hi">x</a>',
      '<a href="vbscript:msgbox">x</a>',
      '<a href="file:///etc/passwd">x</a>',
      '<a href="mailto:a@example.com">x</a>',
      '<a href="ftp://example.com/">x</a>',
      '<a href="http://example.com/">x</a>',
      '<a href="HTTP://example.com/">x</a>',
      '<a href="https:example.com">x</a>',
      '<a href="https://">x</a>',
    ];
    for (const note of notes) {
      expect(parseNote(note), note).toEqual([text(note)]);
    }
  });

  it("decodes the address before checking the scheme, so an encoded javascript: scheme is still dropped", () => {
    expect(parseNote('<a href="&#106;avascript:alert(1)">x</a>')).toEqual([
      text('<a href="javascript:alert(1)">x</a>'),
    ]);
    expect(parseNote('<a href="java&#x09;script:alert(1)">x</a>')).toEqual([
      text('<a href="java\tscript:alert(1)">x</a>'),
    ]);
    expect(parseNote('<a href="https:&#47;&#47;example.com">x</a>')).toEqual([
      { kind: "link", href: "https://example.com", children: [text("x")] },
    ]);
  });

  it("drops relative and protocol-relative links and returns them literally", () => {
    for (const note of ['<a href="/relative">x</a>', '<a href="//evil.example">x</a>']) {
      expect(parseNote(note), note).toEqual([text(note)]);
    }
  });

  it("drops links with attributes other than a double-quoted href", () => {
    const notes = [
      '<a href="https://example.com" onclick="alert(1)">x</a>',
      '<a onclick="alert(1)" href="https://example.com">x</a>',
      '<a title="t" href="https://example.com">x</a>',
      "<a href='https://example.com'>x</a>",
      "<a href=https://example.com>x</a>",
      '<a  href="https://example.com">x</a>',
      '<a href = "https://example.com">x</a>',
      '<A HREF="https://example.com">x</A>',
      '<a href="https://example.com/a b">x</a>',
      '<a href="https://example.com/<b>">x</a>',
      '<a href="https://example.com/\\evil">x</a>',
    ];
    for (const note of notes) {
      expect(parseNote(note), note).toEqual([text(note)]);
    }
  });

  it("drops a link whose address contains characters a URL never has unescaped", () => {
    expect(parseNote('<a href="https://example.com/&#10;x">x</a>')).toEqual([
      text('<a href="https://example.com/\nx">x</a>'),
    ]);
    expect(parseNote('<a href="https://example.com/&quot;onmouseover=&quot;x">x</a>')).toEqual([
      text('<a href="https://example.com/"onmouseover="x">x</a>'),
    ]);
  });

  it("drops a link whose address contains a single quote or a backtick, written or encoded", () => {
    const notes = [
      '<a href="https://example.com/\'x">x</a>',
      '<a href="https://example.com/`x">x</a>',
    ];
    for (const note of notes) {
      expect(parseNote(note), note).toEqual([text(note)]);
    }
    expect(parseNote('<a href="https://example.com/&#39;x">x</a>')).toEqual([
      text('<a href="https://example.com/\'x">x</a>'),
    ]);
    expect(parseNote('<a href="https://example.com/&#x60;x">x</a>')).toEqual([
      text('<a href="https://example.com/`x">x</a>'),
    ]);
  });

  it("keeps an entity it cannot decode literal inside a kept address", () => {
    expect(parseNote('<a href="https://example.com/?a&notreal;b">x</a>')).toEqual([
      { kind: "link", href: "https://example.com/?a&notreal;b", children: [text("x")] },
    ]);
  });

  it("returns tags the tokenizer does not support, including their attributes, as literal text", () => {
    const notes = [
      "<b>bold</b>",
      "<strong>x</strong>",
      "<embed>",
      "<emx>y</emx>",
      "<codes>z</codes>",
      '<code class="x">y</code>',
      "<code >y</code>",
      "<CODE>y</CODE>",
      '<em style="color:red">y</em>',
      "<style>body{}</style>",
      '<iframe src="https://example.com"></iframe>',
      "<svg onload=alert(1)>",
      "<!-- comment -->",
      "<![CDATA[x]]>",
    ];
    for (const note of notes) {
      expect(parseNote(note), note).toEqual([text(note)]);
    }
  });

  it("returns an unclosed code element and a stray < literally, without throwing", () => {
    expect(parseNote("a <code>b")).toEqual([text("a <code>b")]);
    expect(parseNote("a < b")).toEqual([text("a < b")]);
    expect(parseNote("a <")).toEqual([text("a <")]);
    expect(parseNote("<")).toEqual([text("<")]);
    expect(parseNote("a <co")).toEqual([text("a <co")]);
    expect(parseNote('<a href="https://example.com')).toEqual([
      text('<a href="https://example.com'),
    ]);
    expect(parseNote('<a href="https://example.com"')).toEqual([
      text('<a href="https://example.com"'),
    ]);
  });

  it("returns stray closing tags literally", () => {
    expect(parseNote("a</code>b</a></em>")).toEqual([text("a</code>b</a></em>")]);
  });

  it("returns an unclosed link literally and keeps the closed elements inside it", () => {
    expect(parseNote('x <a href="https://example.com"><code>y</code> z')).toEqual([
      text('x <a href="https://example.com">'),
      { kind: "code", text: "y" },
      text(" z"),
    ]);
  });

  it("does not nest tags inside code or emphasis, so their content comes out literally", () => {
    expect(parseNote("<code><em>x</em></code>")).toEqual([{ kind: "code", text: "<em>x</em>" }]);
    expect(parseNote("<em><code>x</code></em>")).toEqual([
      { kind: "emphasis", text: "<code>x</code>" },
    ]);
    expect(parseNote('<code><a href="https://example.com">x</a></code>')).toEqual([
      { kind: "code", text: '<a href="https://example.com">x</a>' },
    ]);
  });

  it("does not nest a link inside a link", () => {
    expect(
      parseNote('<a href="https://a.example/"><a href="https://b.example/">x</a></a>'),
    ).toEqual([
      {
        kind: "link",
        href: "https://a.example/",
        children: [text('<a href="https://b.example/">x')],
      },
      text("</a>"),
    ]);
  });

  it("does not let a closing link tag inside code close the link", () => {
    expect(parseNote('<a href="https://example.com"><code>y</a>')).toEqual([
      text('<a href="https://example.com"><code>y</a>'),
    ]);
  });

  it("returns improperly nested tags literally from the point they stop nesting", () => {
    expect(parseNote("<code>a<em>b</code>c</em>")).toEqual([
      { kind: "code", text: "a<em>b" },
      text("c</em>"),
    ]);
  });

  it("returns many unclosed and nested tags literally", () => {
    const note = "<code>".repeat(5) + "x" + '<a href="https://example.com">'.repeat(5);
    expect(parseNote(note)).toEqual([text(note)]);
    const links = '<a href="https://example.com">'.repeat(3) + "<em>".repeat(3) + "y";
    expect(parseNote(links)).toEqual([text(links)]);
  });

  it("returns the decoded text of a decoded < followed by a tag name as text, never as a tag", () => {
    expect(parseNote("&lt;script&gt;alert(1)&lt;/script&gt;")).toEqual([
      text("<script>alert(1)</script>"),
    ]);
    expect(parseNote("&#60;code&#62;x&#60;/code&#62;")).toEqual([text("<code>x</code>")]);
  });

  it("never returns a segment kind outside the closed set", () => {
    const kinds = new Set(["text", "code", "emphasis", "link"]);
    const notes = [
      "<script>alert(1)</script>",
      '<a href="https://e.example"><code>x</code><em>y</em>z</a><code>w</code>',
      "<code>a<em>b</code>c</em><<<>>>&&&;;;",
    ];
    for (const note of notes) {
      for (const segment of allSegments(parseNote(note))) {
        expect(kinds.has(segment.kind), note).toBe(true);
      }
    }
  });
});

describe("parseNote over the installed BCD", () => {
  // Every note string in every support statement, in data order.
  const collectNotes = (): string[] => {
    const notes: string[] = [];
    const visit = (node: Identifier) => {
      for (const [key, child] of Object.entries(node)) {
        if (key === "__compat") {
          for (const support of Object.values(node.__compat?.support ?? {})) {
            const statements: SimpleSupportStatement[] = Array.isArray(support)
              ? support
              : [support];
            for (const statement of statements) {
              const value = statement.notes;
              if (value !== undefined) notes.push(...(typeof value === "string" ? [value] : value));
            }
          }
        } else {
          visit(child as Identifier);
        }
      }
    };
    for (const [namespace, tree] of Object.entries(bcd)) {
      if (namespace !== "__meta" && namespace !== "browsers") visit(tree as Identifier);
    }
    return notes;
  };

  const notes = collectNotes();

  it("finds the notes", () => {
    // A sanity floor, not an exact count, so routine BCD releases do not break this test.
    // BCD 8.1.9 holds 18,008 notes.
    expect(notes.length).toBeGreaterThan(15_000);
  });

  it("uses no tag the tokenizer does not support, so a new tag in a later release fails here", () => {
    const found = new Set<string>();
    for (const note of notes) {
      for (const match of note.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)/g)) {
        found.add(match[1]!.toLowerCase());
      }
    }
    expect([...found].filter((tag) => !SUPPORTED_NOTE_TAGS.includes(tag))).toEqual([]);
  });

  // Counts the characters a note writes as an entity, in any of the forms the tokenizer decodes.
  const countEncoded = (note: string, pattern: RegExp): number => note.match(pattern)?.length ?? 0;
  const countCharacter = (value: string, character: string): number =>
    value.split(character).length - 1;

  it("tokenizes every note without throwing, keeps every link, and leaves no markup or entity undecoded", () => {
    for (const note of notes) {
      const segments = parseNote(note);
      const visible = visibleText(segments);
      const links = allSegments(segments).filter((segment) => segment.kind === "link");

      // Every link in the data uses http or https, so every one is kept.
      expect(links.length, note).toBe(countCharacter(note, "<a "));
      // BCD writes a literal < or & only as an entity. So a < or & in the visible text must come
      // from an entity, and any other one is markup or an entity that the tokenizer left behind.
      expect(countCharacter(visible, "<"), note).toBe(
        countEncoded(note, /&lt;|&#0*60;|&#x0*3c;/gi),
      );
      expect(countCharacter(visible, "&"), note).toBe(
        countEncoded(note, /&amp;|&#0*38;|&#x0*26;/gi),
      );
    }
  });
});

describe("parseNote time complexity", () => {
  it("takes at most two scanner steps per character for a 100,000-character note with 10,000 entities and tags", () => {
    // 5,000 entities in 50,000 characters, 5,000 tags in 25,000 characters, and 25,000 plain ones.
    const note = "abc&amp;de".repeat(5000) + "<em>x</em>".repeat(2500) + "z".repeat(25_000);
    expect(note).toHaveLength(100_000);

    const { segments, steps } = parseNoteWithSteps(note);

    expect(segments.filter((segment) => segment.kind === "emphasis")).toHaveLength(2500);
    expect(steps).toBeLessThanOrEqual(2 * note.length);
  });

  it("takes at most two scanner steps per character for adversarial notes", () => {
    const length = 100_000;
    const fill = (unit: string) => unit.repeat(Math.ceil(length / unit.length));
    const notes = [
      fill("<"),
      fill("&"),
      fill("&#"),
      fill("&#x"),
      fill("<code>"),
      fill("<em>"),
      fill("</code>"),
      fill('<a href="'),
      fill('<a href="https://example.com/">'),
      fill('<a href="https://example.com/"><code>'),
      fill('<a href="javascript:x">'),
      fill("<cod<"),
      fill("&amp;lt;"),
      fill("&notreal"),
      "&#" + "9".repeat(length),
      "&#x" + "f".repeat(length),
      '<a href="https://example.com/' + "&amp;".repeat(length / 5),
      "<code>" + "x".repeat(length),
    ];
    for (const note of notes) {
      const { steps } = parseNoteWithSteps(note);
      expect(steps, note.slice(0, 40)).toBeLessThanOrEqual(2 * note.length);
    }
  });
});

describe("the package source", () => {
  const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));

  const sourceFiles = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? sourceFiles(join(directory, entry.name))
        : [join(directory, entry.name)],
    );

  // The step test counts reads through the scanner's `read` function, so it would miss a search
  // that bypasses it, such as `note.indexOf("</code>")` inside a loop, which is quadratic. This
  // test closes that gap by listing every way the tokenizer touches the note: `length`, the one
  // `charCodeAt` inside `read`, and `slice`, which copies ranges the scanner has already read.
  // Any other property access or index on the note, or an alias that could hide one, fails here.
  it("touches the note only through the counted reader, slice, and length", () => {
    const code = readFileSync(join(sourceRoot, "model", "note.ts"), "utf8")
      .replaceAll(/\/\*[\s\S]*?\*\//g, "")
      .replaceAll(/\/\/.*$/gm, "");
    const accesses = [...code.matchAll(/\bnote\s*(?:\?\.|\.|\[)\s*(\w*)/g)].map(
      (match) => match[1] ?? "",
    );

    expect(accesses.filter((name) => name === "charCodeAt")).toHaveLength(1);
    expect(accesses.filter((name) => !["charCodeAt", "slice", "length"].includes(name))).toEqual(
      [],
    );
    // A bare `note` (not the frame kind `"note"`) is a parameter, or an argument that could alias it. The only allowed ones are
    // the two parameters and `parseNote` passing the note to `parseNoteWithSteps`.
    const bare = [...code.matchAll(/(?<!")\bnote\b(?!"|\s*(?:\?\.|\.|\[))/g)].map((match) =>
      code.slice(Math.max(0, match.index - 20), match.index + 12).replaceAll(/\s+/g, " "),
    );
    expect(bare).toHaveLength(3);
    expect(
      bare.filter((context) => !/= \(note: string|parseNoteWithSteps\(note\)/.test(context)),
    ).toEqual([]);
  });

  it("never uses an HTML string sink", () => {
    const sinks = /unsafeHTML|innerHTML|outerHTML|insertAdjacentHTML|createContextualFragment/;
    const files = sourceFiles(sourceRoot);

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(sinks.test(readFileSync(file, "utf8")), file).toBe(false);
    }
  });
});
