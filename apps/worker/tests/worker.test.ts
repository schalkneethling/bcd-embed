import { execFile as execFileCallback } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { request as httpRequest } from "node:http";
import { createHash } from "node:crypto";
import { brotliDecompressSync, gunzipSync } from "node:zlib";

import bcd from "@mdn/browser-compat-data" with { type: "json" };
import { createRepresentations, generateSnapshot } from "@bcd-embed/generator";
import { featureResponseSchema } from "@bcd-embed/schema";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
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
const featurePath = `v1/${snapshotId}/features/javascript.builtins.Array.json`;
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
    // The candidate metadata is written last, just as publication must do.
    for (const artifact of generated.artifacts) {
      for (const representation of createRepresentations(
        artifact.path,
        Buffer.from(`${JSON.stringify(artifact.data)}\n`),
      )) {
        await bucket.put(representation.path, representation.bytes, {
          httpMetadata: {
            contentType: "application/json",
            ...(representation.encoding === "identity"
              ? {}
              : { contentEncoding: representation.encoding }),
          },
          customMetadata: { sha256: representation.sha256 },
          sha256: representation.sha256,
        });
      }
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
    expect(report.probes).toBe(21);
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
      const stored = await bucket.get(`${featurePath}.${encoding === "br" ? "br" : "gz"}`);
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
