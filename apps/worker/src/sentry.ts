import type { CloudflareOptions } from "@sentry/cloudflare";

type SentryEnv = { SENTRY_DSN?: string };

/** The bounded classes `reportError` puts in the exception value; anything else is redacted. */
const BOUNDED_ERROR_CLASSES: ReadonlySet<string> = new Set([
  "TypeError",
  "RangeError",
  "Error",
  "Unknown",
]);

/**
 * The tags `reportError` sets, each with the only value it ever sets. A tag is kept only when it
 * matches exactly, so alert rules can filter on it without letting other values through.
 */
const BOUNDED_TAGS: ReadonlyMap<string, string> = new Map([
  ["component", "worker"],
  ["event", "bcd_embed_worker_error"],
]);

const boundedTags = (tags: Record<string, unknown> | undefined) => {
  const kept = Object.fromEntries(
    [...BOUNDED_TAGS].filter(([key, value]) => tags?.[key] === value),
  );
  return Object.keys(kept).length === 0 ? undefined : kept;
};

const redactEvent = (event: Parameters<NonNullable<CloudflareOptions["beforeSend"]>>[0]) => ({
  event_id: event.event_id,
  exception:
    event.exception === undefined
      ? undefined
      : {
          values: event.exception.values?.map(({ value }) => ({
            type: "WorkerError",
            value: value !== undefined && BOUNDED_ERROR_CLASSES.has(value) ? value : "WorkerError",
          })),
        },
  level: event.level,
  platform: event.platform,
  tags: boundedTags(event.tags),
  timestamp: event.timestamp,
  type: event.type,
});

/**
 * Secrets are configured as a Worker binding, never committed. Returning undefined
 * deliberately disables Sentry when an operator has not configured a DSN.
 */
export const sentryOptions = (env: SentryEnv): CloudflareOptions | undefined => {
  const dsn = env.SENTRY_DSN?.trim();
  if (dsn === undefined || dsn === "") return undefined;
  return {
    dsn,
    beforeSend: redactEvent,
    // Without this the SDK awaits the request body before calling the handler, delaying responses.
    dataCollection: { httpBodies: [] },
    maxBreadcrumbs: 0,
    tracesSampleRate: 0,
  };
};
