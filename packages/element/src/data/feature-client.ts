/**
 * The client that requests one feature from the API and classifies the answer. It never throws
 * for a failed request: every outcome is a `FeatureResult`, so the element decides how to show it.
 *
 * Failure caching, and why it exists. A failure must never turn into a retry loop, because fifty
 * elements on a page, or a page reload loop, could otherwise hammer an API that is already
 * refusing them. The rules, from `retentionOf` below:
 *
 *   - A success stays for the life of the page.
 *   - A 4xx response whose body carries a contract error code (Document 1 §8), other than 429,
 *     stays for the life of the page. The API said this key is wrong, and asking again cannot
 *     change that within one page view.
 *   - Everything else stays for `FAILURE_WINDOW_MS`: a network failure, a 429, a 5xx, a 4xx
 *     without a contract code (such as Cloudflare's own `400`), and a body that is not a
 *     feature response. A call after the window sends one new request. Nothing retries by timer.
 *
 * A browser cannot read the edge rate limit's 429, because Cloudflare's page has no
 * `access-control-allow-origin` header (Document 1 §8, Document 9). `fetch` rejects, and the
 * client reports `reason: "network"` with `status: null`, which the window above covers.
 *
 * Payload validation uses types only. `isFeatureResponseEnvelope` checks the top-level shape of
 * the body and not the data inside it, because the schema package's Zod runtime must not enter
 * the element's bundle (Document 3 §4). The full schema runs at build time on the server.
 */

import type { FeatureResponse } from "@bcd-embed/schema";

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
 * The key pattern from the schema package's `featureKeySchema`. The element cannot import that
 * schema at runtime (it is a Zod object), so a test checks this copy against it.
 */
export const FEATURE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._$@-]*$/;

/** The response header that names the snapshot that answered (Document 1 §7). */
const SNAPSHOT_HEADER = "bcd-embed-snapshot";

export type FeatureErrorReason = "invalid-query" | "network" | "http" | "invalid-payload";

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
  /** The API base URL. A trailing slash is allowed. Defaults to `DEFAULT_ENDPOINT`. */
  readonly endpoint?: string;
  /** Ends this caller's wait. It does not cancel the shared request. */
  readonly signal?: AbortSignal;
};

export type FeatureClientOptions = {
  /** The `fetch` to call. A test injects a fake one. */
  readonly fetch: typeof fetch;
  /** The clock, in milliseconds. A test injects a fake one. */
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

/** Builds `{endpoint}/v1/current/features/{query}.json`. The caller has validated `query`. */
export const buildFeatureUrl = (query: string, endpoint: string = DEFAULT_ENDPOINT): string =>
  `${trimTrailingSlashes(endpoint)}/v1/current/features/${query}.json`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Checks the top-level shape of a feature response, not the data inside it. This is a type guard
 * that trusts the server's own validation for everything below the envelope.
 */
export const isFeatureResponseEnvelope = (value: unknown): value is FeatureResponse =>
  isRecord(value) &&
  typeof value.contract === "string" &&
  typeof value.query === "string" &&
  isRecord(value.browsers) &&
  Array.isArray(value.features);

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
 * How long a result stays cached. A 4xx with a contract code is the API's definite answer, so it
 * stays for the page's life. A 429 is the exception: it is temporary even when it has a code.
 */
export const retentionOf = (result: FeatureResult): Retention => {
  if (result.ok) return null;
  if (
    result.reason === "http" &&
    result.status !== null &&
    result.status >= 400 &&
    result.status < 500 &&
    result.status !== 429 &&
    result.code !== null
  ) {
    return null;
  }
  return FAILURE_WINDOW_MS;
};

export const createFeatureClient = ({
  fetch: fetchImpl,
  now = Date.now,
}: FeatureClientOptions): FeatureClient => {
  const cache: RequestCache<FeatureResult> = createRequestCache({ now, retentionOf });

  const load = async (url: string): Promise<FeatureResult> => {
    let response: Response;
    try {
      // No headers, no body, and no credentials: the request is a plain `GET` that the API's CORS
      // policy allows without a preflight. The shared request gets no signal on purpose.
      response = await fetchImpl(url, { credentials: "omit" });
    } catch {
      return failure("network");
    }
    try {
      return await classify(response);
    } catch {
      // Reading the body failed partway, for example a dropped connection.
      return failure("network");
    }
  };

  const requestFeature = ({ query, endpoint, signal }: FeatureRequest): Promise<FeatureResult> => {
    if (!FEATURE_KEY_PATTERN.test(query)) return Promise.resolve(failure("invalid-query"));
    const url = buildFeatureUrl(query, endpoint);
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
