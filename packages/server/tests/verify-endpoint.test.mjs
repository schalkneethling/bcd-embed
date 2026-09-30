import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

import { parseVerifyArguments, verifyEndpoint } from "../scripts/verify-endpoint.mjs";

const snapshotId = "bcd-8.1.3-gen-0.0.0";
const key = "api.sampleFeature";
const serverHandles = [];

const startFixtureServer = async (
  host = "127.0.0.1",
  { indexKeys = [key], sameCompressedEtag = false, errorCacheControl = "max-age=3600" } = {},
) => {
  const requestTargets = [];
  let compressedRequests = 0;
  const server = createServer((request, response) => {
    const requestPath = request.url ?? "/";
    requestTargets.push(requestPath);
    if (request.headers["accept-encoding"]?.includes("br")) compressedRequests += 1;
    const isOptions = request.method === "OPTIONS";
    if (isOptions) {
      response.writeHead(204, {
        allow: "GET, HEAD, OPTIONS",
        "access-control-allow-methods": "GET, HEAD, OPTIONS",
        "access-control-allow-headers": "if-none-match",
        "access-control-allow-origin": "*",
        "access-control-expose-headers": "etag, retry-after",
      });
      response.end();
      return;
    }

    const pinned = requestPath.startsWith(`/v1/${snapshotId}/`);
    const current = requestPath.startsWith("/v1/current/") || requestPath === "/v1/meta.json";
    const cacheControl = pinned
      ? "public, max-age=31536000, immutable"
      : current
        ? "public, max-age=86400, stale-while-revalidate=604800"
        : "public, max-age=3600";
    let status = 200;
    let body;
    let etag = '"fixture"';

    if (requestPath === "/v1/meta.json") {
      body = {
        contract: "1.0.0",
        generated: "2026-09-30T00:00:00Z",
        current: snapshotId,
        snapshots: [{ id: snapshotId }],
        namespaces: ["api"],
      };
    } else if (requestPath.endsWith("/index.json")) {
      body = { namespace: null, keys: indexKeys };
    } else if (requestPath === "/v1/current/index/api.json") {
      body = { namespace: "api", keys: [key] };
    } else if (requestPath.endsWith("/browsers.json")) {
      body = { browsers: { chrome: { name: "Chrome" } } };
    } else {
      const routeMatch = requestPath.match(/^\/v1\/([^/]+)\/(features|raw)\/(.+)\.json$/);
      if (routeMatch === null) {
        status = 404;
        body = { error: { code: "snapshot_not_found", message: "No route.", query: requestPath } };
      } else {
        const [, selectedSnapshot, kind, requestedKey] = routeMatch;
        if (selectedSnapshot !== "current" && selectedSnapshot !== snapshotId) {
          status = 404;
          body = {
            error: {
              code: "snapshot_not_found",
              message: "Unknown snapshot.",
              query: selectedSnapshot,
            },
          };
        } else if (requestedKey.includes("%")) {
          status = 400;
          body = { error: { code: "invalid_key", message: "Invalid key.", query: requestedKey } };
        } else if (kind === "features" && requestedKey === "api") {
          status = 404;
          body = {
            error: {
              code: "namespace_not_queryable",
              message: "Not addressable.",
              query: requestedKey,
            },
          };
        } else if (requestedKey !== key) {
          status = 404;
          body = {
            error: { code: "feature_not_found", message: "Missing feature.", query: requestedKey },
          };
        } else if (kind === "features") {
          body = { query: key, features: [{ key }], browsers: {} };
          const compressed = request.headers["accept-encoding"]?.includes("gzip") === true;
          etag = compressed && !sameCompressedEtag ? '"feature-gzip"' : '"feature-identity"';
          if (request.headers["if-none-match"] === etag) {
            status = 304;
            body = undefined;
          } else if (compressed) {
            body = gzipSync(Buffer.from(JSON.stringify(body)));
          }
        } else {
          body = { __compat: { support: { chrome: { version_added: "1" } } } };
        }
      }
    }

    const headers = {
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "etag, retry-after",
      "cache-control": status === 400 || status === 404 ? errorCacheControl : cacheControl,
      etag,
    };
    if (body !== undefined && Buffer.isBuffer(body)) {
      headers["content-type"] = "application/json; charset=utf-8";
      headers["content-encoding"] = "gzip";
    } else if (body !== undefined) {
      headers["content-type"] = "application/json; charset=utf-8";
    }
    const bytes =
      body === undefined
        ? Buffer.alloc(0)
        : Buffer.isBuffer(body)
          ? body
          : Buffer.from(JSON.stringify(body));
    if (request.method === "HEAD") {
      headers["content-length"] = String(bytes.length);
      response.writeHead(status, headers);
      response.end();
      return;
    }
    response.writeHead(status, headers);
    response.end(bytes);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });
  serverHandles.push(server);
  const address = server.address();
  const displayHost = host.includes(":") ? `[${host}]` : host;
  return {
    baseUrl: `http://${displayHost}:${address.port}`,
    requestTargets,
    get compressedRequests() {
      return compressedRequests;
    },
  };
};

afterEach(async () => {
  await Promise.all(
    serverHandles.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

describe("verify-endpoint CLI grammar", () => {
  it("accepts help only when it is the sole argument", () => {
    expect(parseVerifyArguments(["--help"])).toEqual({ type: "help" });
    expect(parseVerifyArguments(["-h"])).toEqual({ type: "help" });
    expect(() => parseVerifyArguments(["--help", "--base-url", "http://127.0.0.1"])).toThrow(
      /Unknown argument/,
    );
  });

  it("requires a caller-supplied base URL and has no implicit endpoint", () => {
    expect(() => parseVerifyArguments([])).toThrow(/--base-url.*required/);
    expect(parseVerifyArguments(["--base-url", "http://127.0.0.1:8787"])).toEqual({
      type: "verify",
      baseUrl: "http://127.0.0.1:8787",
      allowRemote: false,
      localIdentityOnly: false,
      timeoutMs: 5_000,
    });
  });

  it("requires explicit remote opt-in and HTTPS for non-loopback hosts", () => {
    expect(() => parseVerifyArguments(["--base-url", "https://api.example.test"])).toThrow(
      /--allow-remote/,
    );
    expect(() =>
      parseVerifyArguments(["--base-url", "http://api.example.test", "--allow-remote"]),
    ).toThrow(/HTTPS/);
    expect(
      parseVerifyArguments(["--base-url", "https://api.example.test", "--allow-remote"]),
    ).toMatchObject({ type: "verify", allowRemote: true });
    expect(() =>
      parseVerifyArguments([
        "--base-url",
        "https://api.example.test",
        "--allow-remote",
        "--local-identity-only",
      ]),
    ).toThrow(/restricted to loopback/);
    expect(
      parseVerifyArguments(["--base-url", "http://127.0.0.1:8787", "--local-identity-only"]),
    ).toMatchObject({ localIdentityOnly: true });
  });

  it("does not accept URL paths, credentials, queries, or fragments", () => {
    for (const baseUrl of [
      "http://user:pass@127.0.0.1:8787",
      "http://127.0.0.1:8787/prefix",
      "http://127.0.0.1:8787?mode=test",
      "http://127.0.0.1:8787#fragment",
    ]) {
      expect(() => parseVerifyArguments(["--base-url", baseUrl])).toThrow(/origin only/);
    }
  });

  it("connects to an IPv6 loopback fixture when the platform supports it", async ({ skip }) => {
    let fixture;
    try {
      fixture = await startFixtureServer("::1");
    } catch {
      skip();
      return;
    }

    const report = await verifyEndpoint({
      baseUrl: fixture.baseUrl,
      allowRemote: false,
    });
    expect(report.remote).toBe(false);
    expect(report.probes).toBe(fixture.requestTargets.length);
  });

  it("bounds request timeout and rejects invented option forms", () => {
    expect(
      parseVerifyArguments(["--base-url", "http://localhost:8787", "--timeout-ms", "10000"]),
    ).toMatchObject({ timeoutMs: 10_000 });

    for (const args of [
      ["--base-url", "http://localhost", "--timeout-ms", "99"],
      ["--base-url", "http://localhost", "--timeout-ms", "30001"],
      ["--base-url", "http://localhost", "--timeout-ms", "1.5"],
      ["--base-url=http://localhost"],
      ["--base-url", "http://localhost", "extra"],
      ["--base-url", "http://localhost", "--allow-remote", "--allow-remote"],
    ]) {
      expect(() => parseVerifyArguments(args)).toThrow();
    }
  });

  it("runs a bounded read-only probe plan and preserves raw encoded request targets", async () => {
    const fixture = await startFixtureServer();
    const report = await verifyEndpoint({
      baseUrl: fixture.baseUrl,
      allowRemote: false,
    });

    expect(report.remote).toBe(false);
    expect(report.probes).toBeLessThanOrEqual(24);
    expect(report.probes).toBe(fixture.requestTargets.length);
    expect(fixture.compressedRequests).toBe(2);
    expect(report.checks).toContain("compressed If-None-Match");
    expect(report.note).toContain("Cloudflare edge compression");
    expect(fixture.requestTargets).toContain("/v1/current/features/api.%ZZ.json");
    expect(fixture.requestTargets).toContain("/v1/current/features/api.%2e%2e%2fsecret.json");
  });

  it("allows an explicit loopback identity-only check and skips both compressed requests", async () => {
    const fixture = await startFixtureServer();
    const report = await verifyEndpoint({
      baseUrl: fixture.baseUrl,
      allowRemote: false,
      localIdentityOnly: true,
    });

    expect(report.remote).toBe(false);
    expect(report.compression).toBe("skipped (--local-identity-only)");
    expect(report.checks).toContain("compressed probes skipped (--local-identity-only)");
    expect(fixture.compressedRequests).toBe(0);
    expect(report.probes).toBe(fixture.requestTargets.length);
  });

  it("rejects schema-invalid endpoint identifiers before using them in request paths", async () => {
    const fixture = await startFixtureServer("127.0.0.1", { indexKeys: ["api.%2fsecret"] });
    await expect(verifyEndpoint({ baseUrl: fixture.baseUrl, allowRemote: false })).rejects.toThrow(
      /bounded feature-key grammar/,
    );
    expect(fixture.requestTargets).not.toContain("/v1/current/features/api.%2fsecret.json");
  });

  it("rejects empty dot segments from the discovered index", async () => {
    const fixture = await startFixtureServer("127.0.0.1", { indexKeys: ["api."] });
    await expect(verifyEndpoint({ baseUrl: fixture.baseUrl, allowRemote: false })).rejects.toThrow(
      /empty dot segment/,
    );
    expect(fixture.requestTargets).not.toContain("/v1/current/features/api..json");
  });

  it("rejects unexpected extra directives on error responses", async () => {
    const fixture = await startFixtureServer("127.0.0.1", {
      errorCacheControl: "max-age=3600, stale-while-revalidate=60",
    });
    await expect(verifyEndpoint({ baseUrl: fixture.baseUrl, allowRemote: false })).rejects.toThrow(
      /unexpected error cache policy/,
    );
  });

  it("rejects reusing an identity strong ETag for compressed representation bytes", async () => {
    const fixture = await startFixtureServer("127.0.0.1", { sameCompressedEtag: true });
    await expect(verifyEndpoint({ baseUrl: fixture.baseUrl, allowRemote: false })).rejects.toThrow(
      /reused identity ETag/,
    );
  });

  it("does not issue any network request for a remote endpoint without opt-in", async () => {
    await expect(
      verifyEndpoint({ baseUrl: "https://endpoint.example.test", allowRemote: false }),
    ).rejects.toThrow(/--allow-remote/);
  });
});
