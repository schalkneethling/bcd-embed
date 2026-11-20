// A stand-in API for `fetch-mode.html`, so the page can hold the loading and error states still
// without a server. It replaces the page's `fetch` for one origin, `https://fixture.test`, and
// passes every other request to the real `fetch`, so a Playwright test can still route the hosted
// API's origin. The element's feature client calls `globalThis.fetch` when it sends a request,
// not when the module loads, so this module only has to run before the first request. The page
// imports it before the element for that reason.

import { v1NormalizedFixture } from "../../../schema/src/fixtures/v1.js";

/** The origin this module answers for. Elements on the page set it as their `endpoint`. */
export const FIXTURE_ENDPOINT = "https://fixture.test";

/** The snapshot header the stand-in sends with every success. */
export const FIXTURE_SNAPSHOT = "bcd-fixture-gen-0.0.0";

const FEATURE_PATH = "/v1/current/features/";

/**
 * What each query answers. `fixture.pending` never answers, so the element stays in the loading
 * state until the feature client's own deadline, `REQUEST_TIMEOUT_MS` (20 seconds), turns it into
 * the error `network`. A test that needs the state for longer installs Playwright's fake clock.
 */
const answer = (query: string): Promise<Response> => {
  switch (query) {
    case "fixture.adversarial-v1":
      return Promise.resolve(
        new Response(JSON.stringify(v1NormalizedFixture), {
          status: 200,
          headers: { "content-type": "application/json", "bcd-embed-snapshot": FIXTURE_SNAPSHOT },
        }),
      );
    case "fixture.pending":
      return new Promise<Response>(() => {});
    case "fixture.unavailable":
      // What a browser reports for the edge rate limit's 429, which has no CORS header.
      return Promise.reject(new TypeError("Failed to fetch"));
    default:
      return Promise.resolve(
        new Response(
          JSON.stringify({
            error: { code: "feature_not_found", message: `No data for ${query}.`, query },
          }),
          { status: 404, headers: { "content-type": "application/json" } },
        ),
      );
  }
};

declare global {
  // An interface, because only an interface can add a member to the DOM library's `Window`.
  interface Window {
    /** The payload the stand-in answers `fixture.adversarial-v1` with, for tests that set `data`. */
    bcdFetchFixture: { readonly payload: typeof v1NormalizedFixture };
  }
}

window.bcdFetchFixture = { payload: v1NormalizedFixture };

const realFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== FIXTURE_ENDPOINT || !url.pathname.startsWith(FEATURE_PATH)) {
    return realFetch(input, init);
  }
  return answer(url.pathname.slice(FEATURE_PATH.length, -".json".length));
};
