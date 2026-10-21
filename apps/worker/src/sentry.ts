import type { CloudflareOptions } from "@sentry/cloudflare";

type SentryEnv = { SENTRY_DSN?: string };

/** The bounded classes `reportError` puts in the exception value; anything else is redacted. */
const BOUNDED_ERROR_CLASSES: ReadonlySet<string> = new Set([
  "TypeError",
  "RangeError",
  "Error",
  "Unknown",
]);

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
