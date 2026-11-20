/// <reference types="vite/client" />
// The element in source mode, in a real browser (issue #205). Each test builds the two fragments a
// page needs, a JSON script and the element that names it, and reads the document, so it checks
// what a page gets. No test sends a request: `fetch` is replaced by a spy that fails the test.
import type { FeatureResponse } from "@bcd-embed/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import { v1NormalizedFixture } from "../../schema/src/fixtures/v1.js";
import { BcdCompatTable, LOADED_ATTRIBUTE } from "../src/bcd-compat-table.js";
import type { BcdErrorDetail, BcdLoadDetail } from "../src/index.js";
import "../src/index.js";

const SOURCE_ID = "bcd-data-fixture-adversarial-v1";

/** The escape rule the README gives pages: every `<` becomes the six characters `<`. */
const toScriptJson = (value: unknown): string => JSON.stringify(value).replaceAll("<", "\\u003c");

const copy = <Value>(value: Value): Value => structuredClone(value);

/** The fixture with the text of its `notes_only` note in Chrome replaced. */
const withNote = (note: string): FeatureResponse => {
  const payload = copy(v1NormalizedFixture);
  const statement = payload.features.find((feature) => feature.name === "notes_only")?.support
    .chrome?.branches[0]?.statements[0];
  if (statement === undefined) throw new Error("The fixture has no notes_only statement");
  statement.notes = [note];
  return payload;
};

/**
 * A script element with an `id`, a `type`, and text. A script that the HTML parser made counts as
 * "already started", and a clone of it keeps that flag, so this one never runs, whatever its type.
 * A script made with `createElement` runs when it gets text and joins the document, and a test
 * that holds JSON in a script with no type, or type `module`, would run the JSON as code.
 */
const makeScript = (id: string, text: string, type: string | null = "application/json") => {
  const template = document.createElement("template");
  template.innerHTML = "<script></script>";
  const script = template.content.querySelector("script");
  if (script === null) throw new Error("The parser made no script element");
  script.id = id;
  if (type !== null) script.setAttribute("type", type);
  script.textContent = text;
  return script;
};

const makeElement = (attributes: Record<string, string>, fallback = false): BcdCompatTable => {
  const element = document.createElement("bcd-compat-table") as BcdCompatTable;
  element.setAttribute("browsers", "chrome opera nodejs");
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  if (fallback) {
    const paragraph = document.createElement("p");
    paragraph.textContent = "Fallback: see MDN Web Docs.";
    element.append(paragraph);
  }
  return element;
};

/** Adds the script to the page, then the element, and waits for the element's first update. */
const mount = async (
  attributes: Record<string, string>,
  options: { text?: string; fallback?: boolean } = {},
): Promise<BcdCompatTable> => {
  document.body.append(makeScript(SOURCE_ID, options.text ?? toScriptJson(v1NormalizedFixture)));
  const element = makeElement({ source: SOURCE_ID, ...attributes }, options.fallback);
  document.body.append(element);
  await element.updateComplete;
  return element;
};

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

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const ERROR_SENTENCE = "Browser compatibility data could not be shown.";

let fetchSpy: MockInstance<typeof fetch>;
let events: ReturnType<typeof recordEvents>;

beforeEach(() => {
  fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() => Promise.reject(new Error("Source mode must not send a request.")));
  events = recordEvents();
});

afterEach(() => {
  events.stop();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("a source that names a JSON script", () => {
  it("renders the table, sends no request, and fires one bcd-load with mode source", async () => {
    const element = await mount({});

    expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(true);
    expect(element.querySelectorAll("tbody tr")).toHaveLength(14);
    expect(element.querySelector("caption")?.textContent?.trim()).toBe(
      "Browser compatibility: fixture.adversarial-v1",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(events.loads).toEqual([{ mode: "source", snapshot: null }]);
    expect(events.errors).toEqual([]);
  });

  it("reports source-missing for a script added after the element connected, on a page that has finished loading", async () => {
    // A script that adds both fragments to a page that has finished loading, element first, has no
    // parser to wait for: nothing will add the script before the element looks, so the reference
    // is wrong. The streaming case, where the parser is still running, is the next describe block.
    const element = makeElement({ source: SOURCE_ID });
    document.body.append(element);
    document.body.append(makeScript(SOURCE_ID, toScriptJson(v1NormalizedFixture)));
    await element.updateComplete;

    expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(false);
    expect(events.errors).toEqual([
      { mode: "source", reason: "source-missing", status: null, code: null },
    ]);
  });

  it("renders a script inside the same shadow root as the element", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.append(makeScript(SOURCE_ID, toScriptJson(v1NormalizedFixture)));
    const element = makeElement({ source: SOURCE_ID });
    // The events bubble but are not composed, so they stop at the shadow root, not the document.
    const loads: BcdLoadDetail[] = [];
    shadow.addEventListener("bcd-load", (event) => {
      loads.push((event as CustomEvent<BcdLoadDetail>).detail);
    });
    shadow.append(element);
    await element.updateComplete;

    expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(true);
    expect(loads).toEqual([{ mode: "source", snapshot: null }]);
  });

  it("accepts the type in any letter case", async () => {
    document.body.append(makeScript("loud", toScriptJson(v1NormalizedFixture), "APPLICATION/JSON"));
    const element = makeElement({ source: "loud" });
    document.body.append(element);
    await element.updateComplete;

    expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(true);
  });
});

describe("a source that fails", () => {
  it("reports source-missing for an id that matches nothing, and keeps the fallback", async () => {
    const element = await mount({ source: "missing" }, { fallback: true });

    expect(events.errors).toEqual([
      { mode: "source", reason: "source-missing", status: null, code: null },
    ]);
    expect(events.loads).toEqual([]);
    expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(false);
    expect(element.querySelector("table")).toBeNull();
    expect(element.querySelector("p:not(.bcd-error)")?.textContent).toBe(
      "Fallback: see MDN Web Docs.",
    );
    expect(element.querySelector(".bcd-error")).toBeNull();
  });

  it("shows one sentence when the page gave no fallback content", async () => {
    const element = await mount({ source: "missing" });

    expect(element.querySelector(".bcd-error")?.textContent).toBe(ERROR_SENTENCE);
  });

  it.each([
    ["is empty", ""],
    ["is white space", "  \n "],
    ["is not JSON", "this is not JSON"],
    ["is JSON cut short", '{"contract": "1.1.0", '],
    ["has a trailing comma", "[1, 2,]"],
  ])("reports source-invalid-json when the script text %s", async (_label, text) => {
    const element = await mount({}, { text, fallback: true });

    expect(events.errors).toEqual([
      { mode: "source", reason: "source-invalid-json", status: null, code: null },
    ]);
    expect(element.querySelector("table")).toBeNull();
  });

  it.each([
    ["an object", "{}"],
    ["an array", "[]"],
    ["null", "null"],
    ["a string", '"text"'],
    ["a number", "7"],
    ["a feature response with no features", '{"contract":"1.1.0"}'],
  ])("reports invalid-payload when the JSON is %s", async (_label, text) => {
    const element = await mount({}, { text, fallback: true });

    expect(events.errors).toEqual([
      { mode: "source", reason: "invalid-payload", status: null, code: null },
    ]);
    expect(events.loads).toEqual([]);
    expect(element.querySelector("table")).toBeNull();
  });

  it("reports invalid-payload for a payload that repeats a feature key", async () => {
    const payload = copy(v1NormalizedFixture);
    const [first] = payload.features;
    if (first === undefined) throw new Error("The fixture has no features");
    payload.features.push(copy(first));
    await mount({}, { text: toScriptJson(payload) });

    expect(events.errors).toEqual([
      { mode: "source", reason: "invalid-payload", status: null, code: null },
    ]);
  });

  // The JSON is a valid payload in each case, so the only thing wrong is the element that holds
  // it. A reader that took `textContent` from any element would render the table.
  const PAYLOAD_TEXT = toScriptJson(v1NormalizedFixture);
  const NOT_A_JSON_SCRIPT: ReadonlyArray<readonly [string, () => Element]> = [
    [
      "a div with the right text",
      () => {
        const div = document.createElement("div");
        div.id = SOURCE_ID;
        div.setAttribute("type", "application/json");
        div.textContent = PAYLOAD_TEXT;
        return div;
      },
    ],
    [
      "a template with the right text",
      () => {
        const template = document.createElement("template");
        template.id = SOURCE_ID;
        template.innerHTML = PAYLOAD_TEXT;
        return template;
      },
    ],
    [
      "a textarea with the right text",
      () => {
        const textarea = document.createElement("textarea");
        textarea.id = SOURCE_ID;
        textarea.value = PAYLOAD_TEXT;
        textarea.textContent = PAYLOAD_TEXT;
        return textarea;
      },
    ],
    ["a script with no type", () => makeScript(SOURCE_ID, PAYLOAD_TEXT, null)],
    ["a script of type text/plain", () => makeScript(SOURCE_ID, PAYLOAD_TEXT, "text/plain")],
    ["a script of type module", () => makeScript(SOURCE_ID, PAYLOAD_TEXT, "module")],
    [
      "a script of type application/ld+json",
      () => makeScript(SOURCE_ID, PAYLOAD_TEXT, "application/ld+json"),
    ],
    [
      "a script of type application/json with a parameter",
      () => makeScript(SOURCE_ID, PAYLOAD_TEXT, "application/json; charset=utf-8"),
    ],
    [
      "a script in the SVG namespace",
      () => {
        const script = document.createElementNS("http://www.w3.org/2000/svg", "script");
        script.id = SOURCE_ID;
        script.setAttribute("type", "application/json");
        script.textContent = PAYLOAD_TEXT;
        return script;
      },
    ],
  ];
  it.each(NOT_A_JSON_SCRIPT)("reports source-missing for %s", async (_label, make) => {
    const holder = document.createElement("div");
    holder.append(make());
    document.body.append(holder);
    const element = makeElement({ source: SOURCE_ID }, true);
    document.body.append(element);
    await element.updateComplete;

    expect(events.errors).toEqual([
      { mode: "source", reason: "source-missing", status: null, code: null },
    ]);
    expect(element.querySelector("table")).toBeNull();
  });

  it("reads only the first element with the id, so a JSON script after a div is source-missing", async () => {
    const div = document.createElement("div");
    div.id = SOURCE_ID;
    document.body.append(div, makeScript(SOURCE_ID, PAYLOAD_TEXT));
    const element = makeElement({ source: SOURCE_ID });
    document.body.append(element);
    await element.updateComplete;

    expect(events.errors.map(({ reason }) => reason)).toEqual(["source-missing"]);
  });

  it("evaluates nothing: a script that holds code is data, and its text is never run", async () => {
    Object.assign(window, { bcdSourceRan: false });
    const element = await mount({}, { text: "window.bcdSourceRan = true" });

    expect(Reflect.get(window, "bcdSourceRan")).toBe(false);
    expect(events.errors.map(({ reason }) => reason)).toEqual(["source-invalid-json"]);
    expect(element.querySelector("table")).toBeNull();
    Reflect.deleteProperty(window, "bcdSourceRan");
  });
});

describe("the priority of data, source, and query", () => {
  const QUERY = "fixture.source-priority";

  it("renders data when data, source, and query are all set, and sends no request", async () => {
    const data = withNote("This note came from the data property.");
    const element = makeElement({ source: SOURCE_ID, query: QUERY });
    element.data = data;
    document.body.append(makeScript(SOURCE_ID, toScriptJson(v1NormalizedFixture)), element);
    await element.updateComplete;
    await settle();

    expect(element.textContent).toContain("This note came from the data property.");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(events.loads).toEqual([{ mode: "data", snapshot: null }]);
    expect(events.errors).toEqual([]);
  });

  it("does not read a source that data overrides, so a broken one reports nothing", async () => {
    const element = makeElement({ source: "missing" });
    element.data = v1NormalizedFixture;
    document.body.append(element);
    await element.updateComplete;

    expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(true);
    expect(events.errors).toEqual([]);
  });

  it("renders source when source and query are both set, and sends no request", async () => {
    const element = await mount({ query: QUERY });
    await settle();

    expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(events.loads).toEqual([{ mode: "source", snapshot: null }]);
  });

  it("reports the error, and sends no request, when source fails and query is set", async () => {
    const element = await mount(
      { source: "missing", query: QUERY, loading: "eager" },
      { fallback: true },
    );
    await settle();

    expect(events.errors).toEqual([
      { mode: "source", reason: "source-missing", status: null, code: null },
    ]);
    expect(events.loads).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(element.hasAttribute("aria-busy")).toBe(false);
  });

  it("shows source again when data is cleared, with one bcd-load for the change", async () => {
    const element = await mount({});
    element.data = withNote("A note from the data property.");
    await element.updateComplete;
    expect(element.textContent).toContain("A note from the data property.");

    element.data = null;
    await element.updateComplete;

    expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(true);
    expect(element.textContent).not.toContain("A note from the data property.");
    expect(events.loads.map(({ mode }) => mode)).toEqual(["source", "data", "source"]);
  });

  it("falls back to query once the source attribute is removed", async () => {
    fetchSpy.mockImplementation(() => new Promise<Response>(() => {}));
    const element = await mount({ query: QUERY, loading: "eager" });
    expect(fetchSpy).not.toHaveBeenCalled();

    element.removeAttribute("source");
    await element.updateComplete;

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(`/v1/current/features/${QUERY}.json`);
    expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(false);
  });
});

describe("reading once", () => {
  it("ignores a change to the script's text after the element rendered", async () => {
    const element = await mount({});
    const script = document.getElementById(SOURCE_ID);
    script?.replaceChildren(
      document.createTextNode(toScriptJson(withNote("A note added after the first read."))),
    );
    await element.updateComplete;
    await settle();

    expect(element.textContent).not.toContain("A note added after the first read.");
    expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(true);
    expect(events.loads).toHaveLength(1);
  });

  it("keeps the table when the script is removed afterwards", async () => {
    const element = await mount({});
    document.getElementById(SOURCE_ID)?.remove();
    element.setAttribute("browsers", "chrome");
    await element.updateComplete;

    expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(true);
    expect(events.errors).toEqual([]);
    expect(events.loads).toHaveLength(1);
  });

  it("does not read again when the element moves, and fires nothing for the move", async () => {
    const element = await mount({});
    document.getElementById(SOURCE_ID)?.remove();
    const other = document.createElement("section");
    document.body.append(other);

    other.append(element);
    await element.updateComplete;
    await settle();

    expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(true);
    expect(events.loads).toHaveLength(1);
    expect(events.errors).toEqual([]);
  });

  it("reads the new script when the source attribute names another one, and fires one event", async () => {
    const element = await mount({});
    document.body.append(makeScript("second", toScriptJson(withNote("The second script's note."))));

    element.setAttribute("source", "second");
    await element.updateComplete;

    expect(element.textContent).toContain("The second script's note.");
    expect(events.loads).toEqual([
      { mode: "source", snapshot: null },
      { mode: "source", snapshot: null },
    ]);
  });

  it("fires one bcd-error when source changes from one failure to another", async () => {
    const element = await mount({ source: "missing" });
    document.body.append(makeScript("broken", "not JSON"));

    element.setAttribute("source", "broken");
    await element.updateComplete;

    expect(events.errors.map(({ reason }) => reason)).toEqual([
      "source-missing",
      "source-invalid-json",
    ]);
    expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(false);
  });

  it("fires one event for two changes in the same task", async () => {
    const element = await mount({});
    document.body.append(makeScript("a", toScriptJson(withNote("Note A."))));
    document.body.append(makeScript("b", toScriptJson(withNote("Note B."))));

    element.setAttribute("source", "a");
    element.setAttribute("source", "b");
    await element.updateComplete;

    expect(element.textContent).toContain("Note B.");
    expect(events.loads).toHaveLength(2);
  });
});

describe("events and attributes while the element is detached", () => {
  it("holds the event for a source that changed while the element was out of the document", async () => {
    const element = await mount({});
    document.body.append(
      makeScript("later", toScriptJson(withNote("A note read after reconnecting."))),
    );
    element.remove();

    element.setAttribute("source", "later");
    await element.updateComplete;
    await settle();
    expect(events.loads).toHaveLength(1);

    document.body.append(element);
    await element.updateComplete;
    await settle();

    expect(element.textContent).toContain("A note read after reconnecting.");
    expect(events.loads).toHaveLength(2);
    expect(events.errors).toEqual([]);
  });

  it("sends no event for an element that was never connected", async () => {
    document.body.append(makeScript(SOURCE_ID, toScriptJson(v1NormalizedFixture)));
    const element = makeElement({ source: SOURCE_ID });
    await settle();

    expect(events.loads).toEqual([]);
    expect(element.querySelector("table")).toBeNull();

    document.body.append(element);
    await element.updateComplete;
    expect(events.loads).toHaveLength(1);
  });
});

describe("the loaded attribute, aria-busy, and the container guard", () => {
  it("sets loaded on success and removes it when source points at a missing script", async () => {
    const element = await mount({});
    expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(true);

    document.body.append(makeScript("broken", "{"));
    element.setAttribute("source", "broken");
    await element.updateComplete;

    expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(false);
  });

  it("never sets aria-busy, and leaves an author's own value alone", async () => {
    const element = makeElement({ source: SOURCE_ID, "aria-busy": "true" });
    document.body.append(makeScript(SOURCE_ID, toScriptJson(v1NormalizedFixture)), element);
    await element.updateComplete;
    await settle();

    expect(element.getAttribute("aria-busy")).toBe("true");

    const plain = await mount({});
    expect(plain.hasAttribute("aria-busy")).toBe(false);
  });

  it("puts the render container back when a script removes it", async () => {
    const element = await mount({});
    element.replaceChildren();
    await settle();

    expect(element.querySelector(".bcd-render-container table")).not.toBeNull();
  });

  it("shows or hides the error sentence as fallback content arrives and leaves", async () => {
    const element = await mount({ source: "missing" });
    expect(element.querySelector(".bcd-error")).not.toBeNull();

    const paragraph = document.createElement("p");
    paragraph.textContent = "Late fallback.";
    element.prepend(paragraph);
    await settle();
    await element.updateComplete;
    expect(element.querySelector(".bcd-error")).toBeNull();

    paragraph.remove();
    await settle();
    await element.updateComplete;
    expect(element.querySelector(".bcd-error")?.textContent).toBe(ERROR_SENTENCE);
  });
});

describe("a page that is still being parsed", () => {
  // While the parser runs, `document.readyState` is "loading". The spy makes it so for these
  // tests, and `finishParsing` ends it the way the browser does: the state changes, then the
  // browser fires `readystatechange`.
  let readyState: DocumentReadyState;
  const finishParsing = (): void => {
    readyState = "interactive";
    document.dispatchEvent(new Event("readystatechange"));
  };

  beforeEach(() => {
    readyState = "loading";
    vi.spyOn(Document.prototype, "readyState", "get").mockImplementation(() => readyState);
  });

  it("waits for a script after the element, and renders once parsing ends", async () => {
    const element = makeElement({ source: SOURCE_ID }, true);
    document.body.append(element);
    await element.updateComplete;
    expect(events.errors).toEqual([]);
    expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(false);

    document.body.append(makeScript(SOURCE_ID, toScriptJson(v1NormalizedFixture)));
    await settle();
    expect(events.loads).toEqual([]);

    finishParsing();
    await element.updateComplete;

    expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(true);
    expect(events.loads).toEqual([{ mode: "source", snapshot: null }]);
    expect(events.errors).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reads a script that is already there at once, without waiting for the parser", async () => {
    const element = await mount({});

    expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(true);
    expect(events.loads).toHaveLength(1);
  });

  it("reports source-missing when parsing ends and no script has the id", async () => {
    const element = makeElement({ source: "never-arrives" });
    document.body.append(element);
    await element.updateComplete;
    expect(events.errors).toEqual([]);
    expect(element.querySelector(".bcd-error")).toBeNull();

    finishParsing();
    await element.updateComplete;

    expect(events.errors).toEqual([
      { mode: "source", reason: "source-missing", status: null, code: null },
    ]);
    expect(element.querySelector(".bcd-error")?.textContent).toBe(ERROR_SENTENCE);
  });

  it("does not wait for a reference that names the wrong kind of element", async () => {
    const div = document.createElement("div");
    div.id = SOURCE_ID;
    document.body.append(div);
    const element = makeElement({ source: SOURCE_ID });
    document.body.append(element);
    await element.updateComplete;

    expect(events.errors.map(({ reason }) => reason)).toEqual(["source-missing"]);
  });

  it("reports source-invalid-json at once for a script that is there but holds no JSON", async () => {
    await mount({}, { text: "nope" });

    expect(events.errors.map(({ reason }) => reason)).toEqual(["source-invalid-json"]);
  });

  it("holds the wait while the element is out of the document, and reads on return", async () => {
    const element = makeElement({ source: SOURCE_ID });
    document.body.append(element);
    await element.updateComplete;
    element.remove();

    document.body.append(makeScript(SOURCE_ID, toScriptJson(v1NormalizedFixture)));
    finishParsing();
    await settle();
    expect(events.loads).toEqual([]);
    expect(events.errors).toEqual([]);

    document.body.append(element);
    await element.updateComplete;
    await settle();

    expect(events.loads).toEqual([{ mode: "source", snapshot: null }]);
  });

  // A listener that outlived its wait would call `getElementById` when parsing ends, to read the
  // script. These tests count those calls, because an event or an attribute might hide the leak:
  // a detached element holds its events back, and a null `source` hides the state.
  const lookupsAfterParsing = (): number => {
    const spy = vi.spyOn(Document.prototype, "getElementById");
    spy.mockClear();
    finishParsing();
    return spy.mock.calls.length;
  };

  it("stops waiting when the element is removed: parsing ending looks nothing up", async () => {
    const element = makeElement({ source: "never-arrives" });
    document.body.append(element);
    await element.updateComplete;
    element.remove();

    expect(lookupsAfterParsing()).toBe(0);
    await settle();
    expect(events.errors).toEqual([]);
  });

  it("stops waiting when the source attribute is removed: parsing ending looks nothing up", async () => {
    const element = makeElement({ source: "never-arrives" });
    document.body.append(element);
    await element.updateComplete;

    element.removeAttribute("source");
    await element.updateComplete;

    expect(lookupsAfterParsing()).toBe(0);
    await settle();
    expect(events.errors).toEqual([]);
  });

  it("stops waiting when the source attribute names another id, and waits only for the new one", async () => {
    const element = makeElement({ source: "first-id" });
    document.body.append(element);
    await element.updateComplete;
    element.setAttribute("source", "second-id");
    await element.updateComplete;
    document.body.append(makeScript("first-id", toScriptJson(v1NormalizedFixture)));

    finishParsing();
    await element.updateComplete;

    expect(events.errors.map(({ reason }) => reason)).toEqual(["source-missing"]);
    expect(events.loads).toEqual([]);
  });

  it("stops waiting when data is set, so the script is never parsed", async () => {
    const parseSpy = vi.spyOn(JSON, "parse");
    const element = makeElement({ source: "late-script" });
    document.body.append(element);
    await element.updateComplete;
    document.body.append(
      makeScript("late-script", toScriptJson(withNote("A note from the script."))),
    );

    element.data = withNote("A note from the data property.");
    await element.updateComplete;
    parseSpy.mockClear();
    expect(lookupsAfterParsing()).toBe(0);
    await settle();

    expect(parseSpy).not.toHaveBeenCalled();
    expect(element.textContent).toContain("A note from the data property.");
    expect(events.loads).toEqual([{ mode: "data", snapshot: null }]);
    expect(events.errors).toEqual([]);

    // Clearing data reads the script now, because parsing has ended, and shows its table.
    element.data = null;
    await element.updateComplete;

    expect(element.textContent).toContain("A note from the script.");
    expect(events.loads.map(({ mode }) => mode)).toEqual(["data", "source"]);
  });

  it("reports source-missing at once for an earlier element with the id, even while parsing", async () => {
    // `getElementById` returns the first match in tree order, so the later script can never be
    // the target. The element does not wait for it.
    const div = document.createElement("div");
    div.id = SOURCE_ID;
    document.body.append(div);
    const element = makeElement({ source: SOURCE_ID });
    document.body.append(element);
    document.body.append(makeScript(SOURCE_ID, toScriptJson(v1NormalizedFixture)));
    await element.updateComplete;

    expect(events.errors.map(({ reason }) => reason)).toEqual(["source-missing"]);

    finishParsing();
    await settle();
    expect(events.errors).toHaveLength(1);
    expect(events.loads).toEqual([]);
  });
});

describe("refreshing a source that was read once", () => {
  const NEW_NOTE = "A note in the refreshed payload.";

  it("reads again when the source attribute is removed, the element updates, and it is set again", async () => {
    const element = await mount({});
    document
      .getElementById(SOURCE_ID)
      ?.replaceChildren(document.createTextNode(toScriptJson(withNote(NEW_NOTE))));
    await element.updateComplete;
    expect(element.textContent).not.toContain(NEW_NOTE);

    element.removeAttribute("source");
    await element.updateComplete;
    element.setAttribute("source", SOURCE_ID);
    await element.updateComplete;

    expect(element.textContent).toContain(NEW_NOTE);
    expect(events.loads.map(({ mode }) => mode)).toEqual(["source", "source"]);
  });

  it("does not read again when the attribute is removed and set again in the same task", async () => {
    // Lit batches both changes into one update that sees the same id, so nothing changed.
    const element = await mount({});
    document
      .getElementById(SOURCE_ID)
      ?.replaceChildren(document.createTextNode(toScriptJson(withNote(NEW_NOTE))));

    element.removeAttribute("source");
    element.setAttribute("source", SOURCE_ID);
    await element.updateComplete;

    expect(element.textContent).not.toContain(NEW_NOTE);
  });

  it("reads the new payload when a new script with a new id is named", async () => {
    const element = await mount({});
    document.body.append(makeScript("bcd-data-second-version", toScriptJson(withNote(NEW_NOTE))));

    element.setAttribute("source", "bcd-data-second-version");
    await element.updateComplete;

    expect(element.textContent).toContain(NEW_NOTE);
    expect(events.loads).toHaveLength(2);
  });
});

describe("failures that are not a SyntaxError", () => {
  it("reports source-invalid-json when JSON.parse throws a RangeError, as deep nesting can", async () => {
    const text = '{"deeply":"nested"}';
    const realParse = JSON.parse.bind(JSON);
    vi.spyOn(JSON, "parse").mockImplementation((input, reviver) => {
      if (input === text) throw new RangeError("Maximum call stack size exceeded");
      return realParse(input, reviver);
    });

    const element = await mount({}, { text, fallback: true });

    expect(events.errors).toEqual([
      { mode: "source", reason: "source-invalid-json", status: null, code: null },
    ]);
    expect(element.querySelector("table")).toBeNull();
  });

  it("reports source-invalid-json for any other thrown value", async () => {
    const text = '{"odd":"failure"}';
    const realParse = JSON.parse.bind(JSON);
    vi.spyOn(JSON, "parse").mockImplementation((input, reviver) => {
      if (input === text) throw "not even an Error";
      return realParse(input, reviver);
    });

    await mount({}, { text });

    expect(events.errors.map(({ reason }) => reason)).toEqual(["source-invalid-json"]);
  });
});

describe("an element that lives in another window's tree", () => {
  it("finds a script in a shadow root that belongs to an iframe's window", async () => {
    // `instanceof ShadowRoot` is false for a shadow root made by another window, because each
    // window has its own `ShadowRoot`. The element, made here, is moved into the iframe's tree.
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const frameDocument = frame.contentDocument;
    if (frameDocument === null) throw new Error("The iframe has no document");
    const host = frameDocument.createElement("div");
    frameDocument.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    expect(shadow instanceof ShadowRoot).toBe(false);

    const loads: BcdLoadDetail[] = [];
    shadow.addEventListener("bcd-load", (event) => {
      loads.push((event as CustomEvent<BcdLoadDetail>).detail);
    });
    shadow.append(
      frameDocument.importNode(makeScript(SOURCE_ID, toScriptJson(v1NormalizedFixture)), true),
    );
    const element = makeElement({ source: SOURCE_ID });
    shadow.append(element);
    await element.updateComplete;

    expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(true);
    expect(loads).toEqual([{ mode: "source", snapshot: null }]);
  });
});

describe("the escape rule", () => {
  const HOSTILE_NOTE = '</script><script id="injected">window.bcdInjected = true</script><!-- <b>';

  /** Parses markup the way a page's HTML does, so the tokenizer decides where the script ends. */
  const parse = (markup: string): HTMLElement => {
    const container = document.createElement("div");
    container.innerHTML = markup;
    document.body.append(container);
    return container;
  };

  it("returns the identical note when every < is written as \\u003c, with no extra script", async () => {
    const json = toScriptJson(withNote(HOSTILE_NOTE));
    expect(json).not.toContain("<");
    expect(JSON.parse(json).features.length).toBeGreaterThan(0);

    const container = parse(
      `<script type="application/json" id="escaped">${json}</script>` +
        `<bcd-compat-table source="escaped" browsers="chrome opera nodejs"></bcd-compat-table>`,
    );
    const element = container.querySelector<BcdCompatTable>("bcd-compat-table");
    await element?.updateComplete;

    expect(container.querySelectorAll("script")).toHaveLength(1);
    expect(container.querySelector("#injected")).toBeNull();
    expect(element?.hasAttribute(LOADED_ATTRIBUTE)).toBe(true);
    expect(element?.textContent).toContain(HOSTILE_NOTE);
    expect(element?.querySelector("#injected")).toBeNull();
    expect(events.loads).toEqual([{ mode: "source", snapshot: null }]);
  });

  it("round-trips the note through JSON.parse unchanged", () => {
    const script = makeScript("round-trip", toScriptJson(withNote(HOSTILE_NOTE)));
    const parsed = JSON.parse(script.textContent ?? "") as FeatureResponse;
    const note = parsed.features.find((feature) => feature.name === "notes_only")?.support.chrome
      ?.branches[0]?.statements[0]?.notes[0];

    expect(note).toBe(HOSTILE_NOTE);
  });

  it("shows why the rule exists: without it the script ends at the note and the JSON breaks", async () => {
    // This note ends the script and holds nothing else that would swallow the element after it.
    const container = parse(
      `<script type="application/json" id="raw">${JSON.stringify(withNote("A note with </script> in it."))}</script>` +
        `<bcd-compat-table source="raw" browsers="chrome opera nodejs"></bcd-compat-table>`,
    );
    const element = container.querySelector<BcdCompatTable>("bcd-compat-table");
    await element?.updateComplete;

    // The tokenizer ended the script at the note's closing tag, so the script's text is cut short
    // and the rest of the JSON became text of the page.
    expect(element?.hasAttribute(LOADED_ATTRIBUTE)).toBe(false);
    expect(events.errors.map(({ reason }) => reason)).toEqual(["source-invalid-json"]);
  });

  // Escaping only the closing tag is not enough. In the HTML Standard's tokenizer (13.2.5, "Script
  // data double escaped state"), the text `<!--` followed by `<script` moves the tokenizer into a
  // state where the next `</script` no longer ends the script, so the real end tag is read as
  // script text and the rest of the page, the element included, goes with it.
  const OPENER_NOTE = "<!--<script>";

  it("swallows the rest of the page when a note holds an unescaped <!--<script>", () => {
    const container = parse(
      `<script type="application/json" id="open">${JSON.stringify(withNote(OPENER_NOTE))}</script>` +
        `<bcd-compat-table source="open" browsers="chrome opera nodejs"></bcd-compat-table>`,
    );

    // The tokenizer never saw the real end tag, so there is no element after the script.
    expect(container.querySelector("bcd-compat-table")).toBeNull();
    expect(container.querySelectorAll("script")).toHaveLength(1);
  });

  it("renders the same note when every < is escaped", async () => {
    const container = parse(
      `<script type="application/json" id="closed">${toScriptJson(withNote(OPENER_NOTE))}</script>` +
        `<bcd-compat-table source="closed" browsers="chrome opera nodejs"></bcd-compat-table>`,
    );
    const element = container.querySelector<BcdCompatTable>("bcd-compat-table");
    await element?.updateComplete;

    expect(element?.hasAttribute(LOADED_ATTRIBUTE)).toBe(true);
    expect(element?.textContent).toContain(OPENER_NOTE);
    expect(events.loads).toEqual([{ mode: "source", snapshot: null }]);
  });
});
