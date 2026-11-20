import { describe, expect, it, vi } from "vitest";

import { createRequestCache } from "../../src/data/request-cache.js";

const setup = (retention: number | null) => {
  let time = 0;
  const cache = createRequestCache<string>({ now: () => time, retentionOf: () => retention });
  return {
    cache,
    advanceTo: (next: number) => {
      time = next;
    },
  };
};

describe("the request cache", () => {
  it("calls load once for concurrent callers of one URL", async () => {
    const { cache } = setup(null);
    const load = vi.fn(async () => "a");

    const results = await Promise.all([
      cache.request("u", load),
      cache.request("u", load),
      cache.request("u", load),
    ]);

    expect(results).toEqual(["a", "a", "a"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("holds one entry per distinct URL", async () => {
    const { cache } = setup(null);

    await Promise.all(
      ["u1", "u2", "u1", "u3", "u2"].map((url) => cache.request(url, async () => url)),
    );

    expect(cache.size()).toBe(3);
  });

  it("replaces an expired entry instead of adding one", async () => {
    const { cache, advanceTo } = setup(10);
    const load = vi.fn(async () => "a");

    await cache.request("u", load);
    advanceTo(10);
    await cache.request("u", load);

    expect(load).toHaveBeenCalledTimes(2);
    expect(cache.size()).toBe(1);
  });

  it("never expires an entry that is still in flight", async () => {
    const { cache, advanceTo } = setup(10);
    let release: (value: string) => void = () => {};
    const load = vi.fn(() => new Promise<string>((resolve) => (release = resolve)));

    const first = cache.request("u", load);
    advanceTo(1_000_000);
    const second = cache.request("u", load);
    release("a");

    expect(await first).toBe("a");
    expect(await second).toBe("a");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("forgets an entry whose load rejects, and passes the error to its callers", async () => {
    const { cache } = setup(null);
    const load = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error("boom"));

    await expect(cache.request("u", load)).rejects.toThrow("boom");
    expect(cache.size()).toBe(0);

    load.mockResolvedValueOnce("a");
    expect(await cache.request("u", load)).toBe("a");
  });

  it("rejects an aborting caller with the signal's reason, and not the others", async () => {
    const { cache } = setup(null);
    let release: (value: string) => void = () => {};
    const load = () => new Promise<string>((resolve) => (release = resolve));
    const controller = new AbortController();
    const reason = new Error("navigated away");

    const a = cache.request("u", load, controller.signal);
    const b = cache.request("u", load);
    controller.abort(reason);
    release("a");

    await expect(a).rejects.toBe(reason);
    expect(await b).toBe("a");
  });
});
