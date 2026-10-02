import { describe, expect, it, vi } from "vitest";

import { notifySentry } from "../scripts/notify-sentry.mjs";

describe("pipeline Sentry notification", () => {
  it("states the missing-secret prerequisite without claiming delivery", async () => {
    await expect(
      notifySentry({ dsn: undefined, event: "freshness", status: "failure" }),
    ).resolves.toEqual({
      delivered: false,
      prerequisite: "Configure the SENTRY_DSN secret to enable pipeline alerts.",
    });
  });

  it("sends only bounded pipeline data through a fake transport", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    await expect(
      notifySentry({
        dsn: "https://public@example.invalid/42",
        event: "freshness",
        fetchImpl,
        status: "failure",
      }),
    ).resolves.toEqual({ delivered: true });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://example.invalid/api/42/envelope/?sentry_version=7&sentry_key=public",
    );
    expect(String(init.body)).toContain('"logger":"bcd-embed.pipeline"');
    expect(String(init.body)).not.toContain("SENTRY_DSN");
  });

  it("fails when the fake transport rejects delivery", async () => {
    await expect(
      notifySentry({
        dsn: "https://public@example.invalid/42",
        event: "freshness",
        fetchImpl: async () => new Response(null, { status: 503 }),
        status: "failure",
      }),
    ).rejects.toThrow("HTTP 503");
  });

  it.each([
    ["stalled", 200],
    ["stalled", 503],
    ["large", 200],
    ["large", 503],
  ] as const)(
    "cancels a %s response body for HTTP %s without buffering it",
    async (kind, httpStatus) => {
      const cancelled = vi.fn();
      let pulls = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          if (kind === "large" && pulls === 1) {
            controller.enqueue(new Uint8Array(1024 * 1024));
            return;
          }
          return new Promise<void>(() => {});
        },
        cancel: cancelled,
      });
      const response = new Response(body, {
        status: httpStatus,
        headers: { "content-length": "1099511627776" },
      });
      const buffered = vi.spyOn(response, "arrayBuffer");
      const result = notifySentry({
        dsn: "https://public@example.invalid/42",
        event: "freshness",
        fetchImpl: async () => response,
        status: "failure",
      });
      if (httpStatus === 200) await expect(result).resolves.toEqual({ delivered: true });
      else await expect(result).rejects.toThrow("HTTP 503");
      expect(cancelled).toHaveBeenCalledOnce();
      expect(buffered).not.toHaveBeenCalled();
      expect(pulls).toBeLessThanOrEqual(1);
    },
  );

  it("does not claim delivery if response cleanup fails", async () => {
    const response = new Response(
      new ReadableStream({
        cancel() {
          throw new Error("Cancellation failed");
        },
      }),
    );
    await expect(
      notifySentry({
        dsn: "https://public@example.invalid/42",
        event: "freshness",
        fetchImpl: async () => response,
        status: "failure",
      }),
    ).rejects.toThrow("Cancellation failed");
  });
});
