import { describe, expect, it, vi } from "vitest";

const captureException = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("fake transport unavailable");
  }),
);

vi.mock("@sentry/cloudflare", () => ({
  captureException,
  withScope: (callback: (scope: { setTag: () => void }) => void) => callback({ setTag: () => {} }),
}));

import { reportError } from "../src/logging.js";

describe("runtime reporting", () => {
  it("keeps the Worker healthy when the local fake Sentry transport fails", () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => reportError(new Error("request-secret"))).not.toThrow();
      expect(captureException).toHaveBeenCalledOnce();
      expect(String(captureException.mock.calls[0]?.[0])).not.toContain("request-secret");
    } finally {
      errorLog.mockRestore();
    }
  });
});
