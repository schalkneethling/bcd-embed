/// <reference types="vite/client" />
// The documentation site's samples (apps/website, issue #208), run in Chromium. The site shows
// excerpts of the files in `examples/`, and `tests/website-component-docs.test.ts` at the
// repository root fails when a page's sample is not in its file. This file runs the HTML,
// JavaScript, and CSS examples, so a sample that stops working fails here. The React, Vue, and
// Svelte examples run in `e2e/frameworks.e2e.ts`, which has the frameworks' compilers.
//
// The page's `fetch` is replaced in every test, so no test touches the network. The page's
// feature client lives for the whole file, so each test that sends a request uses its own query
// or endpoint.
import type { FeatureResponse } from "@bcd-embed/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import { v1NormalizedFixture } from "../../schema/src/fixtures/v1.js";
import { showTable } from "../examples/data-mode.js";
import dataModeHtml from "../examples/data-mode.html?raw";
import fetchModeHtml from "../examples/fetch-mode.html?raw";
import "../examples/handle-errors.js";
import selfHostedHtml from "../examples/self-hosted.html?raw";
import { scriptIdFor, sourceModeHtml, toScriptJson } from "../examples/source-mode.js";
import authorLayersCss from "../examples/styles/author-layers.css?raw";
import darkSchemeCss from "../examples/styles/dark-scheme.css?raw";
import staticColumnCss from "../examples/styles/static-column.css?raw";
import stickyBackgroundCss from "../examples/styles/sticky-background.css?raw";
import svgResetCss from "../examples/styles/svg-reset.css?raw";
import tokensCss from "../examples/styles/tokens.css?raw";
import typographyCss from "../examples/styles/typography.css?raw";
import { LOADED_ATTRIBUTE } from "../src/bcd-compat-table.js";
import type { BcdCompatTableElement, BcdErrorDetail, BcdLoadDetail } from "../src/index.js";
import baseCss from "../src/styles/base.css?inline";

const MDN_DISPLAY =
  "https://developer.mozilla.org/en-US/docs/Web/CSS/display#browser_compatibility";

const payloadFor = (query: string): FeatureResponse => ({
  ...structuredClone(v1NormalizedFixture),
  query,
});

const okResponse = (query: string): Response =>
  new Response(JSON.stringify(payloadFor(query)), {
    status: 200,
    headers: { "content-type": "application/json", "bcd-embed-snapshot": "bcd-8.1.9-gen-0.0.0" },
  });

const stubFetch = (respond: (url: string) => Promise<Response>): MockInstance =>
  vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((input) => respond(input instanceof Request ? input.url : String(input)));

const recordEvents = () => {
  const loads: BcdLoadDetail[] = [];
  const errors: BcdErrorDetail[] = [];
  const controller = new AbortController();
  const { signal } = controller;
  document.addEventListener("bcd-load", (event) => loads.push(event.detail), { signal });
  document.addEventListener("bcd-error", (event) => errors.push(event.detail), { signal });
  return { loads, errors, stop: () => controller.abort() };
};

/** Parses an example's markup into a container, changes it if a test asks, and adds it. */
const insert = (html: string, change?: (table: BcdCompatTableElement) => void) => {
  const container = document.createElement("div");
  container.innerHTML = html;
  const table = container.querySelector("bcd-compat-table");
  if (table === null) throw new Error("The example has no bcd-compat-table");
  change?.(table);
  document.body.append(container);
  return table;
};

const waitForTable = (table: Element) =>
  vi.waitFor(() => expect(table.hasAttribute(LOADED_ATTRIBUTE)).toBe(true));

afterEach(() => {
  document.body.replaceChildren();
  document.head.querySelectorAll("style[data-example]").forEach((style) => style.remove());
  vi.restoreAllMocks();
});

describe("fetch-mode.html", () => {
  it("requests its query from the hosted API and keeps the MDN link as its fallback", async () => {
    const fetchSpy = stubFetch(async () => okResponse("css.properties.display"));
    const table = insert(fetchModeHtml);

    // The fallback is what a reader without script sees.
    const link = table.querySelector("p > a");
    expect(link?.getAttribute("href")).toBe(MDN_DISPLAY);

    await waitForTable(table);
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      "https://api.browser-compat.dev/v1/current/features/css.properties.display.json",
    ]);
    expect(table.querySelector("caption")?.textContent?.trim()).toBe(
      "Browser compatibility: css.properties.display",
    );
  });
});

describe("self-hosted.html", () => {
  it("requests its query from the endpoint it names", async () => {
    const fetchSpy = stubFetch(async () => okResponse("css.properties.display"));
    const table = insert(selfHostedHtml);
    await waitForTable(table);
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      "https://compat.example.com/v1/current/features/css.properties.display.json",
    ]);
  });
});

describe("handle-errors.js", () => {
  let warn: MockInstance;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("logs a network failure and offers a retry that asks the feature client again", async () => {
    const fetchSpy = stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    const events = recordEvents();
    const table = insert(fetchModeHtml, (element) => {
      element.setAttribute("query", "fixture.docs-network");
    });

    await vi.waitFor(() => expect(events.errors).toHaveLength(1));
    expect(warn).toHaveBeenCalledWith("Compatibility table failed in fetch mode: network", {
      status: null,
      code: null,
    });
    const button = table.nextElementSibling;
    expect(button?.matches("button.retry-table")).toBe(true);
    expect(button?.textContent).toBe("Try loading the compatibility table again");

    (button as HTMLButtonElement).click();
    // Inside the feature client's 10-second window, the held failure answers with no request, so
    // the element reports the error again and the example offers the button again.
    await vi.waitFor(() => expect(events.errors).toHaveLength(2));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(table.getAttribute("query")).toBe("fixture.docs-network");
    expect(document.querySelectorAll("button.retry-table")).toHaveLength(1);
    events.stop();
  });

  it("logs a 404 and offers no retry, because asking again would fail the same way", async () => {
    stubFetch(
      async () =>
        new Response(JSON.stringify({ error: { code: "feature_not_found", message: "No." } }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
    );
    const events = recordEvents();
    const table = insert(fetchModeHtml, (element) => {
      element.setAttribute("query", "fixture.docs-missing");
    });

    await vi.waitFor(() => expect(events.errors).toHaveLength(1));
    expect(warn).toHaveBeenCalledWith("Compatibility table failed in fetch mode: http", {
      status: 404,
      code: "feature_not_found",
    });
    expect(table.nextElementSibling).toBeNull();
    events.stop();
  });
});

describe("data-mode.html and data-mode.js", () => {
  it("renders the assigned payload with no request", async () => {
    const fetchSpy = stubFetch(() => Promise.reject(new Error("No request expected")));
    const events = recordEvents();
    const table = insert(dataModeHtml);

    showTable(payloadFor("css.properties.display"));
    await waitForTable(table);

    expect(events.loads).toEqual([{ mode: "data", snapshot: null }]);
    expect(fetchSpy).not.toHaveBeenCalled();
    events.stop();
  });
});

describe("source-mode.js", () => {
  // The two sequences that end or swallow a script when `<` is not escaped (README, "Source mode").
  const hostileNote = "Ends here: </script> and here: <!--<script>, then goes on.";

  const withNote = (note: string): FeatureResponse => {
    const payload = structuredClone(v1NormalizedFixture);
    const statement = payload.features.find((feature) => feature.name === "notes_only")?.support
      .chrome?.branches[0]?.statements[0];
    if (statement === undefined) throw new Error("The fixture has no notes_only statement");
    statement.notes = [note];
    return payload;
  };

  it("names the script by the id convention", () => {
    expect(scriptIdFor("css.properties.display")).toBe("bcd-data-css-properties-display");
  });

  it("writes script text with no `<` that parses back to the payload", () => {
    const payload = withNote(hostileNote);
    const text = toScriptJson(payload);
    expect(text).not.toContain("<");
    expect(JSON.parse(text)).toEqual(payload);
  });

  it("writes fragments that render the table, with the hostile note intact", async () => {
    const fetchSpy = stubFetch(() => Promise.reject(new Error("No request expected")));
    const events = recordEvents();
    const container = document.createElement("div");
    document.body.append(container);
    container.insertAdjacentHTML(
      "beforeend",
      sourceModeHtml(withNote(hostileNote), `<p><a href="${MDN_DISPLAY}">MDN Web Docs</a></p>`),
    );

    const table = container.querySelector("bcd-compat-table");
    if (table === null) throw new Error("The fragments have no bcd-compat-table");
    await waitForTable(table);

    expect(events.loads).toEqual([{ mode: "source", snapshot: null }]);
    const notes = Array.from(table.querySelectorAll("bdi"), (note) => note.textContent);
    expect(notes).toContain(hostileNote);
    expect(fetchSpy).not.toHaveBeenCalled();
    events.stop();
  });
});

describe("the styling examples", () => {
  /** Adds a stylesheet to the document, in order after any added earlier. */
  const addStyle = (css: string): void => {
    const style = document.createElement("style");
    style.dataset.example = "";
    style.textContent = css;
    document.head.append(style);
  };

  /** Renders the fixture in data mode, optionally inside a wrapper with a class. */
  const renderStyledTable = async (wrapperClass?: string): Promise<BcdCompatTableElement> => {
    const table = document.createElement("bcd-compat-table");
    table.setAttribute("browsers", "chrome opera");
    table.data = payloadFor("fixture.docs-styles");
    const wrapper = document.createElement("div");
    if (wrapperClass !== undefined) wrapper.className = wrapperClass;
    wrapper.append(table);
    document.body.append(wrapper);
    await waitForTable(table);
    return table;
  };

  const styleOf = (table: Element, selector: string): CSSStyleDeclaration => {
    const element = table.querySelector(selector);
    if (element === null) throw new Error(`The table has no ${selector}`);
    return getComputedStyle(element);
  };

  it("tokens.css sets colours, padding, and the border width through custom properties", async () => {
    addStyle(baseCss);
    addStyle(tokensCss);
    const table = await renderStyledTable();
    expect(styleOf(table, ".bcd-icon-supported").color).toBe("rgb(17, 99, 41)");
    expect(styleOf(table, "tbody td").paddingInlineStart).toBe("4px");
    expect(styleOf(table, "tbody td").borderBlockEndWidth).toBe("2px");
  });

  it("typography.css reaches the table through the ordinary cascade", async () => {
    addStyle(baseCss);
    addStyle(typographyCss);
    const table = await renderStyledTable();
    expect(styleOf(table, ".bcd-table").fontSize).toBe("14px");
    expect(styleOf(table, "caption").fontSize).toBe("16px");
    expect(styleOf(table, "caption").textAlign).toBe("center");
  });

  it("dark-scheme.css gives a table inside the panel the dark colours", async () => {
    addStyle(baseCss);
    addStyle(darkSchemeCss);
    const table = await renderStyledTable("dark-panel");
    // `--bcd-color-supported-dark`'s default, #4ac26b.
    expect(styleOf(table, ".bcd-icon-supported").color).toBe("rgb(74, 194, 107)");
  });

  it("sticky-background.css paints the sticky feature column", async () => {
    addStyle(baseCss);
    addStyle(stickyBackgroundCss);
    const table = await renderStyledTable();
    expect(styleOf(table, ".bcd-feature").position).toBe("sticky");
    expect(styleOf(table, ".bcd-feature").backgroundColor).toBe("rgb(253, 246, 227)");
  });

  it("static-column.css keeps the feature column in the flow", async () => {
    addStyle(baseCss);
    addStyle(staticColumnCss);
    const table = await renderStyledTable();
    expect(styleOf(table, ".bcd-feature").position).toBe("static");
    expect(styleOf(table, "thead tr:first-child > :first-child").position).toBe("static");
    expect(styleOf(table, ".bcd-feature").backgroundColor).toBe("rgba(0, 0, 0, 0)");
  });

  it("svg-reset.css fills the page's icons and leaves the table's icons as strokes", async () => {
    addStyle(baseCss);
    addStyle(svgResetCss);
    const table = await renderStyledTable();
    const pageIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    document.body.append(pageIcon);
    expect(getComputedStyle(pageIcon).fill).not.toBe("none");
    expect(styleOf(table, ".bcd-icon").fill).toBe("none");
  });

  it("author-layers.css, loaded first, places bcd-embed.base between the page's layers", async () => {
    addStyle(authorLayersCss);
    addStyle(baseCss);
    const table = await renderStyledTable();
    // The `reset` layer comes before bcd-embed.base, so the base stylesheet's bold caption wins.
    expect(styleOf(table, "caption").fontWeight).toBe("700");
    // The `components` layer comes after it, so its centred caption wins.
    expect(styleOf(table, "caption").textAlign).toBe("center");
  });
});
