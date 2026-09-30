import { createArtifactHandler, matchesIfNoneMatch } from "@bcd-embed/server";
import { reportError } from "./logging.js";

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
  return new Response(null, { status, headers });
};

const fromCache = async (request: Request, response: Response): Promise<Response> => {
  const etag = response.headers.get("etag");
  if (
    response.status === 200 &&
    etag !== null &&
    matchesIfNoneMatch(request.headers.get("if-none-match"), etag)
  ) {
    return withoutBody(response, 304);
  }
  if (request.method === "HEAD") return withoutBody(response, response.status);
  return response;
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const handle = createArtifactHandler({
      store: {
        async get(path) {
          const object = await env.ARTIFACTS.get(path);
          if (object === null) return null;
          return { body: object.body, etag: object.httpEtag, size: object.size };
        },
      },
      onError: reportError,
    });

    if (request.method !== "GET" && request.method !== "HEAD") return handle(request);

    // Cache API applies request conditionals and Range headers itself. Use a clean
    // canonical GET key, then apply the shared HTTP conditional logic explicitly.
    const cacheUrl = new URL(request.url);
    cacheUrl.search = "";
    cacheUrl.hash = "";
    const cacheKey = new Request(cacheUrl, { method: "GET" });
    let cache: Cache | undefined;
    try {
      cache = await caches.open("bcd-embed-api-v1");
      const hit = await cache.match(cacheKey);
      if (hit !== undefined) return fromCache(request, hit);
    } catch (error) {
      reportError(error);
    }

    const response = await handle(request);
    if (request.method === "GET" && cache !== undefined && cacheable(response)) {
      try {
        ctx.waitUntil(
          cache.put(cacheKey, response.clone()).catch((error: unknown) => {
            reportError(error);
          }),
        );
      } catch (error) {
        reportError(error);
      }
    }
    return response;
  },
} satisfies ExportedHandler<Env>;
