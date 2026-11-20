/// <reference types="vite/client" />
// The element in data mode, in a real browser (issue #198). Each test assigns a payload to `.data`
// and reads the document, so it checks what a page gets, not what the template says.
import type { FeatureResponse } from "@bcd-embed/schema";
import { afterEach, describe, expect, it, vi } from "vitest";

import phase1Page from "../../../docs/planning/phase1-markup/index.html?raw";
import { v1NormalizedFixture } from "../../schema/src/fixtures/v1.js";
import {
  BcdCompatTable,
  LOADED_ATTRIBUTE,
  RENDER_CONTAINER_CLASS,
} from "../src/bcd-compat-table.js";
import type { BcdErrorDetail, BcdLoadDetail } from "../src/index.js";
import "../src/index.js";
import {
  buildLargePayload,
  LARGE_PAYLOAD_PER_FEATURE,
  LARGE_PAYLOAD_TARGETS,
} from "../tests/fixtures/large-payload.js";

const PHASE1_BROWSERS = "chrome opera nodejs";

// A deep copy, so a test can change the fixture without touching the schema package's object.
const copy = <Value>(value: Value): Value => structuredClone(value);

const collapse = (text: string | null): string => (text ?? "").replaceAll(/\s+/g, " ").trim();

type MountOptions = {
  readonly data?: unknown;
  readonly browsers?: string;
  readonly locale?: string;
  readonly fallback?: Node;
};

/** Creates the element, sets it up, adds it to the page, and waits for its first update. */
const mount = async (options: MountOptions = {}): Promise<BcdCompatTable> => {
  const element = document.createElement("bcd-compat-table") as BcdCompatTable;
  if (options.browsers !== undefined) element.setAttribute("browsers", options.browsers);
  if (options.locale !== undefined) element.setAttribute("locale", options.locale);
  if (options.fallback !== undefined) element.append(options.fallback);
  // `data` is typed as a payload, and several tests assign something that is not one.
  if (options.data !== undefined) element.data = options.data as FeatureResponse;
  document.body.append(element);
  await element.updateComplete;
  return element;
};

const mountPhase1 = (options: MountOptions = {}): Promise<BcdCompatTable> =>
  mount({ data: v1NormalizedFixture, browsers: PHASE1_BROWSERS, ...options });

/** Records every `bcd-load` and `bcd-error` that reaches the document, which they do by bubbling. */
const recordEvents = () => {
  const loads: BcdLoadDetail[] = [];
  const errors: BcdErrorDetail[] = [];
  const controller = new AbortController();
  const { signal } = controller;
  document.addEventListener("bcd-load", (event) => loads.push(event.detail), { signal });
  document.addEventListener("bcd-error", (event) => errors.push(event.detail), { signal });
  return { loads, errors, stop: () => controller.abort() };
};

/** The body row whose feature name is `name`. */
const rowOf = (element: Element, name: string): HTMLTableRowElement => {
  const row = [...element.querySelectorAll<HTMLTableRowElement>("tbody tr")].find(
    (candidate) => candidate.querySelector("th code")?.textContent === name,
  );
  if (row === undefined) throw new Error(`No row ${name}`);
  return row;
};

/** The data cell of the row `name` in the 1-based data column `column`. */
const cellOf = (element: Element, name: string, column: number): HTMLTableCellElement => {
  const cell = rowOf(element, name).querySelectorAll("td")[column - 1];
  if (cell === undefined) throw new Error(`No cell ${name} ${column}`);
  return cell;
};

/** Replaces the notes of the fixture's `notes_only` row in Chrome, and returns the payload. */
const withNote = (note: string): FeatureResponse => {
  const payload = copy(v1NormalizedFixture);
  const support = payload.features.find((feature) => feature.name === "notes_only")?.support.chrome;
  const statement = support?.branches[0]?.statements[0];
  if (statement === undefined) throw new Error("The fixture has no notes_only statement");
  statement.notes = [note];
  return payload;
};

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("the table for the Phase 1 fixture", () => {
  it("is one table with a caption, two header rows, and 14 body rows, in a named region", async () => {
    const element = await mountPhase1();

    expect(element.querySelectorAll("table")).toHaveLength(1);
    expect(element.querySelectorAll("caption")).toHaveLength(1);
    expect(element.querySelectorAll("thead tr")).toHaveLength(2);
    expect(element.querySelectorAll("tbody tr")).toHaveLength(14);

    const region = element.querySelector("table")?.parentElement;
    const caption = element.querySelector("caption");
    expect(region?.getAttribute("role")).toBe("region");
    expect(region?.getAttribute("tabindex")).toBe("0");
    expect(caption?.id).not.toBe("");
    expect(region?.getAttribute("aria-labelledby")).toBe(caption?.id);
    expect(collapse(caption?.textContent ?? null)).toBe(
      "Browser compatibility: fixture.adversarial-v1",
    );
  });

  // The shape of an element: its tag, its attributes, its text, and its child elements. The text
  // is the element's whole text with white space collapsed, so the space between two inline
  // elements counts. An element that only lays out other elements, such as a row, has no text of
  // its own: the hand-written page indents its children, and that white space means nothing. The
  // caption's id differs between the page and the element, so every id and every reference to
  // one is replaced by the same word.
  const LAYOUT_TAGS = new Set([
    "div",
    "table",
    "colgroup",
    "thead",
    "tbody",
    "tr",
    "details",
    "ul",
  ]);
  const holdsText = (element: Element): boolean =>
    !LAYOUT_TAGS.has(element.localName) &&
    [...element.children].every((child) => !LAYOUT_TAGS.has(child.localName));
  type Shape = {
    tag: string;
    attributes: Record<string, string>;
    text: string;
    children: Shape[];
  };
  const shapeOf = (element: Element): Shape => ({
    tag: element.localName,
    attributes: Object.fromEntries(
      [...element.attributes]
        .map(({ name, value }): [string, string] => [
          name,
          name === "id" || name === "aria-labelledby" ? "(id)" : collapse(value),
        ])
        .toSorted(([left], [right]) => left.localeCompare(right)),
    ),
    text: holdsText(element) ? collapse(element.textContent) : "",
    // A `<bdi>` wraps each note in the element and has no counterpart in the Phase 1 page. It has
    // no role and no attributes, so its children stand in for it here.
    children: [...element.children].flatMap((child) =>
      child.localName === "bdi" ? [...child.children].map(shapeOf) : [shapeOf(child)],
    ),
  });

  it("matches the Phase 1 page (variant A), element for element and attribute for attribute", async () => {
    const page = new DOMParser().parseFromString(phase1Page, "text/html");
    const expected = page.querySelector(".bcd-scroller");
    const element = await mountPhase1();
    const actual = element.querySelector(".bcd-scroller");

    expect(expected).not.toBeNull();
    expect(actual).not.toBeNull();
    expect(shapeOf(actual as Element)).toEqual(shapeOf(expected as Element));
  });

  it("associates headers by scope: colgroup on the platform row, col on the target row, row on features", async () => {
    const element = await mountPhase1();
    const [platforms, targets] = element.querySelectorAll("thead tr");

    expect(
      [...(platforms?.children ?? [])].map((header) => [
        header.textContent,
        header.getAttribute("scope"),
        header.getAttribute("colspan"),
        header.getAttribute("rowspan"),
      ]),
    ).toEqual([
      ["Feature", "col", null, "2"],
      ["Desktop", "colgroup", "2", null],
      ["Server", "colgroup", null, null],
    ]);
    expect(
      [...(targets?.children ?? [])].map((header) => [
        header.textContent,
        header.getAttribute("scope"),
      ]),
    ).toEqual([
      ["Chrome", "col"],
      ["Opera", "col"],
      ["Node.js", "col"],
    ]);
    for (const header of element.querySelectorAll("tbody th")) {
      expect(header.getAttribute("scope")).toBe("row");
    }
    expect(element.querySelectorAll("[headers]")).toHaveLength(0);
  });

  it("renders the fit-content cell in Chrome as a details whose summary holds the hidden glyph and the sentence", async () => {
    const element = await mountPhase1();
    const cell = cellOf(element, "fit-content", 1);
    const details = cell.querySelector(":scope > details");
    const spans = [...(details?.querySelectorAll(":scope > summary > span") ?? [])];

    expect(details).not.toBeNull();
    expect(spans).toHaveLength(2);
    expect(spans[0]?.getAttribute("aria-hidden")).toBe("true");
    expect(spans[0]?.hasAttribute("hidden")).toBe(true);
    expect(collapse(spans[0]?.textContent ?? null)).toBe("✓ 46");
    expect(spans[1]?.hasAttribute("hidden")).toBe(false);
    expect(spans[1]?.textContent).toBe(
      "Supported since Chrome 46. History for fit-content in Chrome",
    );
    expect([...cell.querySelectorAll("li")].map((item) => collapse(item.textContent))).toEqual([
      "Supported since Chrome 46.",
      "With the prefix -webkit-: supported since Chrome 22.",
      "Under the name intrinsic: supported from Chrome 1, removed in Chrome 48.",
    ]);
    expect([...cell.querySelectorAll("li code")].map((code) => code.textContent)).toEqual([
      "-webkit-",
      "intrinsic",
    ]);
  });

  it("renders a cell with nothing further to say without a details and without a tab stop", async () => {
    const element = await mountPhase1();
    const cell = cellOf(element, "missing_target", 1);

    expect(cell.querySelector("details, summary")).toBeNull();
    expect(cell.querySelector("a, button, [tabindex]")).toBeNull();
    expect(cell.hasAttribute("tabindex")).toBe(false);
    expect(collapse(cell.textContent)).toBe("✓ 1Supported since Chrome 1");
  });

  it("gives tab stops only to the region and the five disclosures", async () => {
    const element = await mountPhase1();
    const stops = [...element.querySelectorAll<HTMLElement>("*")].filter(
      (candidate) => candidate.tabIndex >= 0,
    );

    expect(stops.map((stop) => stop.localName)).toEqual([
      "div",
      "summary",
      "summary",
      "summary",
      "summary",
      "summary",
    ]);
  });

  it("reads every cell as its full sentence when no stylesheet is loaded", async () => {
    const element = await mountPhase1();
    const cells = [...element.querySelectorAll<HTMLTableCellElement>("tbody td")];

    expect(cells).toHaveLength(42);
    for (const cell of cells) {
      const compact = cell.querySelector<HTMLElement>("span[aria-hidden='true']");
      const sentence = cell.querySelector("span.visually-hidden");
      expect(compact?.hidden).toBe(true);
      // No rule styles the sentence, so nothing moves it out of view.
      expect(getComputedStyle(sentence as Element).position).toBe("static");
      expect(getComputedStyle(compact as Element).display).toBe("none");
      // `innerText` is the text a reader sees: it leaves out the hidden glyph and a closed
      // disclosure's history.
      expect(collapse(cell.innerText)).toBe(collapse(sentence?.textContent ?? null));
      expect(collapse(cell.innerText)).not.toBe("");
    }
  });

  it("gives every table on a page its own ids", async () => {
    const elements = [await mountPhase1(), await mountPhase1(), await mountPhase1()];
    const ids = [...document.querySelectorAll("[id]")].map((node) => node.id);

    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(ids.length);
    for (const element of elements) {
      const labelledBy = element.querySelector("[role='region']")?.getAttribute("aria-labelledby");
      expect(element.querySelector("caption")?.id).toBe(labelledBy);
    }
  });
});

describe("the columns", () => {
  it("shows one target and one group for browsers=chrome, and re-renders once when the attribute changes", async () => {
    const element = await mountPhase1({ browsers: "chrome" });
    const events = recordEvents();
    const render = vi.spyOn(
      BcdCompatTable.prototype as unknown as { render: () => unknown },
      "render",
    );

    expect(
      [...element.querySelectorAll("thead tr")].map((row) => collapse(row.textContent)),
    ).toEqual(["FeatureDesktop", "Chrome"]);
    expect(element.querySelectorAll("tbody tr:first-child td")).toHaveLength(1);

    element.setAttribute("browsers", "chrome nodejs");
    await element.updateComplete;

    expect(render).toHaveBeenCalledTimes(1);
    expect(
      [...element.querySelectorAll("thead tr:first-child th")].map((header) => header.textContent),
    ).toEqual(["Feature", "Desktop", "Server"]);
    expect(element.querySelectorAll("tbody tr:first-child td")).toHaveLength(2);
    // The same payload is still rendered, so the change announces nothing.
    expect(events.loads).toEqual([]);
    expect(events.errors).toEqual([]);
    events.stop();
  });

  it("reflects the browsers and locale attributes as properties, and null when they are absent", async () => {
    const element = await mountPhase1({ locale: "en-GB" });

    expect(element.browsers).toBe(PHASE1_BROWSERS);
    expect(element.locale).toBe("en-GB");

    element.removeAttribute("browsers");
    element.removeAttribute("locale");
    await element.updateComplete;

    expect(element.browsers).toBeNull();
    expect(element.locale).toBeNull();
    // The default set, intersected with the payload: the fixture has no Firefox and no Safari.
    expect(
      [...element.querySelectorAll("thead tr:last-child th")].map((header) => header.textContent),
    ).toEqual(["Chrome", "Node.js"]);
  });

  it("uses English for an unknown locale", async () => {
    const element = await mountPhase1({ locale: "xx" });

    expect(collapse(element.querySelector("caption")?.textContent ?? null)).toBe(
      "Browser compatibility: fixture.adversarial-v1",
    );
    expect(element.querySelector("thead th")?.textContent).toBe("Feature");
    expect(
      cellOf(element, "missing_target", 1).querySelector(".visually-hidden")?.textContent,
    ).toBe("Supported since Chrome 1");
  });

  it("shows no 'or earlier' in any cell for a contract 1.0.0 payload", async () => {
    const payload = copy(v1NormalizedFixture) as unknown as {
      contract: string;
      features: { support: Record<string, { summary: Record<string, unknown> }> }[];
    };
    payload.contract = "1.0.0";
    for (const feature of payload.features) {
      for (const support of Object.values(feature.support)) {
        delete support.summary.versionAddedIsApproximate;
      }
    }
    const element = await mountPhase1({ data: payload });
    const sentences = [...element.querySelectorAll("tbody td .visually-hidden")].map(
      (sentence) => sentence.textContent ?? "",
    );
    const compacts = [...element.querySelectorAll("tbody td span[aria-hidden='true']")].map(
      (compact) => compact.textContent ?? "",
    );

    expect(sentences).toHaveLength(42);
    for (const sentence of sentences) expect(sentence).not.toContain("or earlier");
    for (const compact of compacts) expect(compact).not.toContain("≤");
    // The summary no longer says the version is approximate, so the cell reads as an exact one.
    // The statement still says so, and the model keeps that in a disclosure rather than lose it.
    const localName = cellOf(element, "localName", 2);
    expect(localName.querySelector("summary .visually-hidden")?.textContent).toBe(
      "Supported since Opera 12.1. History for localName in Opera",
    );
  });
});

describe("re-rendering", () => {
  const openDisclosures = (element: Element): string[] =>
    [...element.querySelectorAll<HTMLDetailsElement>("details")]
      .filter((details) => details.open)
      .map((details) => details.querySelector("summary .visually-hidden")?.textContent ?? "");

  it("keeps an open disclosure with its own cell when the columns change", async () => {
    const element = await mountPhase1({ browsers: "chrome" });
    const details = cellOf(element, "abort", 1).querySelector("details");
    if (details === null) throw new Error("The abort cell has no disclosure");
    details.open = true;

    // Opera's column now comes first, and the localName row gains a disclosure-free Opera cell.
    element.setAttribute("browsers", "opera chrome");
    await element.updateComplete;

    expect(openDisclosures(element)).toEqual([
      "Supported since Chrome 18. History for abort in Chrome",
    ]);
    expect(cellOf(element, "abort", 2).querySelector("details")).toBe(details);
  });

  it("opens no disclosure of a new payload whose features differ", async () => {
    const element = await mountPhase1({ browsers: "chrome" });
    for (const details of element.querySelectorAll("details")) details.open = true;
    const payload = copy(v1NormalizedFixture);
    payload.features = payload.features.filter((feature) => feature.name !== "fit-content");

    element.data = payload;
    await element.updateComplete;

    // The rows that stayed keep their state. No disclosure moved to a row that had none.
    expect(element.querySelectorAll("tbody tr")).toHaveLength(13);
    expect(openDisclosures(element)).toEqual([
      "Supported since Chrome 18. History for abort in Chrome",
      "Supported since Chrome 37 behind a flag. Flag details for AudioTrackList in Chrome",
      "Supported from Chrome 11.1, then removed in Chrome 12.1. History and notes for removed_partial in Chrome",
      "Supported since Chrome 20. Notes for notes_only in Chrome",
    ]);
  });

  it("rejects a payload that repeats a feature key, because each row is keyed by it", async () => {
    const payload = copy(v1NormalizedFixture);
    const first = payload.features[0];
    if (first === undefined) throw new Error("The fixture has no features");
    payload.features = [first, copy(first), ...payload.features.slice(1)];
    const events = recordEvents();

    const element = await mountPhase1({ data: payload });

    expect(events.errors).toHaveLength(1);
    expect(element.querySelector("table")).toBeNull();
    events.stop();
  });
});

describe("markup in a payload", () => {
  it("renders markup in every other payload string as literal text", async () => {
    // A feature's name may not contain a dot, so the script sets a global without one.
    const markup = "<img src=x onerror=__x=1>";
    const payload = copy(v1NormalizedFixture);
    payload.query = markup;
    (payload.browsers.chrome as { name: string }).name = markup;
    const feature = payload.features.find((candidate) => candidate.name === "fit-content");
    const flagged = payload.features.find((candidate) => candidate.name === "AudioTrackList");
    const flag = flagged?.support.chrome?.branches[0]?.statements[0]?.flags[0];
    if (feature === undefined || flag === undefined) throw new Error("The fixture changed");
    feature.key = markup;
    feature.name = markup;
    for (const branch of feature.support.chrome?.branches ?? []) {
      for (const statement of branch.statements as {
        prefix: unknown;
        alternativeName: unknown;
      }[]) {
        if (statement.prefix !== null) statement.prefix = markup;
        if (statement.alternativeName !== null) statement.alternativeName = markup;
      }
    }
    (flag as { name: string; valueToSet: string }).name = markup;
    (flag as { name: string; valueToSet: string }).valueToSet = markup;

    const element = await mountPhase1({ data: payload });
    for (const details of element.querySelectorAll("details")) details.open = true;
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect((window as unknown as { __x?: unknown }).__x).toBeUndefined();
    expect(element.querySelector("img")).toBeNull();
    expect(element.querySelector("caption")?.textContent).toContain(markup);
    expect(element.querySelector("thead tr:last-child th")?.textContent).toBe(markup);
    expect(element.querySelector("tbody th code")?.textContent).toBe(markup);
    // The prefix, the alternative name, the flag's name, and the flag's value.
    expect(
      [...element.querySelectorAll("li code")].filter((code) => code.textContent === markup),
    ).toHaveLength(4);
  });
});

describe("notes", () => {
  it("renders markup in a note as literal text, and runs no script from it", async () => {
    const note = '<img src=x onerror="window.__x=1">';
    const element = await mountPhase1({ data: withNote(note) });
    const details = cellOf(element, "notes_only", 1).querySelector("details");
    if (details === null) throw new Error("The notes_only cell has no disclosure");

    details.open = true;
    // An image that fails to load reports its error in a later task, so wait for more than one.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect((window as unknown as { __x?: unknown }).__x).toBeUndefined();
    expect(element.querySelector("img")).toBeNull();
    expect(details.querySelector("bdi")?.textContent).toBe(note);
    expect(collapse(details.innerText)).toContain(`Note: ${note}`);
  });

  it("decodes entities once, into one text node, and creates no element from them", async () => {
    const element = await mountPhase1({ data: withNote("Use &lt;video&gt; &amp; more") });
    const details = cellOf(element, "notes_only", 1).querySelector("details");
    if (details === null) throw new Error("The notes_only cell has no disclosure");

    details.open = true;
    const note = details.querySelector("bdi");
    const textNodes = [...(note?.childNodes ?? [])].filter(
      (node) => node.nodeType === Node.TEXT_NODE && node.nodeValue !== "",
    );

    expect(textNodes.map((node) => node.nodeValue)).toEqual(["Use <video> & more"]);
    expect(note?.children).toHaveLength(0);
    expect(collapse(details.innerText)).toContain("Note: Use <video> & more");
    expect(element.querySelector("table video")).toBeNull();
  });

  it("renders code, emphasis, and a checked link from a note, and nothing else as an element", async () => {
    const element = await mountPhase1({
      data: withNote(
        'See <a href="https://example.com/bug?id=1&amp;x=2">bug <code>1</code></a>, <em>not</em> ' +
          '<a href="javascript:alert(1)">this</a> <script>window.__x=1</script>.',
      ),
    });
    const note = cellOf(element, "notes_only", 1).querySelector("bdi");
    const link = note?.querySelector("a");

    expect([...(note?.querySelectorAll("*") ?? [])].map((node) => node.localName)).toEqual([
      "a",
      "code",
      "em",
    ]);
    expect(link?.getAttribute("href")).toBe("https://example.com/bug?id=1&x=2");
    expect(link?.textContent).toBe("bug 1");
    expect(note?.textContent).toContain('<a href="javascript:alert(1)">this</a>');
    expect(note?.textContent).toContain("<script>window.__x=1</script>");
    expect((window as unknown as { __x?: unknown }).__x).toBeUndefined();
  });
});

describe("events", () => {
  it("fires one bcd-load for a valid payload, after the table is in the document", async () => {
    const events = recordEvents();
    let tableAtLoad: Element | null = null;
    let loadedAtLoad = false;
    document.addEventListener(
      "bcd-load",
      (event) => {
        const target = event.target as Element;
        tableAtLoad = target.querySelector("table");
        loadedAtLoad = target.hasAttribute(LOADED_ATTRIBUTE);
      },
      { once: true },
    );

    const element = await mountPhase1();

    expect(events.loads).toEqual([{ mode: "data", snapshot: null }]);
    expect(events.errors).toEqual([]);
    expect(tableAtLoad).toBe(element.querySelector("table"));
    expect(tableAtLoad).not.toBeNull();
    expect(loadedAtLoad).toBe(true);
    events.stop();
  });

  it("fires one bcd-error with the invalid-payload reason for an invalid payload", async () => {
    const events = recordEvents();

    const element = await mount({ data: { contract: "1.1.0", query: "x" } });

    expect(events.errors).toEqual([
      { mode: "data", reason: "invalid-payload", status: null, code: null },
    ]);
    expect(events.loads).toEqual([]);
    expect(element.querySelector("table")).toBeNull();
    expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(false);
    events.stop();
  });

  it.for([
    ["a string", "not a payload"],
    ["a number", 42],
    ["an array", []],
    ["a contract 2 payload", { ...v1NormalizedFixture, contract: "2.0.0" }],
    ["a payload with a malformed statement", { ...v1NormalizedFixture, features: [{}] }],
  ] as const)("reports %s as an invalid payload", async ([, data]) => {
    const events = recordEvents();

    const element = await mount({ data });

    expect(events.errors).toHaveLength(1);
    expect(events.errors[0]?.reason).toBe("invalid-payload");
    expect(element.querySelector("table")).toBeNull();
    events.stop();
  });

  it("fires one event for each assigned payload, and none for null", async () => {
    const element = await mountPhase1();
    const events = recordEvents();

    element.data = copy(v1NormalizedFixture);
    await element.updateComplete;
    element.data = null;
    await element.updateComplete;
    element.data = { nonsense: true } as unknown as FeatureResponse;
    await element.updateComplete;
    element.data = v1NormalizedFixture;
    await element.updateComplete;

    expect(events.loads).toHaveLength(2);
    expect(events.errors).toHaveLength(1);
    events.stop();
  });

  it("fires bcd-error when a browsers change makes the payload unreadable, and bcd-load when it recovers", async () => {
    // The model checks only the support targets it displays, so this payload renders until the
    // table is asked to show the target whose entry has no name.
    const payload = copy(v1NormalizedFixture) as unknown as {
      browsers: Record<string, { name?: string }>;
    };
    delete payload.browsers.opera?.name;
    const element = await mount({ data: payload, browsers: "chrome" });
    const events = recordEvents();

    element.setAttribute("browsers", "chrome opera");
    await element.updateComplete;

    expect(events.errors).toHaveLength(1);
    expect(element.querySelector("table")).toBeNull();
    expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(false);

    element.setAttribute("browsers", "chrome");
    await element.updateComplete;

    expect(events.loads).toHaveLength(1);
    expect(element.querySelector("table")).not.toBeNull();
    events.stop();
  });
});

describe("when events fire", () => {
  it("fires one bcd-load for data assigned before the element is defined", async () => {
    // The page's `bcd-compat-table` is already defined by the import above, so this test takes
    // the same class through a real upgrade under a tag name that is not defined yet.
    const tagName = "bcd-compat-table-defined-late";
    const element = document.createElement(tagName) as BcdCompatTable;
    element.setAttribute("browsers", PHASE1_BROWSERS);
    // Not upgraded yet, so this is an ordinary own property on a plain element.
    element.data = v1NormalizedFixture;
    document.body.append(element);
    expect(Object.hasOwn(element, "data")).toBe(true);
    expect(element.querySelector("table")).toBeNull();
    const events = recordEvents();

    customElements.define(tagName, class extends BcdCompatTable {});
    await element.updateComplete;

    expect(element).toBeInstanceOf(BcdCompatTable);
    // The upgrade moved the value from the own property to the class's accessor.
    expect(Object.hasOwn(element, "data")).toBe(false);
    expect(element.data).toBe(v1NormalizedFixture);
    expect(events.loads).toEqual([{ mode: "data", snapshot: null }]);
    expect(events.errors).toEqual([]);
    expect(element.querySelectorAll("tbody tr")).toHaveLength(14);
    expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(true);
    events.stop();
  });

  it("holds an event back while the element is out of the document, and fires it on return", async () => {
    const element = await mountPhase1();
    const events = recordEvents();
    const onElement: string[] = [];
    element.addEventListener("bcd-load", (event) => onElement.push(event.type));

    element.remove();
    element.data = copy(v1NormalizedFixture);
    await element.updateComplete;

    // The table is rendered, but no listener on the document could hear an event now.
    expect(element.querySelectorAll("tbody tr")).toHaveLength(14);
    expect(onElement).toEqual([]);
    expect(events.loads).toEqual([]);

    document.body.append(element);

    expect(events.loads).toEqual([{ mode: "data", snapshot: null }]);
    expect(onElement).toEqual(["bcd-load"]);

    // Nothing is owed any more, so a second return fires nothing.
    element.remove();
    document.body.append(element);
    await element.updateComplete;
    expect(events.loads).toHaveLength(1);
    events.stop();
  });

  it("fires one event, for the final state, after several changes made out of the document", async () => {
    const element = await mountPhase1();
    const events = recordEvents();

    element.remove();
    element.data = copy(v1NormalizedFixture);
    await element.updateComplete;
    element.setAttribute("browsers", "chrome");
    await element.updateComplete;
    element.data = { nonsense: true } as unknown as FeatureResponse;
    await element.updateComplete;
    document.body.append(element);

    expect(events.loads).toEqual([]);
    expect(events.errors).toHaveLength(1);

    element.remove();
    element.data = null;
    await element.updateComplete;
    document.body.append(element);

    // The element is empty again, and an empty element announces nothing.
    expect(events.loads).toEqual([]);
    expect(events.errors).toHaveLength(1);
    events.stop();
  });

  it("fires one event for two payloads assigned one after the other, and none for the same object", async () => {
    const element = await mountPhase1();
    const events = recordEvents();
    const second = copy(v1NormalizedFixture);
    second.query = "fixture.second";

    // Lit batches both assignments into one update, which renders the second payload.
    element.data = copy(v1NormalizedFixture);
    element.data = second;
    await element.updateComplete;

    expect(events.loads).toHaveLength(1);
    expect(element.querySelector("caption")?.textContent).toContain("fixture.second");

    // The same object again is no change, so no update runs.
    element.data = second;
    await element.updateComplete;

    expect(events.loads).toHaveLength(1);
    events.stop();
  });
});

describe("the error sentence", () => {
  const invalid = { contract: "nope" } as unknown as FeatureResponse;
  const sentence = "Browser compatibility data could not be shown.";
  const errorParagraphs = (element: Element): string[] =>
    [...element.querySelectorAll(`.${RENDER_CONTAINER_CLASS} > p.bcd-error`)].map(
      (paragraph) => paragraph.textContent ?? "",
    );

  it("shows when the payload is invalid and the author gave no fallback content", async () => {
    const element = await mount({ data: invalid });

    expect(errorParagraphs(element)).toEqual([sentence]);
    expect(collapse(element.innerText)).toBe(sentence);
    expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(false);
  });

  it("shows when the only children are white space and a comment", async () => {
    const element = await mount({ data: invalid, fallback: document.createComment("none") });
    element.prepend("\n  ");
    await element.updateComplete;

    expect(errorParagraphs(element)).toEqual([sentence]);
  });

  it.for([
    ["an element", () => document.createElement("p")],
    ["bare text", () => document.createTextNode("Not available")],
  ] as const)("does not show when the fallback is %s", async ([, create]) => {
    const element = await mount({ data: invalid, fallback: create() });

    expect(errorParagraphs(element)).toEqual([]);
    expect(element.querySelector(`.${RENDER_CONTAINER_CLASS}`)?.childElementCount).toBe(0);
  });

  it("goes when fallback content arrives, and comes back when it leaves", async () => {
    const element = await mount({ data: invalid });
    const events = recordEvents();
    const paragraph = document.createElement("p");
    paragraph.textContent = "Fallback";

    // A framework, or the parser of an element defined early, adds children after the error.
    element.append(paragraph);
    await Promise.resolve();
    await element.updateComplete;
    expect(errorParagraphs(element)).toEqual([]);

    paragraph.remove();
    await Promise.resolve();
    await element.updateComplete;
    expect(errorParagraphs(element)).toEqual([sentence]);
    // The state did not change, so neither re-render announced anything.
    expect(events.errors).toEqual([]);
    events.stop();
  });

  it("goes when a valid payload renders or data becomes null", async () => {
    const element = await mount({ data: invalid, browsers: PHASE1_BROWSERS });

    element.data = v1NormalizedFixture;
    await element.updateComplete;
    expect(errorParagraphs(element)).toEqual([]);
    expect(element.querySelectorAll("tbody tr")).toHaveLength(14);

    element.data = invalid;
    await element.updateComplete;
    expect(errorParagraphs(element)).toEqual([sentence]);

    element.data = null;
    await element.updateComplete;
    expect(errorParagraphs(element)).toEqual([]);
    expect(element.querySelector(`.${RENDER_CONTAINER_CLASS}`)?.childElementCount).toBe(0);
  });
});

describe("fallback content", () => {
  const fallback = (): HTMLParagraphElement => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "Fallback";
    return paragraph;
  };

  it("keeps the author's child in place, and marks the element as loaded only while a table shows", async () => {
    const paragraph = fallback();
    const element = await mountPhase1({ fallback: paragraph });

    expect(paragraph.parentNode).toBe(element);
    expect(paragraph.hasAttribute("hidden")).toBe(false);
    expect(paragraph.outerHTML).toBe("<p>Fallback</p>");
    expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(true);

    element.data = { contract: "nope" } as unknown as FeatureResponse;
    await element.updateComplete;

    expect(paragraph.parentNode).toBe(element);
    expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(false);
    expect(element.querySelector("table")).toBeNull();
  });

  it("hides the fallback with the base stylesheet's rule, and shows it again after an error", async () => {
    // The rule from Document 3 section 4, "Fallback content". The base stylesheet ships it in
    // Phase 3. The three-engine test checks the same rule from a stylesheet file.
    const style = document.createElement("style");
    style.textContent = `
      bcd-compat-table[loaded] { visibility: hidden; }
      bcd-compat-table[loaded] > :not(.bcd-render-container) { display: none; }
      bcd-compat-table[loaded] > .bcd-render-container { visibility: visible; }
    `;
    document.head.append(style);
    const paragraph = fallback();
    try {
      const element = await mountPhase1({ fallback: paragraph });
      const container = element.querySelector(`.${RENDER_CONTAINER_CLASS}`);

      expect(getComputedStyle(paragraph).display).toBe("none");
      expect(getComputedStyle(container as Element).visibility).toBe("visible");
      expect(getComputedStyle(element.querySelector("table") as Element).visibility).toBe(
        "visible",
      );

      element.data = null;
      await element.updateComplete;

      expect(getComputedStyle(paragraph).display).toBe("block");
      expect(getComputedStyle(paragraph).visibility).toBe("visible");
    } finally {
      style.remove();
    }
  });

  it("removes the table and the loaded attribute when data becomes null", async () => {
    const paragraph = fallback();
    const element = await mountPhase1({ fallback: paragraph });
    const events = recordEvents();

    element.data = null;
    await element.updateComplete;

    expect(element.querySelector("table")).toBeNull();
    expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(false);
    expect(paragraph.parentNode).toBe(element);
    expect(element.querySelectorAll(`.${RENDER_CONTAINER_CLASS}`)).toHaveLength(1);
    expect(events.loads).toEqual([]);
    expect(events.errors).toEqual([]);
    events.stop();
  });

  it("renders into one container of its own, after the children that exist when it connects", async () => {
    const paragraph = fallback();
    const element = await mountPhase1({ fallback: paragraph });

    expect(element.shadowRoot).toBeNull();
    expect([...element.children].map((child) => child.className || child.localName)).toEqual([
      "p",
      RENDER_CONTAINER_CLASS,
    ]);
    expect(element.querySelector(`.${RENDER_CONTAINER_CLASS} > .bcd-scroller`)).not.toBeNull();
  });

  it("drops the copied table from a deep copy of a rendered element, so no id is duplicated", async () => {
    const paragraph = fallback();
    const element = await mountPhase1({ fallback: paragraph });

    // The copy carries the first element's container, table, and caption id, but not its data.
    const clone = element.cloneNode(true) as BcdCompatTable;
    document.body.append(clone);
    await clone.updateComplete;

    expect(clone.querySelectorAll(`.${RENDER_CONTAINER_CLASS}`)).toHaveLength(1);
    expect(clone.querySelector("table")).toBeNull();
    expect(clone.hasAttribute(LOADED_ATTRIBUTE)).toBe(false);
    expect(clone.querySelector("p")?.textContent).toBe("Fallback");

    clone.data = v1NormalizedFixture;
    await clone.updateComplete;

    const ids = [...document.querySelectorAll("[id]")].map((node) => node.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(clone.querySelectorAll("table")).toHaveLength(1);
  });

  it("removes a copied container that arrives after the element connected, as from saved HTML", async () => {
    const element = await mountPhase1();
    const container = element.querySelector(`.${RENDER_CONTAINER_CLASS}`);

    // When the element is defined before the parser reaches it, the parser adds the children of
    // saved HTML, the old container among them, after the element has made its own.
    const stale = document.createElement("div");
    stale.className = RENDER_CONTAINER_CLASS;
    stale.append(document.createElement("table"));
    element.append(stale);
    await Promise.resolve();

    expect(stale.parentNode).toBeNull();
    expect([...element.querySelectorAll(`.${RENDER_CONTAINER_CLASS}`)]).toEqual([container]);
    expect(element.querySelectorAll("table")).toHaveLength(1);
  });

  it("keeps one container when the element is removed and added again", async () => {
    const element = await mountPhase1();
    const container = element.querySelector(`.${RENDER_CONTAINER_CLASS}`);

    element.remove();
    document.body.append(element);
    element.setAttribute("browsers", "chrome");
    await element.updateComplete;

    expect(element.querySelectorAll(`.${RENDER_CONTAINER_CLASS}`)).toHaveLength(1);
    expect(element.querySelector(`.${RENDER_CONTAINER_CLASS}`)).toBe(container);
    expect(container?.querySelectorAll("thead tr:last-child th")).toHaveLength(1);
  });

  it("puts its container back when a script replaces every child, as React does for a string child", async () => {
    const element = await mountPhase1();
    const container = element.querySelector(`.${RENDER_CONTAINER_CLASS}`);

    // React assigns `textContent` when a single string child changes, which removes the container.
    element.textContent = "Loaded";
    expect(container?.parentNode).toBeNull();
    // A MutationObserver callback runs as a microtask.
    await Promise.resolve();

    expect(container?.parentNode).toBe(element);
    expect(element.querySelectorAll(`.${RENDER_CONTAINER_CLASS}`)).toHaveLength(1);
    expect(element.querySelectorAll("tbody tr")).toHaveLength(14);
    expect(element.firstChild?.nodeValue).toBe("Loaded");

    element.setAttribute("browsers", "chrome");
    await element.updateComplete;
    expect(element.querySelectorAll("thead tr:last-child th")).toHaveLength(1);
  });

  it("puts its container back when it was removed while the element was out of the document", async () => {
    const element = await mountPhase1();

    element.remove();
    element.textContent = "Loaded";
    document.body.append(element);
    await element.updateComplete;

    expect(element.querySelectorAll(`.${RENDER_CONTAINER_CLASS} tbody tr`)).toHaveLength(14);
  });
});

describe("the size of the rendered tree", () => {
  it("stays within the documented bound for 2,000 features and four targets", async () => {
    const featureCount = 2000;
    const targetCount = LARGE_PAYLOAD_TARGETS.length;
    const element = await mount({ data: buildLargePayload(featureCount) });
    const elementCount = element.querySelectorAll("*").length;

    // The bound, from `src/render/table.ts`, for F features, T targets, and L history lines:
    //
    //   1 + 9 + 3T      the render container, then the region, table, caption, feature colgroup,
    //                   thead, its two rows, the feature header, and tbody, then at most one
    //                   colgroup, one group header, and one target header for each target
    //   4F              tr, th, code, and the part-of span for each row
    //   7 × F × T       td, two spans, the compact code, details, summary, and ul for each cell
    //   3L              li, and a bdi or at most two code elements, for each history line
    //   E               one element for each code, emphasis, or link segment in a note
    //
    // A statement gives at most three history lines of its own (its sentence, a line that names
    // its prefix or alternative name, and its last-supported version), then one line for each of
    // its flags and notes. So L is at most 3S + flags + notes, for S statements.
    const statements = featureCount * LARGE_PAYLOAD_PER_FEATURE.statements;
    const flags = featureCount * LARGE_PAYLOAD_PER_FEATURE.flags;
    const notes = featureCount * LARGE_PAYLOAD_PER_FEATURE.notes;
    const noteElements = featureCount * LARGE_PAYLOAD_PER_FEATURE.noteElements;
    const historyLines = 3 * statements + flags + notes;
    const bound =
      1 +
      9 +
      3 * targetCount +
      4 * featureCount +
      7 * featureCount * targetCount +
      3 * historyLines +
      noteElements;

    expect(element.querySelectorAll("tbody tr")).toHaveLength(featureCount);
    expect(element.querySelectorAll("tbody td")).toHaveLength(featureCount * targetCount);
    expect(elementCount).toBeLessThanOrEqual(bound);
    // Because F × T is at least F and at least T, the bound is under 14 × F × T + 9 × S + E + 10
    // when S also counts each flag and note. That is the multiple the README records.
    expect(bound).toBeLessThanOrEqual(
      14 * featureCount * targetCount + 9 * (statements + flags + notes) + noteElements + 10,
    );
    // The exact count for this payload, so a change to the markup shows up here: per feature,
    // 4 cells, 2 disclosures, 5 history lines, 1 bdi, and 3 code elements in the history, and a
    // part-of span on four rows of every five.
    expect(elementCount).toBe(
      1 + 9 + 2 + 2 + 4 + featureCount * (3 + 4 * 3 + 2 * 3 + 5 + 1 + 3) + (featureCount * 4) / 5,
    );
  }, 60_000);
});
