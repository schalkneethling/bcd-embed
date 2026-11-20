/**
 * A cache of requests, keyed by the full request URL. It answers one question: do any number of
 * elements asking for the same feature produce one request, and does a failure never produce a
 * retry loop?
 *
 * Sharing. The first call for a URL starts the request and stores its promise. Every later call
 * for that URL, before or after the request settles, gets the same promise until the entry
 * expires. Fifty `<bcd-compat-table>` elements for `css.properties.display` send one request.
 *
 * Retention. When a request settles, the caller-supplied `retentionOf` function decides how long
 * the result stays: `null` keeps it for the life of the page, and a number of milliseconds keeps
 * it for that long, measured from the moment it settled. An expired entry is replaced by the next
 * call for its URL, so a retry happens only when a caller asks after the window, never on a timer.
 * The cache starts no timers.
 *
 * Cancellation. A caller's `AbortSignal` ends that caller's wait and nothing else. The shared
 * request never receives a signal, so it cannot be cancelled. Take three elements, A, B, and C,
 * that all ask for `css.properties.display`:
 *
 *   1. A, B, and C call `request`. The first call starts the fetch, and all three wait on it.
 *   2. A's element leaves the page and aborts A's signal. A's promise rejects with the signal's
 *      reason, and A stops waiting. The fetch keeps running.
 *   3. The fetch settles. B and C receive the result, and the cache stores it for later callers.
 *
 * Space. The cache holds one entry per distinct URL, so memory grows with the number of distinct
 * features a page asks for, not with the number of elements. There is no eviction for successes:
 * a page asks for a handful of features, and a successful result is the data the page is
 * showing. A failure entry is replaced, not added to, when its window ends.
 *
 * Time. `request` does one `Map` lookup and, at most, one insertion, so each call costs O(1)
 * apart from the work in `load`. A call registers one abort listener and removes it when the
 * request settles or the caller aborts.
 */

/** How long a settled result stays in the cache: `null` for the life of the page, else milliseconds. */
export type Retention = number | null;

type Entry<Result> = {
  readonly promise: Promise<Result>;
  /**
   * `undefined` while the request is in flight, so an in-flight entry never expires. Once settled,
   * `null` means the entry never expires, and a number is the time, on the cache's clock, when it
   * does.
   */
  expiresAt: number | null | undefined;
};

export type RequestCacheOptions<Result> = {
  /** The clock, in milliseconds. A test injects a fake one. */
  readonly now: () => number;
  /** Decides how long a settled result stays in the cache. */
  readonly retentionOf: (result: Result) => Retention;
};

export type RequestCache<Result> = {
  /**
   * Returns the shared result for `url`, starting `load` only when no live entry exists. `load`
   * must resolve with a classified result and must not reject.
   */
  readonly request: (
    url: string,
    load: () => Promise<Result>,
    signal?: AbortSignal,
  ) => Promise<Result>;
  /** The number of entries, for tests and diagnostics. */
  readonly size: () => number;
};

export const createRequestCache = <Result>({
  now,
  retentionOf,
}: RequestCacheOptions<Result>): RequestCache<Result> => {
  const entries = new Map<string, Entry<Result>>();

  const isLive = (entry: Entry<Result>): boolean =>
    entry.expiresAt === undefined || entry.expiresAt === null || now() < entry.expiresAt;

  const start = (url: string, load: () => Promise<Result>): Entry<Result> => {
    const entry: Entry<Result> = {
      promise: load().then(
        (result) => {
          const retention = retentionOf(result);
          entry.expiresAt = retention === null ? null : now() + retention;
          return result;
        },
        (error: unknown) => {
          // `load` promised not to reject. If it does anyway, forget the entry so the next call
          // can try again, and pass the error on to the callers that already wait on it.
          if (entries.get(url) === entry) entries.delete(url);
          throw error;
        },
      ),
      expiresAt: undefined,
    };
    entries.set(url, entry);
    return entry;
  };

  const request = (
    url: string,
    load: () => Promise<Result>,
    signal?: AbortSignal,
  ): Promise<Result> => {
    // An already-aborted caller never needs the result, so it must not start a request.
    if (signal?.aborted) return Promise.reject(signal.reason);

    const existing = entries.get(url);
    const entry = existing !== undefined && isLive(existing) ? existing : start(url, load);

    if (signal === undefined) return entry.promise;

    return new Promise<Result>((resolve, reject) => {
      const onAbort = (): void => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      const done = (): void => signal.removeEventListener("abort", onAbort);
      entry.promise.then(
        (result) => {
          done();
          resolve(result);
        },
        (error: unknown) => {
          done();
          reject(error);
        },
      );
    });
  };

  return { request, size: () => entries.size };
};
