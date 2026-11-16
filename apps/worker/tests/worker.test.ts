import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { request as httpRequest } from "node:http";
import { createHash } from "node:crypto";
import { brotliDecompressSync, gunzipSync } from "node:zlib";

import bcd from "@mdn/browser-compat-data" with { type: "json" };
import { emitContentTree, generateSnapshot, shardIndexOf } from "@bcd-embed/generator";
import {
  blobPath,
  featureResponseSchema,
  shardPath,
  shardSchema,
  snapshotRootPath,
  snapshotRootSchema,
} from "@bcd-embed/schema";
import { Miniflare, Response as MiniflareResponse, convertV4MiniflareOptions } from "miniflare";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { reportError } from "../src/logging.js";

const scriptPath = fileURLToPath(
  new URL("../../../.wrangler/worker-dry-run/index.js", import.meta.url),
);
const modulesRoot = fileURLToPath(new URL("../../../.wrangler/worker-dry-run/", import.meta.url));
const workerDirectory = fileURLToPath(new URL("../", import.meta.url));
const wranglerPath = fileURLToPath(new URL("../node_modules/.bin/wrangler", import.meta.url));
const execFile = promisify(execFileCallback);

// Raw HTTP does not transparently decode compressed response bytes (dispatchFetch does).
const rawFetch = async (
  runtime: Miniflare,
  path: string,
  init: { method?: string; headers?: Record<string, string> } = {},
): Promise<Response> => {
  const ready = await runtime.ready;
  const target = new URL(new URL(path).pathname, ready);
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(target, init, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
      incoming.on("error", reject);
      incoming.on("end", () => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers))
          if (value !== undefined)
            headers.set(name, Array.isArray(value) ? value.join(", ") : value);
        const body = Buffer.concat(chunks);
        resolve(
          new Response(body.length === 0 ? null : body, { status: incoming.statusCode, headers }),
        );
      });
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
};
const generated = generateSnapshot({
  generated: "2026-09-30T12:00:00Z",
  expires: "2026-12-29",
  data: {
    ...Object.fromEntries(
      Object.keys(bcd)
        .filter((key) => key !== "__meta" && key !== "browsers")
        .map((key) => [key, {}]),
    ),
    __meta: bcd.__meta,
    browsers: bcd.browsers,
    javascript: { builtins: { Array: bcd.javascript.builtins!.Array } },
  },
});
const snapshotId = generated.snapshot.id;
const url = (path: string): string => `https://api.example.test/${path}`;
const featureKey = "javascript.builtins.Array";
/** The blob that answers the Array feature, found through the emitted root and shard. */
let featurePath: string;
const verifierPath = fileURLToPath(
  new URL("../../../packages/server/scripts/verify-endpoint.mjs", import.meta.url),
);

const createRuntime = (): Miniflare =>
  new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath,
      modulesRoot,
      r2Buckets: ["ARTIFACTS"],
      cacheAPI: true,
      compatibilityDate: "2026-09-23",
      compatibilityFlags: ["nodejs_compat"],
    }),
  );

describe("Cloudflare Worker with a real local R2 binding", () => {
  let runtime: Miniflare;

  beforeAll(async () => {
    // Root `pnpm check` runs tests before workspace builds. Produce the exact
    // Worker bundle under test here, including on a fresh checkout.
    await execFile(
      wranglerPath,
      ["deploy", "--dry-run", "--outdir", "../../.wrangler/worker-dry-run"],
      { cwd: workerDirectory },
    );
    runtime = createRuntime();
    const bucket = await runtime.getR2Bucket("ARTIFACTS");
    // Serve the tree the real generator emits, so the Worker's shard rule is checked against it.
    const outputRoot = await mkdtemp(join(tmpdir(), "bcd-embed-worker-"));
    try {
      await emitContentTree({ outputRoot, generatedSnapshot: generated });
      const paths = (await readdir(outputRoot, { recursive: true, withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name).slice(outputRoot.length + 1))
        // The metadata is written last, just as publication must do.
        .sort((left, right) => Number(left === "v1/meta.json") - Number(right === "v1/meta.json"));
      for (const path of paths) {
        const bytes = await readFile(join(outputRoot, path));
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        const encoding = path.endsWith(".br") ? "br" : path.endsWith(".gz") ? "gzip" : undefined;
        await bucket.put(path, bytes, {
          httpMetadata: {
            contentType: "application/json",
            ...(encoding === undefined ? {} : { contentEncoding: encoding }),
          },
          customMetadata: { sha256 },
          sha256,
        });
      }
      const root = snapshotRootSchema.parse(
        JSON.parse(await readFile(join(outputRoot, snapshotRootPath(snapshotId)), "utf8")),
      );
      const shard = shardSchema.parse(
        JSON.parse(
          await readFile(
            join(outputRoot, shardPath(root.shards[shardIndexOf(featureKey)]!)),
            "utf8",
          ),
        ),
      );
      featurePath = blobPath(shard.pointers[featureKey]!.feature, "identity");
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  afterAll(async () => {
    await runtime?.dispose();
  });

  it("streams a generated Array-scale feature with the published SHA-256 strong ETag", async () => {
    const bucket = await runtime.getR2Bucket("ARTIFACTS");
    const object = await bucket.head(featurePath);
    expect(object).not.toBeNull();
    expect(object!.size).toBeGreaterThan(100_000);

    const response = await runtime.dispatchFetch(
      url(`v1/current/features/javascript.builtins.Array.json`),
      { headers: { "accept-encoding": "identity" } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("etag")).toBe(`"${object!.customMetadata!.sha256}"`);
    expect(response.headers.get("etag")).toMatch(/^"[^"\r\n]+"$/);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-expose-headers")).toContain("etag");
    // The body no longer names its release, so the headers must survive the real Worker runtime.
    expect(response.headers.get("bcd-embed-snapshot")).toBe(generated.snapshot.id);
    expect(response.headers.get("bcd-embed-generated")).toBe(generated.snapshot.generated);
    expect(response.headers.get("bcd-embed-source-version")).toBe(bcd.__meta.version);
    expect(response.headers.get("cache-control")).toContain("max-age=86400");
    const body = featureResponseSchema.parse(await response.json());
    expect(body.query).toBe("javascript.builtins.Array");
    expect(body.features.length).toBeGreaterThan(40);
  });

  it("serves raw, index, metadata, and pinned snapshot routes", async () => {
    const paths = [
      `v1/${snapshotId}/raw/javascript.builtins.Array.json`,
      `v1/${snapshotId}/index/javascript.json`,
      `v1/${snapshotId}/index.json`,
      `v1/${snapshotId}/browsers.json`,
      "v1/meta.json",
    ];
    for (const path of paths) {
      const response = await runtime.dispatchFetch(url(path));
      expect(response.status, path).toBe(200);
      expect(response.headers.get("etag"), path).toMatch(/^"[^"\r\n]+"$/);
      expect(await response.json(), path).toBeDefined();
    }
  });

  it("returns bodyless HEAD and 304 responses with representation headers", async () => {
    const path = url(`v1/${snapshotId}/features/javascript.builtins.Array.json`);
    const first = await runtime.dispatchFetch(path);
    const etag = first.headers.get("etag");
    expect(etag).toMatch(/^"[^"\r\n]+"$/);
    await first.body?.cancel();

    const head = await runtime.dispatchFetch(path, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("etag")).toBe(etag);
    expect(await head.text()).toBe("");

    const conditional = await runtime.dispatchFetch(path, {
      headers: { "If-None-Match": etag! },
    });
    expect(conditional.status).toBe(304);
    expect(conditional.headers.get("etag")).toBe(etag);
    expect(await conditional.text()).toBe("");
  });

  it("passes the endpoint verifier CLI against the seeded local R2 Worker", async () => {
    const ready = await runtime.ready;
    const { stdout, stderr } = await execFile(
      process.execPath,
      [verifierPath, "--base-url", ready.origin],
      { timeout: 125_000 },
    );
    const report = JSON.parse(stdout);
    expect(stderr).toBe("");
    expect(report.remote).toBe(false);
    expect(report.probes).toBe(22);
    expect(report.checks).toContain("decoded body (br, first and repeated)");
    expect(report.checks).toContain("strong ETag (br)");
    expect(report.checks).toContain("compressed If-None-Match");
    expect(report.note).toContain("future explicit LIVE probe");
  }, 135_000);

  it.each(["br", "gzip"])(
    "serves Array-scale %s bytes without re-encoding and isolates cached validators",
    async (encoding) => {
      const path = url("v1/current/features/javascript.builtins.Array.json");
      const identity = await rawFetch(runtime, path, {
        headers: { "accept-encoding": "identity" },
      });
      const identityBytes = Buffer.from(await identity.arrayBuffer());
      expect(identityBytes.length).toBeGreaterThan(600_000);
      const compressed = await rawFetch(runtime, path, {
        headers: { "accept-encoding": encoding },
      });
      const compressedBytes = Buffer.from(await compressed.arrayBuffer());
      expect(compressed.headers.get("content-encoding")).toBe(encoding);
      expect(compressed.headers.get("vary")).toBe("Accept-Encoding");
      expect(compressed.headers.get("etag")).not.toBe(identity.headers.get("etag"));
      expect(compressedBytes.length).toBeLessThan(identityBytes.length / 10);
      expect(
        encoding === "br" ? brotliDecompressSync(compressedBytes) : gunzipSync(compressedBytes),
      ).toEqual(identityBytes);
      const bucket = await runtime.getR2Bucket("ARTIFACTS");
      const stored = await bucket.get(`${featurePath}${encoding === "br" ? ".br" : ".gz"}`);
      expect(compressedBytes).toEqual(Buffer.from(await stored!.arrayBuffer()));
      for (const method of ["GET", "HEAD"]) {
        const conditional = await rawFetch(runtime, path, {
          method,
          headers: {
            "accept-encoding": encoding,
            "if-none-match": compressed.headers.get("etag")!,
          },
        });
        expect(conditional.status).toBe(304);
        expect(conditional.headers.get("content-encoding")).toBe(encoding);
        expect(conditional.headers.get("etag")).toBe(compressed.headers.get("etag"));
        expect(await conditional.text()).toBe("");
      }
      const head = await rawFetch(runtime, path, {
        method: "HEAD",
        headers: { "accept-encoding": encoding },
      });
      expect(head.status).toBe(200);
      expect(head.headers.get("content-length")).toBe(compressed.headers.get("content-length"));
      expect(head.headers.get("content-encoding")).toBe(encoding);
      expect(await head.text()).toBe("");
      const other = await rawFetch(runtime, path, {
        headers: {
          "accept-encoding": "identity",
          "if-none-match": compressed.headers.get("etag")!,
        },
      });
      expect(other.status).toBe(200);
      expect(other.headers.get("etag")).toBe(identity.headers.get("etag"));
      await other.body?.cancel();
    },
  );

  it.each(["br", "gzip"])(
    "reads %s responses from R2 and never stores or serves them through Cache API",
    async (encoding) => {
      // The deployed edge double-compressed cached Brotli and gzip responses, and Miniflare does
      // not reproduce that, so these tests pin the bypass itself: a planted entry in the slot a
      // compressed response would use is ignored, and a compressed miss stores nothing.
      const ready = await runtime.ready;
      const cache = await (await runtime.getCaches()).open("bcd-embed-api-v1");
      const slot = (path: string, slotEncoding: string): string => {
        const key = new URL(path, ready);
        key.searchParams.set("__bcd_encoding", slotEncoding);
        return key.href;
      };
      const featureRoute = "/v1/current/features/javascript.builtins.Array.json";
      await cache.put(
        slot(featureRoute, encoding),
        new MiniflareResponse("planted", {
          headers: { "cache-control": "max-age=60", "content-encoding": encoding },
        }),
      );
      const served = await rawFetch(runtime, url(featureRoute.slice(1)), {
        headers: { "accept-encoding": encoding },
      });
      const bucket = await runtime.getR2Bucket("ARTIFACTS");
      const stored = await bucket.get(`${featurePath}${encoding === "br" ? ".br" : ".gz"}`);
      expect(Buffer.from(await served.arrayBuffer())).toEqual(
        Buffer.from(await stored!.arrayBuffer()),
      );
      expect(served.headers.get("etag")).toMatch(/^"[a-f0-9]{64}"$/);
      await cache.delete(slot(featureRoute, encoding));

      const metaRoute = "/v1/meta.json";
      await cache.delete(slot(metaRoute, encoding));
      await cache.delete(slot(metaRoute, "identity"));
      await (
        await rawFetch(runtime, url(metaRoute.slice(1)), {
          headers: { "accept-encoding": encoding },
        })
      ).arrayBuffer();
      await (
        await rawFetch(runtime, url(metaRoute.slice(1)), {
          headers: { "accept-encoding": "identity" },
        })
      ).arrayBuffer();
      // The identity put runs after the compressed request finished, so once it lands, a put for
      // the compressed request would have landed too.
      await vi.waitFor(async () => {
        const identity = await cache.match(slot(metaRoute, "identity"));
        expect(identity).toBeDefined();
        await identity!.body?.cancel();
      });
      expect(await cache.match(slot(metaRoute, encoding))).toBeUndefined();
    },
  );

  it.each(["br", "gzip"])(
    "encodes bounded errors as %s with byte-specific tags and equivalent HEAD",
    async (encoding) => {
      const path = url("v1/current/features/javascript%2Fbuiltins.json");
      const identity = await rawFetch(runtime, path, {
        headers: { "accept-encoding": "identity" },
      });
      const encoded = await rawFetch(runtime, path, { headers: { "accept-encoding": encoding } });
      const bytes = Buffer.from(await encoded.arrayBuffer());
      const decoded = encoding === "br" ? brotliDecompressSync(bytes) : gunzipSync(bytes);
      expect(decoded.toString()).toBe(await identity.text());
      expect(encoded.status).toBe(400);
      expect(encoded.headers.get("etag")).not.toBe(identity.headers.get("etag"));
      const head = await rawFetch(runtime, path, {
        method: "HEAD",
        headers: { "accept-encoding": encoding, "if-none-match": encoded.headers.get("etag")! },
      });
      expect(head.status).toBe(400);
      expect(head.headers.get("etag")).toBe(encoded.headers.get("etag"));
      expect(head.headers.get("content-encoding")).toBe(encoding);
      expect(head.headers.get("content-length")).toBe(String(bytes.length));
      expect(await head.text()).toBe("");
    },
  );

  it("distinguishes malformed, missing, organizational, and missing-snapshot errors", async () => {
    const cases = [
      ["v1/current/features/javascript%2Fbuiltins.json", 400, "invalid_key"],
      ["v1/current/features/javascript.builtins.DoesNotExist.json", 404, "feature_not_found"],
      ["v1/current/features/javascript.builtins.json", 404, "namespace_not_queryable"],
      ["v1/missing-snapshot/features/javascript.builtins.Array.json", 404, "snapshot_not_found"],
    ] as const;
    for (const [path, status, code] of cases) {
      const response = await runtime.dispatchFetch(url(path));
      expect(response.status, path).toBe(status);
      expect(await response.json(), path).toMatchObject({ error: { code } });
      expect(response.headers.get("access-control-allow-origin"), path).toBe("*");
      expect(response.headers.get("etag"), path).toMatch(/^"[^"\r\n]+"$/);
    }
  });

  it("does not fabricate success when current metadata is absent", async () => {
    const emptyRuntime = createRuntime();
    try {
      const response = await emptyRuntime.dispatchFetch(
        url("v1/current/features/javascript.builtins.Array.json"),
      );
      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(response.headers.get("cache-control")).toBe("no-store");
    } finally {
      await emptyRuntime.dispose();
    }
  });

  it.each([undefined, "malformed", "0".repeat(64)])(
    "rejects missing, malformed, and native-mismatched SHA metadata %s",
    async (customSha) => {
      const isolated = createRuntime();
      try {
        const bucket = await isolated.getR2Bucket("ARTIFACTS");
        const bytes = Buffer.from("{}\n");
        await bucket.put("v1/meta.json", bytes, {
          sha256: createHash("sha256").update(bytes).digest("hex"),
          customMetadata: customSha === undefined ? {} : { sha256: customSha },
        });
        const response = await rawFetch(isolated, url("v1/meta.json"), {
          headers: { "accept-encoding": "identity" },
        });
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({
          error: { message: "Artifact service unavailable." },
        });
      } finally {
        await isolated.dispose();
      }
    },
  );

  it("keeps error details containing request-derived paths out of logs", () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      reportError(new Error("sensitive-path-secret"));
      expect(errorLog).toHaveBeenCalledOnce();
      expect(errorLog.mock.calls[0]?.[0]).toContain("bcd_embed_worker_error");
      expect(errorLog.mock.calls[0]?.[0]).not.toContain("sensitive-path-secret");
    } finally {
      errorLog.mockRestore();
    }
  });
});
