// The element in fetch mode, in Chromium (issue #203). The page's own `fetch` is replaced by a
// fake in each test, so no test touches the network. The feature client and its request cache
// live for the whole page, so every test asks for a query of its own: a query an earlier test
// asked for would be answered from the cache.
import type { FeatureResponse } from "@bcd-embed/schema";
import { afterEach, describe, expect, it, vi } from "vitest";

import { v1NormalizedFixture } from "../../schema/src/fixtures/v1.js";
import { BcdCompatTable, LOADED_ATTRIBUTE } from "../src/bcd-compat-table.js";
import type { BcdErrorDetail, BcdLoadDetail } from "../src/index.js";
import "../src/index.js";

const SNAPSHOT = "bcd-8.1.9-gen-0.0.0";
const FEATURE_PATH = "/v1/current/features/";

let queryCount = 0;
/** A query no earlier test asked for, so the page's request cache has no entry for it. */
const freshQuery = (): string => {
  queryCount += 1;
  return `fixture.fetch-${queryCount}`;
};

/** The Phase 1 fixture under another query, so the caption names the query that was asked for. */
const payloadFor = (query: string): FeatureResponse => ({
  ...structuredClone(v1NormalizedFixture),
  query,
});

const okResponse = (query: string): Response =>
  new Response(JSON.stringify(payloadFor(query)), {
    status: 200,
    headers: { "content-type": "application/json", "bcd-embed-snapshot": SNAPSHOT },
  });

const notFoundResponse = (query: string): Response =>
  new Response(
    JSON.stringify({ error: { code: "feature_not_found", message: "No data.", query } }),
    { status: 404, headers: { "content-type": "application/json" } },
  );

/** The query in a feature URL, such as `fixture.fetch-3` in `…/features/fixture.fetch-3.json`. */
const queryOf = (url: string): string =>
  url.slice(url.indexOf(FEATURE_PATH) + FEATURE_PATH.length, -".json".length);

/** Replaces the page's `fetch` for one test. `afterEach` restores it. */
const stubFetch = (respond: (url: string) => Promise<Response>) =>
  vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((input) => respond(input instanceof Request ? input.url : String(input)));

/** A promise and the functions that settle it, so a test decides when an answer arrives. */
const settleLater = <Value>() => {
  let resolve: (value: Value) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

/** Lets every queued microtask and one task run, which is enough for a cached answer to render. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

type MountOptions = {
  readonly query?: string;
  readonly loading?: string;
  readonly endpoint?: string;
  readonly data?: FeatureResponse;
  readonly fallback?: boolean;
  /** Puts a spacer this many pixels tall before the element. */
  readonly offset?: number;
};

/** Creates the element, sets it up, adds it to the page, and waits for its first update. */
const mount = async (options: MountOptions): Promise<BcdCompatTable> => {
  const element = document.createElement("bcd-compat-table") as BcdCompatTable;
  if (options.query !== undefined) element.setAttribute("query", options.query);
  if (options.loading !== undefined) element.setAttribute("loading", options.loading);
  if (options.endpoint !== undefined) element.setAttribute("endpoint", options.endpoint);
  if (options.data !== undefined) element.data = options.data;
  if (options.fallback === true) {
    const paragraph = document.createElement("p");
    paragraph.textContent = "Fallback: see MDN Web Docs.";
    element.append(paragraph);
  }
  if (options.offset !== undefined) {
    const spacer = document.createElement("div");
    spacer.style.blockSize = `${options.offset}px`;
    document.body.append(spacer);
  }
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

const captionOf = (element: Element): string | null =>
  element.querySelector("caption")?.textContent?.trim() ?? null;

const LIVE_REGIONS = '[aria-live], [role="status"], [role="alert"], [role="log"], output';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("a query with loading=eager", () => {
  it("renders the table and fires one bcd-load with mode fetch and the snapshot", async () => {
    const query = freshQuery();
    const fetchSpy = stubFetch(async (url) => okResponse(queryOf(url)));
    const events = recordEvents();

    const element = await mount({ query, loading: "eager" });
    await vi.waitFor(() => expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(true));

    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      `https://api.browser-compat.dev/v1/current/features/${query}.json`,
    ]);
    expect(element.querySelectorAll("tbody tr")).toHaveLength(14);
    expect(captionOf(element)).toBe(`Browser compatibility: ${query}`);
    expect(events.loads).toEqual([{ mode: "fetch", snapshot: SNAPSHOT }]);
    expect(events.errors).toEqual([]);
    events.stop();
  });

  it("sends the request on connect, even far below the viewport", async () => {
    const query = freshQuery();
    const fetchSpy = stubFetch(() => new Promise<Response>(() => {}));

    await mount({ query, loading: "eager", offset: 20_000 });
    // The client starts the shared request one microtask after the element asks for it.
    await Promise.resolve();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("reads loading as <img loading> does: eager in any case, and lazy otherwise", async () => {
    const eager = await mount({ query: freshQuery(), loading: "EAGER" });
    const unknown = await mount({ query: freshQuery(), loading: "soon" });
    const absent = await mount({ query: freshQuery() });

    expect([eager.loading, unknown.loading, absent.loading]).toEqual(["eager", "lazy", "lazy"]);
    absent.setAttribute("loading", "eager");
    absent.removeAttribute("loading");
    expect(absent.loading).toBe("lazy");
  });
});

describe("the input priority", () => {
  it("sends no request when data is set as well as query", async () => {
    const fetchSpy = stubFetch(async (url) => okResponse(queryOf(url)));
    const events = recordEvents();

    const element = await mount({
      query: freshQuery(),
      loading: "eager",
      data: v1NormalizedFixture,
    });
    await settle();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(events.loads).toEqual([{ mode: "data", snapshot: null }]);
    expect(element.getAttribute("aria-busy")).toBeNull();
    events.stop();
  });

  it("drops a pending request when data arrives, and shows the fetched table again, without a request, when data goes", async () => {
    const query = freshQuery();
    const answer = settleLater<Response>();
    const fetchSpy = stubFetch(() => answer.promise);
    const events = recordEvents();
    const element = await mount({ query, loading: "eager" });

    element.data = v1NormalizedFixture;
    await element.updateComplete;
    answer.resolve(okResponse(query));
    await settle();

    expect(captionOf(element)).toBe("Browser compatibility: fixture.adversarial-v1");
    expect(events.loads).toEqual([{ mode: "data", snapshot: null }]);

    element.data = null;
    await vi.waitFor(() => expect(captionOf(element)).toBe(`Browser compatibility: ${query}`));
    await settle();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(events.loads).toEqual([
      { mode: "data", snapshot: null },
      { mode: "fetch", snapshot: SNAPSHOT },
    ]);
    events.stop();
  });
});

describe("sharing", () => {
  it("sends one request for 50 elements with the same query", async () => {
    const query = freshQuery();
    const fetchSpy = stubFetch(async (url) => okResponse(queryOf(url)));
    const events = recordEvents();

    const elements = await Promise.all(
      Array.from({ length: 50 }, () => mount({ query, loading: "eager" })),
    );
    await vi.waitFor(() => expect(events.loads).toHaveLength(50));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(elements.every((element) => element.hasAttribute(LOADED_ATTRIBUTE))).toBe(true);
    events.stop();
  });
});

describe("the loading state", () => {
  it("sets aria-busy and keeps the fallback while the request is pending, and removes aria-busy after", async () => {
    const query = freshQuery();
    const answer = settleLater<Response>();
    stubFetch(() => answer.promise);

    const element = await mount({ query, loading: "eager", fallback: true });

    expect(element.getAttribute("aria-busy")).toBe("true");
    expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(false);
    expect(element.querySelector(":scope > p")?.isConnected).toBe(true);
    expect(element.querySelector(".bcd-loading")).toBeNull();

    answer.resolve(okResponse(query));
    await vi.waitFor(() => expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(true));

    expect(element.hasAttribute("aria-busy")).toBe(false);
    expect(element.querySelector(":scope > p")?.isConnected).toBe(true);
  });

  it("says that it is loading when the author gave no fallback, in a plain paragraph", async () => {
    const query = freshQuery();
    stubFetch(() => new Promise<Response>(() => {}));

    const element = await mount({ query, loading: "eager" });

    const sentence = element.querySelector("p.bcd-loading");
    expect(sentence?.textContent).toBe(`Loading browser compatibility data for ${query}.`);
    expect(element.querySelectorAll(LIVE_REGIONS)).toHaveLength(0);
    expect(document.activeElement).toBe(document.body);
  });

  it("drops the loading sentence when fallback content arrives", async () => {
    stubFetch(() => new Promise<Response>(() => {}));
    const element = await mount({ query: freshQuery(), loading: "eager" });

    element.append(document.createElement("p"));
    await vi.waitFor(() => expect(element.querySelector(".bcd-loading")).toBeNull());
  });

  it("produces no live region and moves no focus for ten tables on a page", async () => {
    const answers: Array<() => void> = [];
    stubFetch(
      (url) =>
        new Promise<Response>((resolve) => {
          answers.push(() => resolve(okResponse(queryOf(url))));
        }),
    );
    const events = recordEvents();

    await Promise.all(
      Array.from({ length: 10 }, () => mount({ query: freshQuery(), loading: "eager" })),
    );
    await vi.waitFor(() => expect(answers).toHaveLength(10));
    expect(document.querySelectorAll(LIVE_REGIONS)).toHaveLength(0);

    for (const answer of answers) answer();
    await vi.waitFor(() => expect(events.loads).toHaveLength(10));

    expect(document.querySelectorAll(LIVE_REGIONS)).toHaveLength(0);
    expect(document.activeElement).toBe(document.body);
    events.stop();
  });
});

describe("the error state", () => {
  it("shows the fallback and fires one bcd-error for a 404 with the code feature_not_found", async () => {
    const query = freshQuery();
    stubFetch(async (url) => notFoundResponse(queryOf(url)));
    const events = recordEvents();

    const element = await mount({ query, loading: "eager", fallback: true });
    await vi.waitFor(() => expect(events.errors).toHaveLength(1));
    await settle();

    expect(events.errors).toEqual([
      { mode: "fetch", reason: "http", status: 404, code: "feature_not_found" },
    ]);
    expect(events.loads).toEqual([]);
    expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(false);
    expect(element.hasAttribute("aria-busy")).toBe(false);
    expect(element.querySelector(":scope > p")?.isConnected).toBe(true);
    expect(element.querySelector(".bcd-error")).toBeNull();
    events.stop();
  });

  it("names the query in its own sentence when the author gave no fallback", async () => {
    const query = freshQuery();
    stubFetch(async (url) => notFoundResponse(queryOf(url)));

    const element = await mount({ query, loading: "eager" });

    await vi.waitFor(() =>
      expect(element.querySelector("p.bcd-error")?.textContent).toBe(
        `Browser compatibility data for ${query} could not be loaded.`,
      ),
    );
    expect(element.querySelectorAll(LIVE_REGIONS)).toHaveLength(0);
  });

  it("fires one bcd-error with the reason network for a failed request, and sends no further request", async () => {
    const query = freshQuery();
    const fetchSpy = stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    const events = recordEvents();

    const element = await mount({ query, loading: "eager" });
    await vi.waitFor(() => expect(events.errors).toHaveLength(1));
    // Updates that do not change the request, and a trip out of the document and back, send
    // nothing new.
    element.setAttribute("browsers", "chrome");
    await element.updateComplete;
    element.remove();
    document.body.append(element);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(events.errors).toEqual([{ mode: "fetch", reason: "network", status: null, code: null }]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    events.stop();
  });

  it("fires invalid-payload with mode fetch for a body the table model rejects", async () => {
    const query = freshQuery();
    const payload = payloadFor(query);
    const first = payload.features[0];
    if (first === undefined) throw new Error("The fixture has no features");
    // Two features with one key pass the client's envelope check but not the model.
    payload.features.push(first);
    stubFetch(async () => new Response(JSON.stringify(payload), { status: 200 }));
    const events = recordEvents();

    await mount({ query, loading: "eager" });
    await vi.waitFor(() => expect(events.errors).toHaveLength(1));

    expect(events.errors).toEqual([
      { mode: "fetch", reason: "invalid-payload", status: null, code: null },
    ]);
    events.stop();
  });

  it("reports an invalid query at once, with no request, even when lazy and far below the viewport", async () => {
    const fetchSpy = stubFetch(async (url) => okResponse(queryOf(url)));
    const events = recordEvents();

    const element = await mount({ query: "a b", offset: 20_000 });
    await vi.waitFor(() => expect(events.errors).toHaveLength(1));

    expect(events.errors).toEqual([
      { mode: "fetch", reason: "invalid-query", status: null, code: null },
    ]);
    expect(element.querySelector("p.bcd-error")?.textContent).toBe(
      "Browser compatibility data for a b could not be loaded.",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    events.stop();
  });
});

describe("a change while a request is pending", () => {
  for (const order of ["old answer first", "new answer first"] as const) {
    it(`renders only the new query's table, and fires nothing for the old one: ${order}`, async () => {
      const oldQuery = freshQuery();
      const newQuery = freshQuery();
      const answers = new Map([
        [oldQuery, settleLater<Response>()],
        [newQuery, settleLater<Response>()],
      ]);
      stubFetch((url) => answers.get(queryOf(url))?.promise ?? Promise.reject(new Error(url)));
      const events = recordEvents();
      const element = await mount({ query: oldQuery, loading: "eager" });

      element.setAttribute("query", newQuery);
      await element.updateComplete;
      if (order === "old answer first") {
        answers.get(oldQuery)?.resolve(okResponse(oldQuery));
        await settle();

        expect(element.querySelector("table")).toBeNull();
        expect(element.getAttribute("aria-busy")).toBe("true");
        expect(events.loads).toEqual([]);

        answers.get(newQuery)?.resolve(okResponse(newQuery));
        await vi.waitFor(() => expect(events.loads).toHaveLength(1));
      } else {
        answers.get(newQuery)?.resolve(okResponse(newQuery));
        await vi.waitFor(() => expect(events.loads).toHaveLength(1));
        answers.get(oldQuery)?.resolve(okResponse(oldQuery));
        await settle();
        await element.updateComplete;
      }

      expect(captionOf(element)).toBe(`Browser compatibility: ${newQuery}`);
      expect(events.loads).toEqual([{ mode: "fetch", snapshot: SNAPSHOT }]);
      expect(events.errors).toEqual([]);
      events.stop();
    });
  }

  it("fires no error for an old query that fails after the new one rendered", async () => {
    const oldQuery = freshQuery();
    const newQuery = freshQuery();
    const oldAnswer = settleLater<Response>();
    stubFetch((url) =>
      queryOf(url) === oldQuery ? oldAnswer.promise : Promise.resolve(okResponse(newQuery)),
    );
    const events = recordEvents();
    const element = await mount({ query: oldQuery, loading: "eager" });

    element.setAttribute("query", newQuery);
    await vi.waitFor(() => expect(events.loads).toHaveLength(1));
    oldAnswer.resolve(notFoundResponse(oldQuery));
    await settle();

    expect(captionOf(element)).toBe(`Browser compatibility: ${newQuery}`);
    expect(events.errors).toEqual([]);
    expect(events.loads).toEqual([{ mode: "fetch", snapshot: SNAPSHOT }]);
    events.stop();
  });
});

describe("removing the element while a request is pending", () => {
  it("fires nothing when the request settles, and fires once, with no second request, when it returns", async () => {
    const query = freshQuery();
    const answer = settleLater<Response>();
    const fetchSpy = stubFetch(() => answer.promise);
    const events = recordEvents();
    const onElement: string[] = [];
    const element = await mount({ query, loading: "eager" });
    element.addEventListener("bcd-load", (event) => onElement.push(event.type));
    element.addEventListener("bcd-error", (event) => onElement.push(event.type));

    element.remove();
    answer.resolve(okResponse(query));
    await settle();
    await element.updateComplete;

    expect(onElement).toEqual([]);
    expect(events.loads).toEqual([]);
    expect(element.querySelector("table")).toBeNull();

    document.body.append(element);
    await vi.waitFor(() => expect(events.loads).toHaveLength(1));

    expect(onElement).toEqual(["bcd-load"]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    events.stop();
  });

  it("disconnects the viewport observer of a lazy element", async () => {
    stubFetch(() => new Promise<Response>(() => {}));
    const disconnect = vi.spyOn(IntersectionObserver.prototype, "disconnect");
    const element = await mount({ query: freshQuery(), offset: 20_000 });
    expect(disconnect).not.toHaveBeenCalled();

    element.remove();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("fires no bcd-error when the request fails after the element was removed", async () => {
    const query = freshQuery();
    const answer = settleLater<Response>();
    stubFetch(() => answer.promise);
    const events = recordEvents();
    const element = await mount({ query, loading: "eager" });

    element.remove();
    answer.resolve(notFoundResponse(query));
    await settle();
    await element.updateComplete;

    expect(events.errors).toEqual([]);
    expect(events.loads).toEqual([]);
    events.stop();
  });

  it("sends one request and fires one bcd-load when moved within the page in one task", async () => {
    const query = freshQuery();
    const answer = settleLater<Response>();
    const fetchSpy = stubFetch(() => answer.promise);
    const events = recordEvents();
    const element = await mount({ query, loading: "eager" });
    const other = document.createElement("div");
    document.body.append(other);

    // Appending a connected element to another parent removes it and adds it again, in one task.
    other.append(element);
    answer.resolve(okResponse(query));
    await vi.waitFor(() => expect(events.loads).toHaveLength(1));
    await settle();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(events.loads).toEqual([{ mode: "fetch", snapshot: SNAPSHOT }]);
    events.stop();
  });

  it("sends nothing new from the error state on return or when a fallback child arrives", async () => {
    const query = freshQuery();
    const fetchSpy = stubFetch(async (url) => notFoundResponse(queryOf(url)));
    const events = recordEvents();
    const element = await mount({ query, loading: "eager" });
    await vi.waitFor(() => expect(events.errors).toHaveLength(1));

    element.remove();
    document.body.append(element);
    element.append(document.createElement("p"));
    await settle();
    await element.updateComplete;

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(events.errors).toHaveLength(1);
    events.stop();
  });
});

describe("values set on the properties", () => {
  it("treats a loading value other than eager as lazy", async () => {
    const fetchSpy = stubFetch(async (url) => okResponse(queryOf(url)));
    const element = document.createElement("bcd-compat-table") as BcdCompatTable;
    element.query = freshQuery();
    // A script or a framework binding can bypass the attribute converter.
    element.loading = "Lazy" as unknown as BcdCompatTable["loading"];
    const spacer = document.createElement("div");
    spacer.style.blockSize = "20000px";
    document.body.append(spacer, element);
    await element.updateComplete;
    await settle();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("treats an undefined query as absent, and sends no request", async () => {
    const fetchSpy = stubFetch(async (url) => okResponse(queryOf(url)));
    const events = recordEvents();
    const element = document.createElement("bcd-compat-table") as BcdCompatTable;
    element.loading = "eager";
    element.query = undefined as unknown as string;
    document.body.append(element);
    await element.updateComplete;
    await settle();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(events.errors).toEqual([]);
    expect(element.querySelector(".bcd-loading, .bcd-error")).toBeNull();
    events.stop();
  });
});

describe("the endpoint attribute", () => {
  it("sends the request to that origin", async () => {
    const query = freshQuery();
    const fetchSpy = stubFetch(async (url) => okResponse(queryOf(url)));

    const element = await mount({ query, loading: "eager", endpoint: "https://example.test" });
    await vi.waitFor(() => expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(true));

    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      `https://example.test/v1/current/features/${query}.json`,
    ]);
  });

  it("fires invalid-endpoint, with no request, for a value that is not a base URL", async () => {
    const fetchSpy = stubFetch(async (url) => okResponse(queryOf(url)));
    const events = recordEvents();

    await mount({ query: freshQuery(), loading: "eager", endpoint: "https://example.test/?key=1" });
    await vi.waitFor(() => expect(events.errors).toHaveLength(1));

    expect(events.errors).toEqual([
      { mode: "fetch", reason: "invalid-endpoint", status: null, code: null },
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
    events.stop();
  });

  it("requests again when the endpoint changes", async () => {
    const query = freshQuery();
    const fetchSpy = stubFetch(async (url) => okResponse(queryOf(url)));
    const events = recordEvents();
    const element = await mount({ query, loading: "eager" });
    await vi.waitFor(() => expect(events.loads).toHaveLength(1));

    element.setAttribute("endpoint", "https://example.test/");
    await vi.waitFor(() => expect(events.loads).toHaveLength(2));

    expect(fetchSpy.mock.calls.map(([url]) => new URL(String(url)).origin)).toEqual([
      "https://api.browser-compat.dev",
      "https://example.test",
    ]);
    events.stop();
  });
});

describe("an author's own aria-busy", () => {
  it("is left in place before, during, and after a request", async () => {
    const query = freshQuery();
    const answer = settleLater<Response>();
    stubFetch(() => answer.promise);
    const element = document.createElement("bcd-compat-table") as BcdCompatTable;
    element.setAttribute("query", query);
    element.setAttribute("loading", "eager");
    element.setAttribute("aria-busy", "false");
    document.body.append(element);
    await element.updateComplete;

    // The element does not overwrite a value the author set.
    expect(element.getAttribute("aria-busy")).toBe("false");

    answer.resolve(okResponse(query));
    await vi.waitFor(() => expect(element.hasAttribute(LOADED_ATTRIBUTE)).toBe(true));

    expect(element.getAttribute("aria-busy")).toBe("false");
  });

  it("is left in place on an element in data mode", async () => {
    const element = document.createElement("bcd-compat-table") as BcdCompatTable;
    element.setAttribute("aria-busy", "true");
    element.data = v1NormalizedFixture;
    document.body.append(element);
    await element.updateComplete;

    expect(element.getAttribute("aria-busy")).toBe("true");
  });
});

describe("the lazy wait", () => {
  it("says the data has not loaded yet, not that it is loading, before any request", async () => {
    const query = freshQuery();
    const fetchSpy = stubFetch(async (url) => okResponse(queryOf(url)));

    const element = await mount({ query, offset: 20_000 });
    await settle();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(element.hasAttribute("aria-busy")).toBe(false);
    expect(element.querySelector("p.bcd-loading")?.textContent).toBe(
      `Browser compatibility data for ${query} has not loaded yet.`,
    );
  });

  it("switches to the loading sentence once the request is in flight", async () => {
    const query = freshQuery();
    stubFetch(() => new Promise<Response>(() => {}));
    const element = await mount({ query, offset: 20_000 });

    element.loading = "eager";
    await element.updateComplete;

    expect(element.getAttribute("aria-busy")).toBe("true");
    expect(element.querySelector("p.bcd-loading")?.textContent).toBe(
      `Loading browser compatibility data for ${query}.`,
    );
  });

  for (const [name, options] of [
    ["an invalid query", { query: "a b" }],
    ["an invalid endpoint", { query: "fixture.never-sent", endpoint: "https://example.test/?x" }],
  ] as const) {
    it(`observes nothing and errors at once for ${name}, because no request can be sent`, async () => {
      const fetchSpy = stubFetch(async (url) => okResponse(queryOf(url)));
      const observe = vi.spyOn(IntersectionObserver.prototype, "observe");
      const events = recordEvents();

      await mount({ ...options, offset: 20_000 });
      await vi.waitFor(() => expect(events.errors).toHaveLength(1));

      expect(observe).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      events.stop();
    });
  }

  it("disconnects the observer when a waiting element's query becomes invalid", async () => {
    stubFetch(() => new Promise<Response>(() => {}));
    const disconnect = vi.spyOn(IntersectionObserver.prototype, "disconnect");
    const element = await mount({ query: freshQuery(), offset: 20_000 });

    element.setAttribute("query", "a b");
    await element.updateComplete;

    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

describe("restoring an input whose answer the element already shows", () => {
  it("renders the table again without a pending state or a request, and fires one bcd-load", async () => {
    const query = freshQuery();
    const fetchSpy = stubFetch(async (url) => okResponse(queryOf(url)));
    const events = recordEvents();
    const element = await mount({ query, loading: "eager" });
    await vi.waitFor(() => expect(events.loads).toHaveLength(1));

    element.removeAttribute("query");
    await element.updateComplete;
    expect(element.querySelector("table")).toBeNull();

    const busy: Array<string | null> = [];
    const watcher = new MutationObserver(() => busy.push(element.getAttribute("aria-busy")));
    watcher.observe(element, { attributes: true, attributeFilter: ["aria-busy"] });
    element.setAttribute("query", query);
    await element.updateComplete;
    await settle();
    watcher.disconnect();

    // The table is back in the same update, with no aria-busy in between.
    expect(captionOf(element)).toBe(`Browser compatibility: ${query}`);
    expect(busy).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(events.loads).toEqual([
      { mode: "fetch", snapshot: SNAPSHOT },
      { mode: "fetch", snapshot: SNAPSHOT },
    ]);
    events.stop();
  });

  it("shows the fetched table in the same update when data is set and cleared", async () => {
    const query = freshQuery();
    stubFetch(async (url) => okResponse(queryOf(url)));
    const events = recordEvents();
    const element = await mount({ query, loading: "eager" });
    await vi.waitFor(() => expect(events.loads).toHaveLength(1));

    element.data = v1NormalizedFixture;
    await element.updateComplete;
    element.data = null;
    await element.updateComplete;

    expect(captionOf(element)).toBe(`Browser compatibility: ${query}`);
    expect(element.hasAttribute("aria-busy")).toBe(false);
    expect(events.loads).toEqual([
      { mode: "fetch", snapshot: SNAPSHOT },
      { mode: "data", snapshot: null },
      { mode: "fetch", snapshot: SNAPSHOT },
    ]);
    events.stop();
  });

  it("asks again after a failure, which the request cache answers inside its window", async () => {
    const query = freshQuery();
    const fetchSpy = stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    const events = recordEvents();
    const element = await mount({ query, loading: "eager" });
    await vi.waitFor(() => expect(events.errors).toHaveLength(1));

    element.removeAttribute("query");
    await element.updateComplete;
    element.setAttribute("query", query);
    await vi.waitFor(() => expect(events.errors).toHaveLength(2));

    // Inside the 10-second window the held failure answers, so nothing is sent.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    events.stop();
  });

  it("does nothing when the same query is assigned again", async () => {
    const query = freshQuery();
    const fetchSpy = stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    const events = recordEvents();
    const element = await mount({ query, loading: "eager" });
    await vi.waitFor(() => expect(events.errors).toHaveLength(1));

    element.setAttribute("query", query);
    element.query = query;
    await element.updateComplete;
    await settle();

    expect(events.errors).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    events.stop();
  });
});

describe("two elements sharing one request", () => {
  for (const order of ["removed, then the answer", "the answer, then removed"] as const) {
    it(`fires nothing for the removed element and one bcd-load for the other: ${order}`, async () => {
      const query = freshQuery();
      const answer = settleLater<Response>();
      const fetchSpy = stubFetch(() => answer.promise);
      const removed = await mount({ query, loading: "eager" });
      const kept = await mount({ query, loading: "eager" });
      const onRemoved: string[] = [];
      const onKept: string[] = [];
      removed.addEventListener("bcd-load", (event) => onRemoved.push(event.type));
      kept.addEventListener("bcd-load", (event) => onKept.push(event.type));

      if (order === "removed, then the answer") {
        removed.remove();
        answer.resolve(okResponse(query));
      } else {
        // The answer settles, but the elements only learn of it in a later microtask, so the
        // removal comes first from the element's point of view.
        answer.resolve(okResponse(query));
        removed.remove();
      }
      await vi.waitFor(() => expect(onKept).toEqual(["bcd-load"]));
      await settle();
      await removed.updateComplete;

      expect(onRemoved).toEqual([]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      document.body.append(removed);
      await vi.waitFor(() => expect(onRemoved).toEqual(["bcd-load"]));
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  }
});
