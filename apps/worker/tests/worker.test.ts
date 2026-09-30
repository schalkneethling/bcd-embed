import { execFile as execFileCallback } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import bcd from "@mdn/browser-compat-data" with { type: "json" };
import { generateSnapshot } from "@bcd-embed/generator";
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
      await bucket.put(artifact.path, `${JSON.stringify(artifact.data)}\n`, {
        httpMetadata: { contentType: "application/json" },
      });
    }
  });

  afterAll(async () => {
    await runtime?.dispose();
  });

  it("streams a generated Array-scale feature with R2's quoted strong ETag", async () => {
    const bucket = await runtime.getR2Bucket("ARTIFACTS");
    const object = await bucket.head(featurePath);
    expect(object).not.toBeNull();
    expect(object!.size).toBeGreaterThan(100_000);

    const response = await runtime.dispatchFetch(
      url(`v1/current/features/javascript.builtins.Array.json`),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("etag")).toBe(object!.httpEtag);
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
