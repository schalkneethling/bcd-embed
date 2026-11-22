/**
 * The client that requests one feature from the API and classifies the answer. It never throws
 * for a failed request: every outcome is a `FeatureResult`, so the element decides how to show it.
 *
 * Failure caching, and why it exists. A failure must never turn into a retry loop, because fifty
 * elements on a page, or a page reload loop, could otherwise hammer an API that is already
 * refusing them. The rules, from `retentionOf` below:
 *
 *   - A success stays for the life of the page.
 *   - A 4xx response whose body carries one of the contract's permanent error codes
 *     (`PERMANENT_ERROR_CODES`, from Document 1 §8) stays for the life of the page. The API said
 *     this key or snapshot is wrong, and asking again cannot change that within one page view.
 *   - A query that fails the key pattern, and an endpoint that is not a base URL, are answered
 *     at once with `invalid-query` or `invalid-endpoint`. No request is sent and nothing is cached.
 *   - Everything else stays for `FAILURE_WINDOW_MS`: a network failure, a timeout, a 429, a 5xx,
 *     a 4xx without a permanent code (such as Cloudflare's own `400`), and a body that is not a
 *     feature response. A call after the window sends one new request. Nothing retries by timer.
 *
 * A browser cannot read the edge rate limit's 429, because Cloudflare's page has no
 * `access-control-allow-origin` header (Document 1 §8, Document 9). `fetch` rejects, and the
 * client reports `reason: "network"` with `status: null`, which the window above covers.
 *
 * A request that never settles. The shared request has an internal deadline, `REQUEST_TIMEOUT_MS`,
 * that covers the fetch and the reading of the body. It belongs to the shared request, not to any
 * caller, so one caller's abort cannot trigger it. When it fires, the result is `network`, which
 * the failure window then holds. Without it, a stalled body would keep every element waiting.
 *
 * Payload validation uses types only. `isFeatureResponseEnvelope` checks the envelope and the
 * outer layer of the data in linear time: the contract's major version is 1, `browsers` is an
 * object of objects, and `features` is an array of objects that each have a `support` object. It
 * does not check the values inside a `support` entry, because the schema package's Zod runtime
 * must not enter the element's bundle (Document 3 §4). The full schema runs on the server at
 * build time. A body can therefore pass this check and still be malformed deeper down, so the
 * consumer must map a throw while it builds its model or renders to `invalid-payload`.
 *
 * Callers share one payload object, so consumers must not mutate it.
 */

import type { FeatureResponse } from "../contract.js";

import { createRequestCache, type RequestCache, type Retention } from "./request-cache.js";

/** The hosted API's hostname (Document 9). `endpoint` overrides it for a self-hosted API. */
export const DEFAULT_ENDPOINT = "https://api.browser-compat.dev";

/**
 * How long a failure stays cached. It equals the block duration of the hosted API's rate limiting
 * rule, 10 seconds, so a client that waits this long is no longer blocked. The rule's settings
 * are in the "Rate limiting" section of `apps/website/src/content/docs/deployment.md`
 * (`deployment.md`).
 */
export const FAILURE_WINDOW_MS = 10_000;

/**
 * How long the shared request may take, fetch and body together. Twenty seconds is far above a
 * normal answer (a cached edge response takes well under a second) and gives a slow mobile
 * connection time to finish a large feature, while still ending a stalled request before a reader
 * gives up on the page.
 */
export const REQUEST_TIMEOUT_MS = 20_000;

/**
 * The error codes after which asking again cannot help in one page view (Document 1 §8). Other
 * codes, such as `rate_limited` and `generation_in_progress`, are temporary.
 */
export const PERMANENT_ERROR_CODES: ReadonlySet<string> = new Set([
  "invalid_key",
  "feature_not_found",
  "namespace_not_queryable",
  "snapshot_not_found",
]);

/**
 * The key pattern from the schema package's `featureKeySchema`. The element cannot import that
 * schema at runtime (it is a Zod object), so a test checks this copy against it.
 */
export const FEATURE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._$@-]*$/;

/** The response header that names the snapshot that answered (Document 1 §7). */
const SNAPSHOT_HEADER = "bcd-embed-snapshot";

export type FeatureErrorReason =
  | "invalid-query"
  | "invalid-endpoint"
  | "network"
  | "http"
  | "invalid-payload";

export type FeatureSuccess = {
  readonly ok: true;
  readonly payload: FeatureResponse;
  /** The value of the `bcd-embed-snapshot` header, or `null` if the response had none. */
  readonly snapshot: string | null;
};

export type FeatureFailure = {
  readonly ok: false;
  readonly reason: FeatureErrorReason;
  /** The HTTP status for `"http"`; `null` for every other reason. */
  readonly status: number | null;
  /** The contract's error code, such as `"feature_not_found"`, when the body carries one. */
  readonly code: string | null;
};

export type FeatureResult = FeatureSuccess | FeatureFailure;

export type FeatureRequest = {
  /** The BCD dotted key, such as `css.properties.display`. */
  readonly query: string;
  /**
   * The API base URL: an absolute `https:` or `http:` URL without a query string, a fragment, or
   * credentials. A trailing slash and a path are allowed. Defaults to `DEFAULT_ENDPOINT`. Any
   * other value gives `invalid-endpoint` and sends no request.
   */
  readonly endpoint?: string;
  /** Ends this caller's wait. It does not cancel the shared request. */
  readonly signal?: AbortSignal;
};

export type FeatureClientOptions = {
  /** The `fetch` to call. A test injects a fake one. */
  readonly fetch: typeof fetch;
  /** The monotonic clock, in milliseconds. It defaults to `performance.now()`. A test injects a fake one. */
  readonly now?: () => number;
};

export type FeatureClient = {
  /** Resolves with a classified result. It rejects only when `signal` aborts. */
  readonly requestFeature: (request: FeatureRequest) => Promise<FeatureResult>;
  /** The number of cached URLs, for tests. */
  readonly cacheSize: () => number;
};

const failure = (
  reason: FeatureErrorReason,
  status: number | null = null,
  code: string | null = null,
): FeatureFailure => ({ ok: false, reason, status, code });

/** Removes trailing slashes in linear time. */
const trimTrailingSlashes = (value: string): string => {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
};

/**
 * Parses `endpoint` as the base URL of an API, or returns `null` when it is not one. A base URL
 * is an absolute `https:` or `http:` URL (`http:` serves a self-hosted API on a local machine)
 * with no user name or password, no query string, and no fragment. Without this check an empty
 * string would become a request relative to the page, and a `?` or `#` would turn the feature path
 * into a query string or a fragment. The raw text is checked for `?` and `#` as well as the parsed
 * URL, because the URL parser reports an empty query, as in `https://a.test/?`, as no query at
 * all. O(n) for an endpoint of n characters.
 */
const parseEndpoint = (endpoint: string): URL | null => {
  if (endpoint.includes("?") || endpoint.includes("#")) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username !== "" || url.password !== "") return null;
  return url;
};

/**
 * Whether `requestFeature` would accept `endpoint`, so the element can tell that no request will
 * ever go out and stop waiting for the viewport. O(n) for an endpoint of n characters.
 */
export const isValidEndpoint = (endpoint: string): boolean => parseEndpoint(endpoint) !== null;

/**
 * Builds `{endpoint}/v1/current/features/{query}.json`. The caller has validated `query` and
 * `endpoint`.
 */
export const buildFeatureUrl = (query: string, endpoint: string = DEFAULT_ENDPOINT): string =>
  `${trimTrailingSlashes(endpoint)}/v1/current/features/${query}.json`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Checks the envelope and the outer layer of a feature response in O(browsers + features) time.
 * Despite the type predicate, it does not prove the whole `FeatureResponse` shape: it trusts the
 * server's own validation for everything inside a `support` entry.
 */
export const isFeatureResponseEnvelope = (value: unknown): value is FeatureResponse =>
  isRecord(value) &&
  typeof value.contract === "string" &&
  value.contract.startsWith("1.") &&
  typeof value.query === "string" &&
  isRecord(value.browsers) &&
  Object.values(value.browsers).every(isRecord) &&
  Array.isArray(value.features) &&
  value.features.every((feature) => isRecord(feature) && isRecord(feature.support));

/** Reads `error.code` from a contract error body, or `null` when the body has none. */
const readErrorCode = (text: string): string | null => {
  try {
    const body: unknown = JSON.parse(text);
    if (isRecord(body) && isRecord(body.error) && typeof body.error.code === "string") {
      return body.error.code;
    }
  } catch {
    // The body is not JSON, so it carries no contract code.
  }
  return null;
};

/**
 * Classifies a response. The body is read as text first, so a body that cannot be read (a dropped
 * connection) throws and becomes `"network"`, while text that is not JSON becomes `"invalid-payload"`.
 */
const classify = async (response: Response): Promise<FeatureResult> => {
  const text = await response.text();
  if (!response.ok) return failure("http", response.status, readErrorCode(text));
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return failure("invalid-payload");
  }
  if (!isFeatureResponseEnvelope(body)) return failure("invalid-payload");
  return { ok: true, payload: body, snapshot: response.headers.get(SNAPSHOT_HEADER) };
};

/**
 * How long a result stays cached. A 4xx with a permanent contract code is the API's definite answer, so
 * it stays for the page's life. Any other code, such as `rate_limited`, is temporary.
 */
export const retentionOf = (result: FeatureResult): Retention => {
  if (result.ok) return null;
  if (
    result.reason === "http" &&
    result.status !== null &&
    result.status >= 400 &&
    result.status < 500 &&
    PERMANENT_ERROR_CODES.has(result.code ?? "")
  ) {
    return null;
  }
  return FAILURE_WINDOW_MS;
};

export const createFeatureClient = ({
  fetch: fetchImpl,
  now = () => performance.now(),
}: FeatureClientOptions): FeatureClient => {
  const cache: RequestCache<FeatureResult> = createRequestCache({ now, retentionOf });

  const attempt = async (url: string, signal: AbortSignal): Promise<FeatureResult> =>
    classify(await fetchImpl(url, { credentials: "omit", signal }));

  const load = async (url: string): Promise<FeatureResult> => {
    // The deadline is the shared request's own. No caller's signal reaches it.
    const controller = new AbortController();
    const deadline = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
        once: true,
      });
    });
    deadline.catch(() => {});
    const timer = setTimeout(() => controller.abort(new Error("timeout")), REQUEST_TIMEOUT_MS);
    try {
      // No headers, no body, and no credentials: a plain `GET` that the API's CORS policy allows
      // without a preflight. The race ends the wait even for a `fetch` that ignores the signal,
      // and the signal stops the real request and its body read.
      return await Promise.race([attempt(url, controller.signal), deadline]);
    } catch {
      return failure("network");
    } finally {
      clearTimeout(timer);
    }
  };

  const requestFeature = ({ query, endpoint, signal }: FeatureRequest): Promise<FeatureResult> => {
    if (!FEATURE_KEY_PATTERN.test(query)) return Promise.resolve(failure("invalid-query"));
    const base = endpoint === undefined ? DEFAULT_ENDPOINT : parseEndpoint(endpoint)?.href;
    if (base === undefined) return Promise.resolve(failure("invalid-endpoint"));
    // The parsed URL's `href` is the normalized form, so `https://Example.TEST` and
    // `https://example.test/` share one cache entry.
    const url = buildFeatureUrl(query, base);
    return cache.request(url, () => load(url), signal);
  };

  return { requestFeature, cacheSize: cache.size };
};

let pageClient: FeatureClient | undefined;

/**
 * The client the element uses: one per page, created on first use with the page's own `fetch`.
 * Module-level state is deliberate here, because the cache must be shared by every element.
 */
export const getPageFeatureClient = (): FeatureClient => {
  pageClient ??= createFeatureClient({ fetch: (input, init) => globalThis.fetch(input, init) });
  return pageClient;
};
