import { describe, expect, it, vi } from "vitest";
import { brotliCompressSync, brotliDecompressSync, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import {
  apiErrorResponseSchema,
  CONTRACT_VERSION,
  MAX_ROOT_BYTES,
  MAX_SHARD_BYTES,
  RELEASE_HEADERS,
  snapshotRootPath,
  type MetaResponse,
  type StoredMetaResponse,
} from "@bcd-embed/schema";
import {
  createArtifactHandler,
  MAX_METADATA_BYTES,
  MAX_INDEX_SHARD_BYTES,
  createTreeCache,
  type Artifact,
  type ArtifactStore,
} from "../src/index.js";
import { contentStore } from "./support/content-store.js";

const snapshot = "bcd-8.1.3-gen-0.0.0";
const older = "bcd-8.0.13-gen-0.0.0";
const envelope = { contract: CONTRACT_VERSION };
// The older snapshot was published before contract 1.1.0, so its files carry 1.0.0.
const olderEnvelope = { contract: "1.0.0" };
const generated = "2026-09-30T10:00:00Z";
const metadata: MetaResponse = {
  contract: CONTRACT_VERSION,
  generated,
  current: snapshot,
  snapshots: [snapshot, older].map((id) => ({
    id,
    source: { package: "@mdn/browser-compat-data", version: id === snapshot ? "8.1.3" : "8.0.13" },
    generatorVersion: "0.0.0",
    generated,
    expires: "2026-09-01",
  })),
  namespaces: ["css"],
};

function object(body: string, etag = '"artifact"'): Artifact {
  return { body: new Response(body).body!, etag, size: new TextEncoder().encode(body).length };
}

function setup(extra: Record<string, unknown> = {}) {
  const store = contentStore({
    "v1/meta.json": metadata,
    [`v1/${snapshot}/index/css.json`]: {
      ...envelope,
      namespace: "css",
      keys: ["css.properties.display", "css.properties.display.block"],
    },
    [`v1/${older}/index/legacy.json`]: {
      ...olderEnvelope,
      namespace: "legacy",
      keys: ["legacy.group.feature"],
    },
    ...extra,
  });
  const get = vi.fn(async (path: string) => {
    const body = store.files.get(path);
    return body === undefined ? null : object(body);
  });
  const handler = createArtifactHandler({ store: { get } satisfies ArtifactStore });
  return { get, handler, store };
}

const request = (path: string, init?: RequestInit) =>
  new Request(`https://example.test${path}`, init);

describe("encoded representations", () => {
  const encodeJson = (bytes: Uint8Array, coding: "br" | "gzip") =>
    coding === "br" ? brotliCompressSync(bytes) : gzipSync(bytes);
  it("keeps bodyless OPTIONS independent of unacceptable encodings", async () => {
    const { handler, get } = setup();
    const result = await handler(
      request("/v1/meta.json", { method: "OPTIONS", headers: { "accept-encoding": "*;q=0" } }),
    );
    expect(result.status).toBe(204);
    expect(await result.text()).toBe("");
    expect(get).not.toHaveBeenCalled();
  });
  it("preserves portable errors as identity when no encoder exists and identity is allowed", async () => {
    const { handler, get } = setup();
    const result = await handler(
      request("/v1/current/features/api%2fsecret.json", {
        headers: { "accept-encoding": "br, gzip" },
      }),
    );
    expect(result.status).toBe(400);
    expect(result.headers.get("content-encoding")).toBeNull();
    expect((await result.json()).error.code).toBe("invalid_key");
    expect(get).not.toHaveBeenCalled();
  });
  it("returns bodyless 406 for an encoder-less error when identity is excluded", async () => {
    const { handler, get } = setup();
    const result = await handler(
      request("/v1/current/features/api%2fsecret.json", {
        headers: { "accept-encoding": "br, identity;q=0" },
      }),
    );
    expect(result.status).toBe(406);
    expect(await result.text()).toBe("");
    expect(get).not.toHaveBeenCalled();
  });
  it("reports encoder rejection and respects excluded identity in the safe failure", async () => {
    const { get } = setup();
    const onError = vi.fn();
    const failure = new Error("secret");
    const handler = createArtifactHandler({
      store: { get },
      encodeJson: async () => {
        throw failure;
      },
      onError,
    });
    const result = await handler(
      request("/v1/current/features/api%2fsecret.json", {
        headers: { "accept-encoding": "br, identity;q=0" },
      }),
    );
    expect(result.status).toBe(500);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.text()).toBe("");
    expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(get).not.toHaveBeenCalled();
  });
  it.each(["br", "gzip"])(
    "selects immutable %s paths before matching representation validators",
    async (encoding) => {
      const suffix = "features/css.properties.display.json";
      const { get, store } = setup({ [`v1/${snapshot}/${suffix}`]: { encoded: true } });
      const handler = createArtifactHandler({ store: { get }, encodeJson });
      const result = await handler(
        request("/v1/current/features/css.properties.display.json", {
          headers: { "accept-encoding": encoding, "if-none-match": 'W/"artifact"' },
        }),
      );
      expect(result.status).toBe(304);
      expect(result.headers.get("content-encoding")).toBe(encoding);
      expect(result.headers.get("vary")).toBe("Accept-Encoding");
      expect(get.mock.calls.map(([key]) => key)).toEqual([
        "v1/meta.json",
        ...store.reads(snapshot, suffix, encoding === "br" ? "br" : "gzip"),
      ]);
    },
  );
  it("addresses compressed metadata from the exact bounded identity bytes", async () => {
    const bytes = JSON.stringify(metadata);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const get = vi.fn(async (path: string) =>
      path === "v1/meta.json"
        ? object(bytes)
        : path === `v1/_meta/${hash}.json.br`
          ? object("encoded", '"encoded"')
          : null,
    );
    const result = await createArtifactHandler({ store: { get }, encodeJson })(
      request("/v1/meta.json", { headers: { "accept-encoding": "br" } }),
    );
    expect(await result.text()).toBe("encoded");
    expect(result.headers.get("etag")).toBe('"encoded"');
  });
  it("treats missing required compression as corruption, not feature absence", async () => {
    const suffix = "features/css.properties.display.json";
    const { get, store } = setup({ [`v1/${snapshot}/${suffix}`]: {} });
    store.files.delete(store.reads(snapshot, suffix, "br").at(-1)!);
    const result = await createArtifactHandler({ store: { get }, encodeJson })(
      request("/v1/current/features/css.properties.display.json", {
        headers: { "accept-encoding": "br" },
      }),
    );
    expect(result.status).toBe(500);
    expect(result.headers.get("content-encoding")).toBe("br");
    expect(
      JSON.parse(brotliDecompressSync(Buffer.from(await result.arrayBuffer())).toString()),
    ).toEqual({ error: { message: "Artifact service unavailable." } });
  });
  it("rejects unacceptable encodings without hooks or storage I/O", async () => {
    const get = vi.fn();
    const beforeRead = vi.fn();
    const result = await createArtifactHandler({ store: { get }, beforeRead })(
      request("/v1/meta.json", { headers: { "accept-encoding": "*;q=0" } }),
    );
    expect(result.status).toBe(406);
    expect(await result.text()).toBe("");
    expect(get).not.toHaveBeenCalled();
    expect(beforeRead).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    "isolates %s async encoder failures even for early invalid routes",
    async (asyncFailure) => {
      const get = vi.fn();
      const encode = () => {
        if (asyncFailure) return Promise.reject(new Error("secret"));
        throw new Error("secret");
      };
      const result = await createArtifactHandler({ store: { get }, encodeJson: encode })(
        request("/v1/current/features/api%2fsecret.json", { headers: { "accept-encoding": "br" } }),
      );
      expect(result.status).toBe(500);
      expect(await result.json()).toEqual({ error: { message: "Artifact service unavailable." } });
      expect(get).not.toHaveBeenCalled();
    },
  );
});

describe("artifact routing", () => {
  it.each([
    "browsers.json",
    "index.json",
    "index/css.json",
    "features/css.properties.display.json",
    "raw/css.properties.display.json",
  ])("streams %s from current's immutable path", async (suffix) => {
    const { get, handler, store } = setup({ [`v1/${snapshot}/${suffix}`]: { untouched: true } });
    const result = await handler(request(`/v1/current/${suffix}`));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ untouched: true });
    expect(get.mock.calls.map(([key]) => key)).toEqual([
      "v1/meta.json",
      ...store.reads(snapshot, suffix),
    ]);
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
    const suffix = `features/${decoded}.json`;
    const { handler, get, store } = setup({ [`v1/${snapshot}/${suffix}`]: { good: true } });
    expect((await handler(request(`/v1/current/features/${key}.json`))).status).toBe(200);
    expect(get).toHaveBeenLastCalledWith(store.reads(snapshot, suffix).at(-1));
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
    expect(response.headers.get("access-control-expose-headers")).toBe(
      "etag, retry-after, bcd-embed-snapshot, bcd-embed-generated, bcd-embed-source-version",
    );
    expect(response.headers.get("etag")).toMatch(/^"[a-f0-9]{64}"$/);
    expect(response.headers.get("cache-control")).toBe("max-age=3600");
  });

  it.each([
    ["current", snapshot, "8.1.3"],
    [older, older, "8.0.13"],
  ])("names the release of a /v1/%s response in headers", async (selector, id, version) => {
    const path = `/v1/${selector}/browsers.json`;
    const { handler } = setup({
      [`v1/${id}/browsers.json`]: { ...envelope, browsers: {} },
    });
    const expected = {
      "bcd-embed-snapshot": id,
      "bcd-embed-generated": generated,
      "bcd-embed-source-version": version,
    };
    const responses = [
      await handler(request(path)),
      await handler(request(path, { method: "HEAD" })),
      // A revalidation needs them too: a 304 has no body to fall back on.
      await handler(request(path, { headers: { "if-none-match": '"artifact"' } })),
    ];
    expect(responses.map(({ status }) => status)).toEqual([200, 200, 304]);
    for (const response of responses) {
      for (const [name, value] of Object.entries(expected)) {
        expect(response.headers.get(name)).toBe(value);
      }
    }
  });

  it("leaves the release headers off metadata and errors, which belong to no one snapshot", async () => {
    const { handler } = setup();
    for (const path of ["/v1/meta.json", "/v1/current/features/css.unknown.json"]) {
      const response = await handler(request(path));
      for (const name of Object.values(RELEASE_HEADERS)) {
        expect(response.headers.get(name)).toBeNull();
      }
    }
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

  it("isolates a rejecting asynchronous reporter", async () => {
    const onError = vi.fn(async () => {
      throw new Error("asynchronous reporter failure");
    });
    const handler = createArtifactHandler({
      store: {
        get: async () => {
          throw new Error("backend");
        },
      },
      onError,
    });
    expect((await handler(request("/v1/meta.json"))).status).toBe(500);
    expect(onError).toHaveBeenCalledOnce();
    // Give the runtime an event-loop turn to detect any unhandled rejection.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });

  it("does not await a pending asynchronous reporter", async () => {
    const handler = createArtifactHandler({
      store: {
        get: async () => {
          throw new Error("backend");
        },
      },
      onError: () => new Promise<void>(() => {}),
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

  it.each([
    ["metadata", MAX_METADATA_BYTES],
    ["root", MAX_ROOT_BYTES],
    ["pointer shard", MAX_SHARD_BYTES],
    ["index", MAX_INDEX_SHARD_BYTES],
  ] as const)("rejects a known oversized %s before reading", async (kind, limit) => {
    const cancel = vi.fn();
    const pull = vi.fn();
    const oversized = {
      body: new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 }),
      etag: '"oversized"',
      size: limit + 1,
    };
    const { get: read, store } = setup();
    const target = {
      metadata: "v1/meta.json",
      root: snapshotRootPath(snapshot),
      "pointer shard": store.shardFor(snapshot, "css.unknown"),
      index: store.reads(snapshot, "index/css.json").at(-1)!,
    }[kind];
    const get = vi.fn(async (path: string) => (path === target ? oversized : read(path)));
    const response = await createArtifactHandler({ store: { get } })(
      request("/v1/current/features/css.unknown.json"),
    );
    expect(response.status).toBe(500);
    expect(cancel).toHaveBeenCalledOnce();
    expect(pull).not.toHaveBeenCalled();
  });

  it("bounds unknown-size index shards while streaming", async () => {
    const cancel = vi.fn();
    const { get: read, store } = setup();
    const index = store.reads(snapshot, "index/css.json").at(-1)!;
    const get = vi.fn(async (path: string) =>
      path === index
        ? {
            body: new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array(MAX_INDEX_SHARD_BYTES + 1));
              },
              cancel,
            }),
            etag: '"shard"',
          }
        : read(path),
    );
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

describe("content-addressed resolution", () => {
  const suffix = "features/css.properties.display.json";

  it("reads the root and shard once when a tree cache is supplied", async () => {
    const { get, store } = setup({ [`v1/${snapshot}/${suffix}`]: { cached: true } });
    const handler = createArtifactHandler({ store: { get }, treeCache: createTreeCache() });
    const [root, shard, blob] = store.reads(snapshot, suffix);
    for (let round = 0; round < 2; round += 1) {
      const response = await handler(request(`/v1/current/${suffix}`));
      expect(await response.json()).toEqual({ cached: true });
    }
    expect(get.mock.calls.map(([key]) => key)).toEqual([
      "v1/meta.json",
      root,
      shard,
      blob,
      "v1/meta.json",
      blob,
    ]);
  });

  it("still checks retirement against metadata when the tree is cached", async () => {
    const treeCache = createTreeCache();
    const first = setup({ [`v1/${older}/browsers.json`]: { old: true } });
    const handler = createArtifactHandler({ store: { get: first.get }, treeCache });
    expect((await handler(request(`/v1/${older}/browsers.json`))).status).toBe(200);

    const retired = setup({
      "v1/meta.json": { ...metadata, snapshots: metadata.snapshots.slice(0, 1) },
    });
    const later = createArtifactHandler({ store: { get: retired.get }, treeCache });
    const response = await later(request(`/v1/${older}/browsers.json`));
    expect(apiErrorResponseSchema.parse(await response.json()).error.code).toBe(
      "snapshot_not_found",
    );
  });

  it("treats a missing root or pointer shard as corruption", async () => {
    for (const missing of ["root", "shard"] as const) {
      const { get, handler, store } = setup({ [`v1/${snapshot}/${suffix}`]: {} });
      const [root, shard] = store.reads(snapshot, suffix);
      store.files.delete(missing === "root" ? root! : shard!);
      expect((await handler(request(`/v1/current/${suffix}`))).status).toBe(500);
      expect(get).toHaveBeenCalledTimes(missing === "root" ? 2 : 3);
    }
  });

  it("rejects a root that names another snapshot", async () => {
    const { handler, store } = setup();
    const root = JSON.parse(store.files.get(snapshotRootPath(snapshot))!) as { snapshot: string };
    store.files.set(snapshotRootPath(snapshot), JSON.stringify({ ...root, snapshot: older }));
    expect((await handler(request("/v1/current/browsers.json"))).status).toBe(500);
  });

  it.each(["toString", "constructor", "hasOwnProperty"])(
    "finds no pointer for the inherited property name %s",
    async (key) => {
      const { handler } = setup();
      const response = await handler(request(`/v1/current/features/${key}.json`));
      expect(response.status).toBe(404);
      expect(apiErrorResponseSchema.parse(await response.json()).error.code).toBe(
        "feature_not_found",
      );
    },
  );
});

describe("tree cache", () => {
  it("forgets the least recently used entry beyond its limit", () => {
    const cache = createTreeCache({ roots: 2, shards: 1 });
    const root = (id: string) => ({ id }) as never;
    cache.roots.set("a", root("a"));
    cache.roots.set("b", root("b"));
    expect(cache.roots.get("a")).toEqual({ id: "a" });
    cache.roots.set("c", root("c"));
    expect(cache.roots.get("b")).toBeUndefined();
    expect(cache.roots.get("a")).toEqual({ id: "a" });
    expect(cache.roots.size).toBe(2);
    expect(() => createTreeCache({ shards: 0 })).toThrow("at least 1");
  });
});

describe("snapshots published under an earlier contract", () => {
  // A 1.0.0 feature body: its summary has no versionAddedIsApproximate.
  const olderFeature = {
    ...olderEnvelope,
    query: "legacy.group.feature",
    browsers: { opera: { name: "Opera", type: "desktop", previewName: null } },
    features: [
      {
        key: "legacy.group.feature",
        support: { opera: { summary: { state: "supported", versionAdded: "12.1" } } },
      },
    ],
  };

  it("passes a retained 1.0.0 payload through unchanged", async () => {
    const { handler } = setup({
      [`v1/${older}/features/legacy.group.feature.json`]: olderFeature,
    });
    const result = await handler(request(`/v1/${older}/features/legacy.group.feature.json`));
    expect(result.status).toBe(200);
    expect(await result.text()).toBe(JSON.stringify(olderFeature));
  });

  it("answers a missing key from a retained 1.0.0 index", async () => {
    const { handler } = setup();
    const result = await handler(request(`/v1/${older}/features/legacy.group.json`));
    expect(result.status).toBe(404);
    expect((await result.json()).error).toMatchObject({
      code: "namespace_not_queryable",
      query: "legacy.group",
    });
    const missing = await handler(request(`/v1/${older}/features/legacy.other.json`));
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe("feature_not_found");
  });

  it("keeps serving while the bucket's metadata is still at 1.0.0", async () => {
    // The Worker is deployed before the publication that moves the bucket to 1.1.0.
    const stored: StoredMetaResponse = { ...metadata, contract: "1.0.0" };
    const { handler } = setup({
      "v1/meta.json": stored,
      [`v1/${snapshot}/features/css.properties.display.json`]: {
        ...olderEnvelope,
        query: "css.properties.display",
      },
    });
    const result = await handler(request("/v1/current/features/css.properties.display.json"));
    expect(result.status).toBe(200);
    expect(result.headers.get(RELEASE_HEADERS.snapshot)).toBe(snapshot);
  });

  it("refuses metadata at a contract it does not know", async () => {
    const onError = vi.fn();
    const { get } = setup({ "v1/meta.json": { ...metadata, contract: "1.2.0" } });
    const handler = createArtifactHandler({ store: { get }, onError });
    const result = await handler(request("/v1/current/browsers.json"));
    expect(result.status).toBe(500);
    expect(onError).toHaveBeenCalledOnce();
  });
});
