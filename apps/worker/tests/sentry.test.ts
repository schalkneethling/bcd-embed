import { describe, expect, it } from "vitest";

import { sentryOptions } from "../src/sentry.js";

describe("Worker Sentry configuration", () => {
  it("is disabled until an operator configures the secret", () => {
    expect(sentryOptions({})).toBeUndefined();
    expect(sentryOptions({ SENTRY_DSN: "   " })).toBeUndefined();
  });

  it("scrubs request and error data before any transport can receive it", () => {
    const options = sentryOptions({ SENTRY_DSN: "https://public@example.invalid/1" })!;
    const event = options.beforeSend!(
      {
        breadcrumbs: [{ message: "secret" }],
        extra: { secret: "secret" },
        message: "request-path-and-secret",
        request: { url: "https://api.example.test/secret" },
        user: { email: "secret@example.test" },
      },
      {},
    );
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("api.example.test");
  });

  it("keeps only the bounded error class as the exception value", () => {
    const options = sentryOptions({ SENTRY_DSN: "https://public@example.invalid/1" })!;
    const event = options.beforeSend!(
      {
        exception: {
          values: [
            { type: "Error", value: "RangeError" },
            { type: "Error", value: "/private/path?token=secret" },
            { type: "Error" },
          ],
        },
      },
      {},
    ) as { exception: { values: Array<{ type: string; value: string }> } };
    expect(event.exception.values).toEqual([
      { type: "WorkerError", value: "RangeError" },
      { type: "WorkerError", value: "WorkerError" },
      { type: "WorkerError", value: "WorkerError" },
    ]);
  });

  it("does not read request bodies before the handler runs", () => {
    const options = sentryOptions({ SENTRY_DSN: "https://public@example.invalid/1" })!;
    expect(options.dataCollection).toEqual({ httpBodies: [] });
  });
});
