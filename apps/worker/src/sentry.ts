import type { CloudflareOptions } from "@sentry/cloudflare";

type SentryEnv = { SENTRY_DSN?: string };

const redactEvent = (event: Parameters<NonNullable<CloudflareOptions["beforeSend"]>>[0]) => ({
  event_id: event.event_id,
  exception:
    event.exception === undefined
      ? undefined
      : {
          values: event.exception.values?.map(() => ({
            type: "WorkerError",
            value: "WorkerError",
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
    maxBreadcrumbs: 0,
    tracesSampleRate: 0,
  };
};
