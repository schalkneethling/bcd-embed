// The element in source mode, in Chromium, Firefox, and WebKit (issue #205). The two load orders
// are the point of this file. When a module script defines the element, the definition waits for
// the end of parsing, so a JSON script after the element is already in the document. When the
// element is defined first, the parser creates it as an upgraded element and calls its
// `connectedCallback` before it has read anything after the element's start tag
// (docs/planning/10-component-spikes.md, #187 section 1). Pages write the second case with a
// stream: one `document.write` call per chunk, into an iframe whose window already holds the
// definition. No test reaches a real server: any request to the API fails the test.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { v1NormalizedFixture } from "../../schema/src/fixtures/v1.js";

const API_ORIGIN = "https://api.browser-compat.dev";
const DEFINE_MODULE = "/e2e/fixtures/source-define.ts";
const GENERATED_PAGE = "/e2e/fixtures/generated-source-page.html";
const SOURCE_ID = "bcd-data-fixture-adversarial-v1";
const BROWSERS = "chrome opera nodejs";
const FALLBACK = "<p>Fallback: the browser compatibility table has not loaded.</p>";

type EventRecord = { readonly type: string; readonly detail: unknown };

/** The escape rule from the README: every `<` becomes the six characters `<`. */
const toScriptJson = (value: unknown): string => JSON.stringify(value).replaceAll("<", "\\u003c");

const jsonScript = (id: string, json: string): string =>
  `<script type="application/json" id="${id}">${json}</script>`;

const elementTag = (attributes = `source="${SOURCE_ID}"`): string =>
  `<bcd-compat-table id="table" ${attributes} browsers="${BROWSERS}">${FALLBACK}</bcd-compat-table>`;

/** Fails the test when the page sends a request to the API, and returns what it saw. */
const forbidApiRequests = async (page: Page): Promise<string[]> => {
  const seen: string[] = [];
  await page.route(`${API_ORIGIN}/**`, (route) => {
    seen.push(route.request().url());
    return route.abort();
  });
  return seen;
};

const RECORD_EVENTS = `
  window.bcdEvents = [];
  for (const type of ["bcd-load", "bcd-error"]) {
    document.addEventListener(type, (event) => window.bcdEvents.push({ type, detail: event.detail }));
  }
`;

/** Serves a generated document at a fixed address, then opens it. */
const openDocument = async (page: Page, html: string): Promise<void> => {
  await page.route(`**${GENERATED_PAGE}`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: html }),
  );
  await page.goto(GENERATED_PAGE);
};

/** A page that a module script defines the element on, after parsing, with `body` in its body. */
const modulePage = (body: string): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Source mode, defined after parsing</title>
    <link rel="stylesheet" href="/e2e/fixtures/fallback.css" />
    <script>${RECORD_EVENTS}</script>
    <script type="module" src="${DEFINE_MODULE}"></script>
  </head>
  <body><main><h1>Source mode</h1>${body}</main></body>
</html>`;

const eventsOf = (page: Page): Promise<EventRecord[]> =>
  page.evaluate(() => Reflect.get(window, "bcdEvents") as EventRecord[]);

/**
 * Opens an iframe, defines the element in its window, and only then streams `chunks` into it, one
 * `document.write` call each, so the parser meets the element when the definition already exists.
 * It returns the iframe document's `readyState` after each chunk, which must be "loading" for the
 * test to mean anything. The iframe keeps its events in `bcdEvents`, like the pages above.
 */
const streamPage = async (
  page: Page,
  chunks: readonly string[],
): Promise<{ readonly openedStates: string[] }> => {
  await page.goto("/e2e/fixtures/fallback.css");
  return page.evaluate(
    async ({ chunks: toWrite, defineUrl, recordEvents }) => {
      const frame = document.createElement("iframe");
      frame.id = "stream";
      document.body.append(frame);
      const frameWindow = frame.contentWindow;
      const frameDocument = frame.contentDocument;
      if (frameWindow === null || frameDocument === null)
        throw new Error("The iframe has no window");
      frameDocument.open();
      // A classic script runs while the parser waits for more input. It starts the import, and
      // the test waits on the promise, so the element is defined before the next chunk is parsed.
      // The chunk links no stylesheet, because the parser holds back a script that follows a
      // stylesheet that has not loaded.
      frameDocument.write(
        `<!doctype html><meta charset="utf-8">` +
          `<script>${recordEvents}; window.defined = import(${JSON.stringify(defineUrl)});</script>`,
      );
      await Reflect.get(frameWindow, "defined");
      if (frameWindow.customElements.get("bcd-compat-table") === undefined) {
        throw new Error("The element is not defined before the first chunk");
      }
      const openedStates: string[] = [];
      for (const chunk of toWrite) {
        frameDocument.write(chunk);
        openedStates.push(frameDocument.readyState);
        // Let every task that the chunk queued run, such as an update the element requested.
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      frameDocument.close();
      return { openedStates };
    },
    { chunks, defineUrl: new URL(DEFINE_MODULE, page.url()).href, recordEvents: RECORD_EVENTS },
  );
};

const frameEvents = (page: Page): Promise<EventRecord[]> =>
  page.evaluate(() => {
    const frame = document.querySelector("iframe");
    return Reflect.get(frame?.contentWindow ?? window, "bcdEvents") as EventRecord[];
  });

const LOAD: EventRecord = { type: "bcd-load", detail: { mode: "source", snapshot: null } };
const MISSING: EventRecord = {
  type: "bcd-error",
  detail: { mode: "source", reason: "source-missing", status: null, code: null },
};

test.describe("an element defined after the parser finished", () => {
  test("renders a script that comes before the element, with no request", async ({ page }) => {
    const requests = await forbidApiRequests(page);
    await openDocument(
      page,
      modulePage(jsonScript(SOURCE_ID, toScriptJson(v1NormalizedFixture)) + elementTag()),
    );
    await page.locator("#table[loaded] table").waitFor();

    await expect(page.locator("#table tbody tr")).toHaveCount(14);
    expect(await eventsOf(page)).toEqual([LOAD]);
    expect(requests).toEqual([]);
  });

  test("renders a script that comes after the element, because parsing ends first", async ({
    page,
  }) => {
    const requests = await forbidApiRequests(page);
    await openDocument(
      page,
      modulePage(elementTag() + jsonScript(SOURCE_ID, toScriptJson(v1NormalizedFixture))),
    );
    await page.locator("#table[loaded] table").waitFor();

    await expect(page.locator("#table tbody tr")).toHaveCount(14);
    expect(await eventsOf(page)).toEqual([LOAD]);
    expect(requests).toEqual([]);
  });

  test("reports source-missing for a wrong id and keeps the fallback visible", async ({ page }) => {
    await openDocument(
      page,
      modulePage(
        jsonScript(SOURCE_ID, toScriptJson(v1NormalizedFixture)) + elementTag('source="wrong-id"'),
      ),
    );
    await expect.poll(() => eventsOf(page)).toEqual([MISSING]);

    await expect(page.locator("#table table")).toHaveCount(0);
    await expect(page.getByText("Fallback: the browser compatibility table")).toBeVisible();
  });

  test("shows the error sentence when the page gave no fallback content", async ({ page }) => {
    await openDocument(
      page,
      modulePage(`<bcd-compat-table id="table" source="wrong-id"></bcd-compat-table>`),
    );

    await expect(page.locator("#table .bcd-error")).toHaveText(
      "Browser compatibility data could not be shown.",
    );
  });

  test("renders a note that holds a closing script tag, with no extra script in the page", async ({
    page,
  }) => {
    const note = '</script><script id="injected">window.bcdInjected = true</script><!-- <b>';
    const payload = structuredClone(v1NormalizedFixture);
    const statement = payload.features.find((feature) => feature.name === "notes_only")?.support
      .chrome?.branches[0]?.statements[0];
    if (statement === undefined) throw new Error("The fixture has no notes_only statement");
    statement.notes = [note];
    await openDocument(
      page,
      modulePage(jsonScript(SOURCE_ID, toScriptJson(payload)) + elementTag()),
    );
    await page.locator("#table[loaded] table").waitFor();

    await expect(page.locator("#table")).toContainText(note);
    await expect(page.locator("main script")).toHaveCount(1);
    await expect(page.locator("#injected")).toHaveCount(0);
    expect(await page.evaluate(() => Reflect.get(window, "bcdInjected"))).toBeUndefined();
  });

  test("has no axe violations in the loaded table and in the error state", async ({ page }) => {
    await openDocument(
      page,
      modulePage(
        jsonScript(SOURCE_ID, toScriptJson(v1NormalizedFixture)) +
          elementTag() +
          `<bcd-compat-table id="broken" source="wrong-id"></bcd-compat-table>`,
      ),
    );
    await page.locator("#table[loaded] table").waitFor();
    await expect(page.locator("#broken .bcd-error")).toBeVisible();

    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(
      violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) })),
    ).toEqual([]);
  });
});

test.describe("an element defined before the parser reaches it", () => {
  const scriptAfter = jsonScript(SOURCE_ID, toScriptJson(v1NormalizedFixture));

  test("renders a script that comes before the element", async ({ page }) => {
    const requests = await forbidApiRequests(page);
    const { openedStates } = await streamPage(page, [scriptAfter, elementTag()]);

    expect(openedStates).toEqual(["loading", "loading"]);
    const frame = page.frameLocator("#stream");
    await frame.locator("#table[loaded] table").waitFor();
    await expect(frame.locator("#table tbody tr")).toHaveCount(14);
    expect(await frameEvents(page)).toEqual([LOAD]);
    expect(requests).toEqual([]);
  });

  test("renders a script that comes after the element, once the parser has read it", async ({
    page,
  }) => {
    const requests = await forbidApiRequests(page);
    // The element is created and connected when the second chunk is parsed, and the script does
    // not exist until the third. A page that read the script in `connectedCallback` and nothing
    // else would report `source-missing` here.
    const { openedStates } = await streamPage(page, [
      elementTag(),
      "<p>Some content between the element and the script.</p>",
      scriptAfter,
    ]);

    expect(openedStates).toEqual(["loading", "loading", "loading"]);
    const frame = page.frameLocator("#stream");
    await frame.locator("#table[loaded] table").waitFor();
    await expect(frame.locator("#table tbody tr")).toHaveCount(14);
    expect(await frameEvents(page)).toEqual([LOAD]);
    expect(requests).toEqual([]);
  });

  test("fires nothing, and shows no error, while the parser has not reached the script", async ({
    page,
  }) => {
    await page.goto("/e2e/fixtures/fallback.css");
    // Stream the element only, then look before closing the document.
    await page.evaluate(
      async ({ defineUrl, recordEvents, tag }) => {
        const frame = document.createElement("iframe");
        frame.id = "stream";
        document.body.append(frame);
        const frameWindow = frame.contentWindow;
        const frameDocument = frame.contentDocument;
        if (frameWindow === null || frameDocument === null) throw new Error("No iframe window");
        frameDocument.open();
        frameDocument.write(
          `<!doctype html><script>${recordEvents}; window.defined = import(${JSON.stringify(defineUrl)});</script>`,
        );
        await Reflect.get(frameWindow, "defined");
        frameDocument.write(tag);
        await new Promise((resolve) => setTimeout(resolve, 100));
      },
      {
        defineUrl: new URL(DEFINE_MODULE, page.url()).href,
        recordEvents: RECORD_EVENTS,
        tag: elementTag(),
      },
    );

    expect(await frameEvents(page)).toEqual([]);
    await expect(page.frameLocator("#stream").locator("#table .bcd-error")).toHaveCount(0);
    await expect(page.frameLocator("#stream").locator("#table[loaded]")).toHaveCount(0);

    await page.evaluate(() => {
      const frame = document.querySelector("iframe");
      frame?.contentDocument?.write(`<script type="application/json" id="late">{}</script>`);
      frame?.contentDocument?.close();
    });
    await expect.poll(() => frameEvents(page)).toEqual([MISSING]);
  });

  test("reports source-missing once parsing ends when no script has the id", async ({ page }) => {
    await streamPage(page, [elementTag(), "<p>No script follows.</p>"]);

    await expect.poll(() => frameEvents(page)).toEqual([MISSING]);
    await expect(page.frameLocator("#stream").locator("#table")).toContainText("Fallback:");
  });
});
