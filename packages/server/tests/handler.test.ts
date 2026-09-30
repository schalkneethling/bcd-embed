import { describe, expect, it, vi } from "vitest";
import { apiErrorResponseSchema, type MetaResponse } from "@bcd-embed/schema";
import {
  createArtifactHandler,
  MAX_METADATA_BYTES,
  MAX_INDEX_SHARD_BYTES,
  type Artifact,
  type ArtifactStore,
} from "../src/index.js";

const snapshot = "bcd-8.1.3-gen-0.0.0";
const older = "bcd-8.0.13-gen-0.0.0";
const envelope = {
  contract: "1.0.0",
  generated: "2026-09-30T10:00:00Z",
  source: { package: "@mdn/browser-compat-data", version: "8.1.3" },
};
const metadata: MetaResponse = {
  contract: "1.0.0",
  generated: envelope.generated,
  current: snapshot,
  snapshots: [snapshot, older].map((id) => ({
    id,
    source: { package: "@mdn/browser-compat-data", version: id === snapshot ? "8.1.3" : "8.0.13" },
    generatorVersion: "0.0.0",
    generated: envelope.generated,
    expires: "2026-09-01",
  })),
  namespaces: ["css"],
};

function object(body: string, etag = '"artifact"'): Artifact {
  return { body: new Response(body).body!, etag, size: new TextEncoder().encode(body).length };
}

function setup(extra: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = {
    "v1/meta.json": metadata,
    [`v1/${snapshot}/index/css.json`]: {
      ...envelope,
      namespace: "css",
      keys: ["css.properties.display", "css.properties.display.block"],
    },
    [`v1/${older}/index/legacy.json`]: {
      ...envelope,
      source: { ...envelope.source, version: "8.0.13" },
      namespace: "legacy",
      keys: ["legacy.group.feature"],
    },
    ...extra,
  };
  const get = vi.fn(async (path: string) =>
    data[path] === undefined ? null : object(JSON.stringify(data[path])),
  );
  const store: ArtifactStore = { get };
  const handler = createArtifactHandler({ store });
  return { get, handler };
}

const request = (path: string, init?: RequestInit) =>
  new Request(`https://example.test${path}`, init);

describe("artifact routing", () => {
  it.each([
    "browsers.json",
    "index.json",
    "index/css.json",
    "features/css.properties.display.json",
    "raw/css.properties.display.json",
  ])("streams %s from current's immutable path", async (suffix) => {
    const path = `v1/${snapshot}/${suffix}`;
    const { get, handler } = setup({ [path]: { untouched: true } });
    const result = await handler(request(`/v1/current/${suffix}`));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ untouched: true });
    expect(get.mock.calls.map(([key]) => key)).toEqual(["v1/meta.json", path]);
    expect(result.headers.get("cache-control")).toBe(
      "max-age=86400, stale-while-revalidate=604800",
    );
  });

  it("serves metadata without parsing or rewriting its bytes", async () => {
    const get = vi.fn(async () => object("  {}\n"));
    const result = await createArtifactHandler({ store: { get } })(request("/v1/meta.json"));
    expect(await result.text()).toBe("  {}\n");
    expect(get).toHaveBeenCalledExactlyOnceWith("v1/meta.json");
  });

  it("keeps listed snapshots available regardless of retention date", async () => {
    const { handler } = setup({ [`v1/${older}/browsers.json`]: { old: true } });
    const result = await handler(request(`/v1/${older}/browsers.json`));
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("max-age=31536000, immutable");
  });

  it.each(["bcd-99.0.0-gen-0.0.0", "bcd-1.0.0-gen-0.0.0"])(
    "distinguishes nonexistent/retired snapshot %s",
    async (id) => {
      const { handler, get } = setup();
      const result = await handler(request(`/v1/${id}/features/css.properties.display.json`));
      expect(result.status).toBe(404);
      expect(apiErrorResponseSchema.parse(await result.json()).error.code).toBe(
        "snapshot_not_found",
      );
      expect(get).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["css", "css.properties"])(
    "classifies grouping %s with the selected shard",
    async (key) => {
      const { handler } = setup();
      const result = await handler(request(`/v1/current/features/${key}.json`));
      expect(apiErrorResponseSchema.parse(await result.json()).error).toEqual({
        code: "namespace_not_queryable",
        message: `Key '${key}' is an organizational namespace, not a queryable feature.`,
        query: key,
      });
    },
  );

  it("uses old snapshot shards even when current has no matching namespace", async () => {
    const { handler } = setup();
    const result = await handler(request(`/v1/${older}/raw/legacy.group.json`));
    expect(apiErrorResponseSchema.parse(await result.json()).error.code).toBe(
      "namespace_not_queryable",
    );
  });

  it.each(["css.properties.dispaly", "css.properties.displa", "absent.feature"])(
    "classifies missing %s without fuzzy/prefix guesses",
    async (key) => {
      const { handler } = setup();
      const result = await handler(request(`/v1/current/features/${key}.json`));
      expect(apiErrorResponseSchema.parse(await result.json()).error.code).toBe(
        "feature_not_found",
      );
    },
  );

  it("treats missing artifact named in index as corruption, not absent data", async () => {
    const { handler } = setup();
    const result = await handler(request("/v1/current/features/css.properties.display.json"));
    expect(result.status).toBe(500);
    expect(await result.json()).toEqual({ error: { message: "Artifact service unavailable." } });
  });

  it.each(["features/css.unknown.json", "index/css.json"])(
    "treats missing current advertised shard as corruption for %s",
    async (suffix) => {
      const get = vi.fn(async (path: string) =>
        path === "v1/meta.json" ? object(JSON.stringify(metadata)) : null,
      );
      expect(
        (await createArtifactHandler({ store: { get } })(request(`/v1/current/${suffix}`))).status,
      ).toBe(500);
    },
  );

  it.each([
    { ...envelope, namespace: "api", keys: ["css.properties.display"] },
    {
      ...envelope,
      source: { ...envelope.source, version: "9.0.0" },
      namespace: "css",
      keys: ["css.properties.display"],
    },
    { ...envelope, namespace: "css", keys: [] },
  ])("does not classify misses using corrupt shards", async (shard) => {
    const { handler } = setup({ [`v1/${snapshot}/index/css.json`]: shard });
    expect((await handler(request("/v1/current/features/css.unknown.json"))).status).toBe(500);
  });

  it("rejects schema-invalid metadata before requesting a snapshot artifact", async () => {
    const { handler, get } = setup({
      "v1/meta.json": { ...metadata, current: "bcd-9.0.0-gen-0.0.0" },
    });
    expect((await handler(request("/v1/current/browsers.json"))).status).toBe(500);
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe("public input safety", () => {
  it.each([
    "css..display",
    "css.",
    "css.%2fdisplay",
    "css.%5cdisplay",
    "css.%252e%252e",
    "css.%00",
    "css.%",
    "css.%GG",
    "css.é",
    "css.<script>",
    "css?bad",
    "a".repeat(513),
  ])("rejects %s before storage", async (key) => {
    const { handler, get } = setup();
    const result = await handler(request(`/v1/current/features/${key}.json`));
    expect(result.status).toBe(400);
    expect(apiErrorResponseSchema.parse(await result.json()).error.code).toBe("invalid_key");
    expect(get).not.toHaveBeenCalled();
  });

  it.each([
    "webextensions.api.devtools.inspectedWindow.eval.$0",
    "javascript.builtins.Array.@@iterator",
    "javascript.builtins.Array.%40%40iterator",
    "http.headers.Content-Type",
  ])("accepts published character vocabulary %s", async (key) => {
    const decoded = decodeURIComponent(key);
    const { handler, get } = setup({ [`v1/${snapshot}/features/${decoded}.json`]: { good: true } });
    expect((await handler(request(`/v1/current/features/${key}.json`))).status).toBe(200);
    expect(get).toHaveBeenLastCalledWith(`v1/${snapshot}/features/${decoded}.json`);
  });

  it("fuzzes forbidden ASCII without allowing storage access", async () => {
    for (let char = 0; char < 128; char += 1) {
      const value = String.fromCharCode(char);
      if (/[A-Za-z0-9._$@-]/.test(value)) continue;
      const { handler, get } = setup();
      const encoded = `%${char.toString(16).padStart(2, "0")}`;
      await handler(request(`/v1/current/features/css.a${encoded}b.json`));
      expect(get).not.toHaveBeenCalled();
    }
  });
});

describe("HTTP transport", () => {
  it.each(['"artifact"', 'W/"artifact"', '"other", W/"artifact"', "*", '"comma,tag", "artifact"'])(
    "conditionally matches %s",
    async (tag) => {
      const { handler } = setup({ [`v1/${snapshot}/browsers.json`]: {} });
      const result = await handler(
        request("/v1/current/browsers.json", { headers: { "if-none-match": tag } }),
      );
      expect(result.status).toBe(304);
      expect(await result.text()).toBe("");
      expect(result.headers.get("etag")).toBe('"artifact"');
    },
  );

  it.each(['"other"', "artifact", 'W/"artifact", broken', '*, "artifact"'])(
    "ignores nonmatching/malformed conditional %s",
    async (tag) => {
      const { handler } = setup({ [`v1/${snapshot}/browsers.json`]: {} });
      expect(
        (await handler(request("/v1/current/browsers.json", { headers: { "if-none-match": tag } })))
          .status,
      ).toBe(200);
    },
  );

  it("HEAD keeps GET headers/status, cancels stream, and never consumes it", async () => {
    const cancel = vi.fn();
    const get = vi.fn(async () => ({
      body: new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 }),
      etag: '"abc"',
      size: 123,
    }));
    const result = await createArtifactHandler({ store: { get } })(
      request("/v1/meta.json", { method: "HEAD" }),
    );
    expect(result.status).toBe(200);
    expect(result.headers.get("content-length")).toBe("123");
    expect(await result.text()).toBe("");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("returns a successful stream without reading or buffering its body", async () => {
    const pull = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ pull }, { highWaterMark: 0 });
    const handler = createArtifactHandler({
      store: { get: async () => ({ body: stream, etag: '"stream"', size: 4_000_000 }) },
    });
    const response = await handler(request("/v1/meta.json"));
    expect(response.status).toBe(200);
    expect(pull).not.toHaveBeenCalled();
    await response.body!.cancel();
  });

  it("cancels conditional response streams without reading", async () => {
    const cancel = vi.fn();
    const pull = vi.fn();
    const handler = createArtifactHandler({
      store: {
        get: async () => ({
          body: new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 }),
          etag: '"stream"',
        }),
      },
    });
    const response = await handler(
      request("/v1/meta.json", { headers: { "if-none-match": 'W/"stream"' } }),
    );
    expect(response.status).toBe(304);
    expect(cancel).toHaveBeenCalledOnce();
    expect(pull).not.toHaveBeenCalled();
  });

  it.each(['W/"weak"', '"invalid\n"', "unquoted"])(
    "rejects invalid artifact ETag %s and cancels its stream",
    async (etag) => {
      const cancel = vi.fn();
      const handler = createArtifactHandler({
        store: {
          get: async () => ({
            body: new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 }),
            etag,
          }),
        },
      });
      expect((await handler(request("/v1/meta.json"))).status).toBe(500);
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it("adds JSON, CORS and exposed validator headers to errors", async () => {
    const { handler } = setup();
    const response = await handler(request("/v1/current/features/css..bad.json"));
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-expose-headers")).toBe("etag, retry-after");
    expect(response.headers.get("etag")).toMatch(/^"[a-f0-9]{64}"$/);
    expect(response.headers.get("cache-control")).toBe("max-age=3600");
  });

  it("OPTIONS is bodyless and read-free; POST is 405 and read-free", async () => {
    const { handler, get } = setup();
    const preflight = await handler(request("/v1/current/browsers.json", { method: "OPTIONS" }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toBe("GET, HEAD, OPTIONS");
    const post = await handler(request("/v1/current/browsers.json", { method: "POST" }));
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
    expect(get).not.toHaveBeenCalled();
  });

  it.each(["rate_limited", "generation_in_progress"] as const)(
    "supports explicit %s adapter hook",
    async (code) => {
      const get = vi.fn(async () => null);
      const handler = createArtifactHandler({
        store: { get },
        beforeRead: () => (code === "rate_limited" ? { code, retryAfter: 60 } : { code }),
      });
      const response = await handler(request("/v1/current/browsers.json"));
      expect(response.status).toBe(code === "rate_limited" ? 429 : 503);
      expect(apiErrorResponseSchema.parse(await response.json()).error.code).toBe(code);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("retry-after")).toBe(code === "rate_limited" ? "60" : null);
      expect(get).not.toHaveBeenCalled();
    },
  );

  it("does not disguise backend failure as a generation hook", async () => {
    const onError = vi.fn();
    const handler = createArtifactHandler({
      store: {
        get: async () => {
          throw new Error("private backend details");
        },
      },
      onError,
    });
    const response = await handler(request("/v1/meta.json"));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private backend");
    expect(onError).toHaveBeenCalledOnce();
  });

  it("isolates a failed error reporter", async () => {
    const handler = createArtifactHandler({
      store: {
        get: async () => {
          throw new Error("backend");
        },
      },
      onError: () => {
        throw new Error("reporter");
      },
    });
    expect((await handler(request("/v1/meta.json"))).status).toBe(500);
  });

  it("bounds unknown-size metadata while streaming and cancels overflow", async () => {
    const cancel = vi.fn();
    const handler = createArtifactHandler({
      store: {
        get: async () => ({
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(1024 * 1024 + 1));
            },
            cancel,
          }),
          etag: '"meta"',
        }),
      },
    });
    expect((await handler(request("/v1/current/browsers.json"))).status).toBe(500);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(["metadata", "shard"])("rejects known oversized %s before reading", async (kind) => {
    const cancel = vi.fn();
    const pull = vi.fn();
    const oversized = {
      body: new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 }),
      etag: '"oversized"',
      size: (kind === "metadata" ? MAX_METADATA_BYTES : MAX_INDEX_SHARD_BYTES) + 1,
    };
    const get = vi.fn(async (path: string) => {
      if (path === "v1/meta.json")
        return kind === "metadata" ? oversized : object(JSON.stringify(metadata));
      return path.endsWith("index/css.json") ? oversized : null;
    });
    const response = await createArtifactHandler({ store: { get } })(
      request("/v1/current/features/css.unknown.json"),
    );
    expect(response.status).toBe(500);
    expect(cancel).toHaveBeenCalledOnce();
    expect(pull).not.toHaveBeenCalled();
  });

  it("bounds unknown-size index shards while streaming", async () => {
    const cancel = vi.fn();
    const get = vi.fn(async (path: string) => {
      if (path === "v1/meta.json") return object(JSON.stringify(metadata));
      if (!path.endsWith("index/css.json")) return null;
      return {
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(MAX_INDEX_SHARD_BYTES + 1));
          },
          cancel,
        }),
        etag: '"shard"',
      };
    });
    expect(
      (
        await createArtifactHandler({ store: { get } })(
          request("/v1/current/features/css.unknown.json"),
        )
      ).status,
    ).toBe(500);
    expect(cancel).toHaveBeenCalledOnce();
  });
});
