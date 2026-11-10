import { describe, expect, it } from "vitest";

import { UPLOAD_CONCURRENCY, runBounded } from "../src/concurrency.js";

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("bounded concurrency", () => {
  it("keeps at most UPLOAD_CONCURRENCY actions in flight and fills that bound", async () => {
    let inFlight = 0;
    let peak = 0;
    const values = Array.from({ length: UPLOAD_CONCURRENCY * 3 }, (_, index) => index);
    const seen: number[] = [];
    await runBounded(values, async (value) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick();
      seen.push(value);
      inFlight -= 1;
    });
    expect(peak).toBe(UPLOAD_CONCURRENCY);
    expect(seen.toSorted((a, b) => a - b)).toEqual(values);
  });

  it("reports the completed count after each value", async () => {
    const counts: number[] = [];
    await runBounded([1, 2, 3, 4, 5], tick, (completed) => counts.push(completed));
    expect(counts).toEqual([1, 2, 3, 4, 5]);
  });

  it("stops starting work after a failure and rethrows it without counting it", async () => {
    const values = Array.from({ length: UPLOAD_CONCURRENCY * 4 }, (_, index) => index);
    let started = 0;
    const counts: number[] = [];
    await expect(
      runBounded(
        values,
        async (value) => {
          started += 1;
          await tick();
          if (value === 0) throw new Error("Simulated");
        },
        (completed) => counts.push(completed),
      ),
    ).rejects.toThrow("Simulated");
    expect(started).toBeLessThan(values.length);
    expect(counts).not.toContain(values.length);
  });
});
