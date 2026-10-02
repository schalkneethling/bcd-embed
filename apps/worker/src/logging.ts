import * as Sentry from "@sentry/cloudflare";

/** Log a bounded diagnostic without leaking URL, key, or upstream error text. */
export const reportError = (error: unknown): void => {
  const errorType =
    error instanceof TypeError
      ? "TypeError"
      : error instanceof RangeError
        ? "RangeError"
        : error instanceof Error
          ? "Error"
          : "Unknown";
  // Never hand the original error to a remote reporter: it may include request
  // paths, upstream response text, or credentials. Reporting cannot affect serving.
  try {
    Sentry.withScope((scope) => {
      scope.setTag("component", "worker");
      scope.setTag("event", "bcd_embed_worker_error");
      Sentry.captureException(new Error(errorType), {
        mechanism: { handled: true, type: "bcd_embed_worker_error" },
      });
    });
  } catch {}
  console.error(
    JSON.stringify({
      event: "bcd_embed_worker_error",
      errorType,
    }),
  );
};
