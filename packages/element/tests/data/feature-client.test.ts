import { featureKeySchema } from "@bcd-embed/schema";
import { describe, expect, it, vi } from "vitest";

import { v1NormalizedFixture } from "../../../schema/src/fixtures/v1.js";
import {
  buildFeatureUrl,
  createFeatureClient,
  DEFAULT_ENDPOINT,
  FAILURE_WINDOW_MS,
  FEATURE_KEY_PATTERN,
} from "../../src/data/feature-client.js";

const DISPLAY_URL =
  "https://api.browser-compat.dev/v1/current/features/css.properties.display.json";

const okResponse = (): Response =>
  new Response(JSON.stringify(v1NormalizedFixture), {
    status: 200,
    headers: { "content-type": "application/json", "bcd-embed-snapshot": "bcd-8.1.8-gen-0.0.0" },
  });

const errorResponse = (status: number, error: Record<string, unknown>): Response =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });

type FakeFetch = ReturnType<typeof vi.fn<typeof fetch>>;

const setup = (respond: () => Response | Promise<Response>, startAt = 0) => {
  let time = startAt;
  const fakeFetch: FakeFetch = vi.fn<typeof fetch>(async () => respond());
  const client = createFeatureClient({ fetch: fakeFetch, now: () => time });
  return {
    client,
    fakeFetch,
    advanceTo: (next: number) => {
      time = next;
    },
  };
};

describe("the request URL", () => {
  it("is exact for the default endpoint", () => {
    expect(buildFeatureUrl("css.properties.display")).toBe(DISPLAY_URL);
    expect(DEFAULT_ENDPOINT).toBe("https://api.browser-compat.dev");
  });

  it("has no double slash when the endpoint ends in slashes", () => {
    expect(buildFeatureUrl("css.properties.display", "https://api.example.test/")).toBe(
      "https://api.example.test/v1/current/features/css.properties.display.json",
    );
    expect(buildFeatureUrl("css.properties.display", "https://api.example.test///")).toBe(
      "https://api.example.test/v1/current/features/css.properties.display.json",
    );
  });

  it("accepts and rejects the same keys as the schema package's key schema", () => {
    const keys = [
      "css.properties.display",
      "api.Foo$bar",
      "javascript.builtins.Array",
      "a@b-c_d",
      "../meta",
      "a b",
      "",
      ".hidden",
      "-lead",
      "a/b",
      "a?b",
      "a\nb",
    ];

    for (const key of keys) {
      expect(FEATURE_KEY_PATTERN.test(key), JSON.stringify(key)).toBe(
        featureKeySchema.safeParse(key).success,
      );
    }
  });
});

describe("a query that fails the key pattern", () => {
  for (const query of ["../meta", "a b", "", ".hidden", "a/b", "a?b=c"]) {
    it(`sends no request for ${JSON.stringify(query)}`, async () => {
      const { client, fakeFetch } = setup(okResponse);

      const result = await client.requestFeature({ query });

      expect(result).toEqual({ ok: false, reason: "invalid-query", status: null, code: null });
      expect(fakeFetch).not.toHaveBeenCalled();
    });
  }
});

describe("sharing", () => {
  it("sends one request for 50 calls before the first settles, and all get the same result", async () => {
    const { client, fakeFetch } = setup(okResponse);

    const results = await Promise.all(
      Array.from({ length: 50 }, () => client.requestFeature({ query: "css.properties.display" })),
    );

    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toMatchObject({ ok: true });
  });

  it("sends two requests for two endpoints with the same key", async () => {
    const { client, fakeFetch } = setup(okResponse);

    await Promise.all([
      client.requestFeature({ query: "css.properties.display" }),
      client.requestFeature({ query: "css.properties.display", endpoint: "https://other.test" }),
    ]);

    expect(fakeFetch).toHaveBeenCalledTimes(2);
    expect(client.cacheSize()).toBe(2);
  });

  it("keeps a success for later calls", async () => {
    const { client, fakeFetch, advanceTo } = setup(okResponse);

    await client.requestFeature({ query: "css.properties.display" });
    advanceTo(10 * 60 * 60 * 1000);
    await client.requestFeature({ query: "css.properties.display" });

    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });
});

describe("classification", () => {
  it("returns the payload and the snapshot header for a 200 with JSON", async () => {
    const { client } = setup(okResponse);

    const result = await client.requestFeature({ query: "css.properties.display" });

    expect(result).toEqual({
      ok: true,
      payload: v1NormalizedFixture,
      snapshot: "bcd-8.1.8-gen-0.0.0",
    });
  });

  it("returns a null snapshot when the header is missing", async () => {
    const { client } = setup(
      () => new Response(JSON.stringify(v1NormalizedFixture), { status: 200 }),
    );

    const result = await client.requestFeature({ query: "css.properties.display" });

    expect(result).toMatchObject({ ok: true, snapshot: null });
  });

  it("reports a 404 with a contract code, and sends nothing on a second call", async () => {
    const { client, fakeFetch, advanceTo } = setup(() =>
      errorResponse(404, { code: "feature_not_found", message: "No data.", query: "css.x" }),
    );

    const first = await client.requestFeature({ query: "css.x" });
    advanceTo(24 * 60 * 60 * 1000);
    const second = await client.requestFeature({ query: "css.x" });

    expect(first).toEqual({ ok: false, reason: "http", status: 404, code: "feature_not_found" });
    expect(second).toBe(first);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it("reports code null for a 404 body without a code", async () => {
    const { client } = setup(() => errorResponse(404, { message: "Route not found" }));

    const result = await client.requestFeature({ query: "css.x" });

    expect(result).toEqual({ ok: false, reason: "http", status: 404, code: null });
  });

  it("reports code null for an error body that is not JSON", async () => {
    const { client } = setup(() => new Response("<html>Access denied</html>", { status: 403 }));

    const result = await client.requestFeature({ query: "css.x" });

    expect(result).toEqual({ ok: false, reason: "http", status: 403, code: null });
  });

  it("reports invalid-payload for a 200 whose body is not JSON", async () => {
    const { client } = setup(() => new Response("<html></html>", { status: 200 }));

    const result = await client.requestFeature({ query: "css.x" });

    expect(result).toEqual({ ok: false, reason: "invalid-payload", status: null, code: null });
  });

  for (const [name, body] of [
    ["an array", []],
    ["null", null],
    ["a feature response without features", { ...v1NormalizedFixture, features: undefined }],
    ["a feature response without a contract", { ...v1NormalizedFixture, contract: undefined }],
  ] as const) {
    it(`reports invalid-payload for a 200 whose JSON is ${name}`, async () => {
      const { client } = setup(() => new Response(JSON.stringify(body), { status: 200 }));

      const result = await client.requestFeature({ query: "css.x" });

      expect(result).toMatchObject({ ok: false, reason: "invalid-payload" });
    });
  }

  it("reports network with status null when fetch rejects", async () => {
    const { client } = setup(() => {
      throw new TypeError("Failed to fetch");
    });

    const result = await client.requestFeature({ query: "css.x" });

    expect(result).toEqual({ ok: false, reason: "network", status: null, code: null });
  });

  it("reports network when the body stream fails partway", async () => {
    const { client } = setup(
      () =>
        new Response(
          new ReadableStream({
            start: (controller) => controller.error(new TypeError("connection dropped")),
          }),
          { status: 200 },
        ),
    );

    const result = await client.requestFeature({ query: "css.x" });

    expect(result).toMatchObject({ ok: false, reason: "network" });
  });
});

describe("failure caching", () => {
  it("names a window of 10 seconds", () => {
    expect(FAILURE_WINDOW_MS).toBe(10_000);
  });

  it("holds a network failure for 10 seconds, with no request at 9 seconds and one at 11", async () => {
    const { client, fakeFetch, advanceTo } = setup(() => {
      throw new TypeError("Failed to fetch");
    });

    await client.requestFeature({ query: "css.x" });
    advanceTo(9_000);
    await client.requestFeature({ query: "css.x" });
    expect(fakeFetch).toHaveBeenCalledTimes(1);

    advanceTo(11_000);
    await client.requestFeature({ query: "css.x" });
    expect(fakeFetch).toHaveBeenCalledTimes(2);
    expect(client.cacheSize()).toBe(1);
  });

  it("measures the window from when the request settled, not when it started", async () => {
    let release: (response: Response) => void = () => {};
    let calls = 0;
    const { client, fakeFetch, advanceTo } = setup(() => {
      calls += 1;
      return calls === 1
        ? new Promise<Response>((resolve) => (release = resolve))
        : new Response("", { status: 503 });
    });

    const pending = client.requestFeature({ query: "css.x" });
    advanceTo(30_000);
    release(new Response("", { status: 503 }));
    await pending;

    advanceTo(39_000);
    await client.requestFeature({ query: "css.x" });
    expect(fakeFetch).toHaveBeenCalledTimes(1);

    advanceTo(40_001);
    await client.requestFeature({ query: "css.x" });
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  for (const [name, status, body] of [
    ["a 429 from the API's own handler", 429, { code: "rate_limited", message: "Slow down." }],
    ["a 429 from the edge", 429, undefined],
    ["a 503 with a contract code", 503, { code: "generation_in_progress", message: "Wait." }],
    ["a 500", 500, undefined],
    ["a 400 from Cloudflare with no contract code", 400, undefined],
  ] as const) {
    it(`holds ${name} for 10 seconds only`, async () => {
      const { client, fakeFetch, advanceTo } = setup(() =>
        body === undefined
          ? new Response("<html></html>", { status })
          : errorResponse(status, body),
      );

      await client.requestFeature({ query: "css.x" });
      advanceTo(9_999);
      await client.requestFeature({ query: "css.x" });
      expect(fakeFetch).toHaveBeenCalledTimes(1);

      advanceTo(10_000);
      await client.requestFeature({ query: "css.x" });
      expect(fakeFetch).toHaveBeenCalledTimes(2);
    });
  }

  it("holds an invalid payload for 10 seconds only", async () => {
    const { client, fakeFetch, advanceTo } = setup(() => new Response("nope", { status: 200 }));

    await client.requestFeature({ query: "css.x" });
    advanceTo(10_000);
    await client.requestFeature({ query: "css.x" });

    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it("sends one request when 50 callers wait on a failure, and none until the window ends", async () => {
    const { client, fakeFetch } = setup(() => {
      throw new TypeError("Failed to fetch");
    });

    await Promise.all(Array.from({ length: 50 }, () => client.requestFeature({ query: "css.x" })));

    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });
});

describe("cancellation", () => {
  it("lets a caller abort without cancelling the shared request or the other callers", async () => {
    let release: (response: Response) => void = () => {};
    const { client, fakeFetch } = setup(
      () => new Promise<Response>((resolve) => (release = resolve)),
    );
    const controller = new AbortController();

    const a = client.requestFeature({ query: "css.x", signal: controller.signal });
    const b = client.requestFeature({ query: "css.x" });
    const c = client.requestFeature({ query: "css.x" });
    controller.abort();

    await expect(a).rejects.toMatchObject({ name: "AbortError" });
    release(okResponse());
    const [resultB, resultC] = await Promise.all([b, c]);

    expect(resultB).toMatchObject({ ok: true });
    expect(resultC).toBe(resultB);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(await client.requestFeature({ query: "css.x" })).toBe(resultB);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it("never gives the shared request a signal", async () => {
    const { client, fakeFetch } = setup(okResponse);

    await client.requestFeature({ query: "css.x", signal: new AbortController().signal });

    expect(fakeFetch.mock.calls[0]?.[1]).not.toHaveProperty("signal");
  });

  it("sends no request for a caller that is already aborted", async () => {
    const { client, fakeFetch } = setup(okResponse);
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.requestFeature({ query: "css.x", signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("resolves a caller whose signal never aborts, and removes its listener", async () => {
    const { client } = setup(okResponse);
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");

    const result = await client.requestFeature({ query: "css.x", signal: controller.signal });

    expect(result).toMatchObject({ ok: true });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});

describe("what the request sends", () => {
  it("sends one GET to the exact URL with no credentials, headers, body, or query string", async () => {
    const { client, fakeFetch } = setup(okResponse);

    await client.requestFeature({ query: "css.properties.display" });

    const [url, init] = fakeFetch.mock.calls[0] ?? [];
    expect(url).toBe(DISPLAY_URL);
    expect(String(url)).not.toContain("?");
    expect(init).toEqual({ credentials: "omit" });
    expect(init).not.toHaveProperty("headers");
    expect(init).not.toHaveProperty("body");
    expect(init?.method).toBeUndefined();
  });
});
