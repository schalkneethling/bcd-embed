import { withSentry } from "@sentry/cloudflare";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { createArtifactHandler, matchesIfNoneMatch, negotiateEncoding } from "@bcd-embed/server";
import { reportError } from "./logging.js";
import { sentryOptions } from "./sentry.js";

type WorkerEnv = Env & { SENTRY_DSN?: string };
const CACHE_LENGTH_HEADER = "x-bcd-cache-representation-length";

const cacheable = (response: Response): boolean => {
  const policy = response.headers.get("cache-control") ?? "";
  return (
    [200, 400, 404].includes(response.status) &&
    /(?:^|,)\s*max-age=\d+/.test(policy) &&
    !policy.includes("no-store") &&
    !response.headers.has("set-cookie")
  );
};

const withoutBody = async (response: Response, status: number): Promise<Response> => {
  await response.body?.cancel();
  const headers = new Headers(response.headers);
  if (status === 304) headers.delete("content-length");
  return new Response(null, { status, headers, encodeBody: "manual" });
};

const fromCache = async (
  request: Request,
  response: Response,
  ctx: ExecutionContext,
): Promise<Response> => {
  const length = response.headers.get(CACHE_LENGTH_HEADER);
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) {
    await response.body?.cancel();
    throw new Error("Invalid cached representation length.");
  }
  const headers = new Headers(response.headers);
  headers.delete(CACHE_LENGTH_HEADER);
  if (length !== null) headers.set("content-length", length);
  response = new Response(response.body, {
    status: response.status,
    headers,
    encodeBody: "manual",
  });
  const etag = response.headers.get("etag");
  if (
    response.status === 200 &&
    etag !== null &&
    matchesIfNoneMatch(request.headers.get("if-none-match"), etag)
  ) {
    return withoutBody(response, 304);
  }
  if (request.method === "HEAD") return withoutBody(response, response.status);
  if (length !== null && response.body !== null) {
    // Header-only restoration is ignored for an unknown-length cached stream.
    // FixedLengthStream preserves GET/HEAD wire length without buffering bytes.
    const fixed = new FixedLengthStream(Number(length));
    ctx.waitUntil(response.body.pipeTo(fixed.writable).catch(reportError));
    return new Response(fixed.readable, { status: response.status, headers, encodeBody: "manual" });
  }
  return manualResponse(response);
};

const manualResponse = (response: Response): Response =>
  new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    encodeBody: "manual",
  });

const worker = {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    // Cloudflare rewrites Accept-Encoding for origins; negotiate the actual client value.
    const clientEncoding = request.cf?.clientAcceptEncoding;
    if (typeof clientEncoding === "string") {
      const headers = new Headers(request.headers);
      headers.set("accept-encoding", clientEncoding);
      request = new Request(request, { headers });
    }
    const handle = createArtifactHandler({
      store: {
        async get(path) {
          const object = await env.ARTIFACTS.get(path);
          if (object === null) return null;
          const sha256 = object.customMetadata?.sha256;
          const nativeSha256 = object.checksums.sha256;
          const nativeHex =
            nativeSha256 === undefined
              ? undefined
              : Array.from(new Uint8Array(nativeSha256), (byte) =>
                  byte.toString(16).padStart(2, "0"),
                ).join("");
          if (
            sha256 === undefined ||
            !/^[a-f0-9]{64}$/.test(sha256) ||
            (nativeHex !== undefined && nativeHex !== sha256)
          ) {
            await object.body.cancel();
            throw new Error("Artifact SHA-256 metadata missing or invalid.");
          }
          return { body: object.body, etag: `"${sha256}"`, size: object.size };
        },
      },
      encodeJson(bytes, encoding) {
        // Only generated error bodies enter here, bounded by the router's path limits.
        if (bytes.byteLength > 16 * 1024)
          throw new Error("Generated JSON response exceeds encoder bound.");
        return encoding === "br"
          ? brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })
          : gzipSync(bytes, { level: 6 });
      },
      onError: reportError,
    });

    if (request.method !== "GET" && request.method !== "HEAD")
      return manualResponse(await handle(request));

    // Public immutable cache headers belong to consumers. Keeping a pinned
    // object in our edge cache for a year would bypass metadata retirement.
    // Until expiry-bound edge entries are supported, only mutable aliases use
    // Cache API; pinned reads always check the published metadata membership.
    const pathname = new URL(request.url).pathname;
    if (pathname !== "/v1/meta.json" && !pathname.startsWith("/v1/current/"))
      return manualResponse(await handle(request));

    // Cache API applies request conditionals and Range headers itself. Use a clean
    // canonical GET key, then apply the shared HTTP conditional logic explicitly.
    const cacheUrl = new URL(request.url);
    cacheUrl.search = "";
    cacheUrl.searchParams.set(
      "__bcd_encoding",
      negotiateEncoding(request.headers.get("accept-encoding")) ?? "unacceptable",
    );
    cacheUrl.hash = "";
    const cacheKey = new Request(cacheUrl, { method: "GET" });
    let cache: Cache | undefined;
    try {
      cache = await caches.open("bcd-embed-api-v1");
      const hit = await cache.match(cacheKey);
      if (hit !== undefined) return await fromCache(request, hit, ctx);
    } catch (error) {
      reportError(error);
    }

    const response = manualResponse(await handle(request));
    if (request.method === "GET" && cache !== undefined && cacheable(response)) {
      try {
        const cached = response.clone();
        const length = response.headers.get("content-length");
        if (length !== null) cached.headers.set(CACHE_LENGTH_HEADER, length);
        ctx.waitUntil(
          cache.put(cacheKey, cached).catch((error: unknown) => {
            reportError(error);
          }),
        );
      } catch (error) {
        reportError(error);
      }
    }
    return response;
  },
} satisfies ExportedHandler<WorkerEnv>;

export default withSentry<WorkerEnv, unknown, unknown, typeof worker>(sentryOptions, worker);
