import {
  apiErrorResponseSchema,
  featureKeySchema,
  indexResponseSchema,
  metaResponseSchema,
  namespaceSchema,
  snapshotIdentifierSchema,
  type ApiErrorCode,
} from "@bcd-embed/schema";

/** Storage paths are relative to the artifact root, never URL paths. */
export interface ArtifactStore {
  get(path: string): Promise<Artifact | null>;
}

export interface Artifact {
  body: ReadableStream<Uint8Array>;
  /** A quoted strong entity tag identifying the exact emitted bytes. */
  etag: string;
  /** Byte length when known. Bounded reads still enforce their cap on the stream. */
  size?: number;
}

export type ReadDecision =
  | { code: "rate_limited"; retryAfter: number }
  | { code: "generation_in_progress" }
  | null;

export interface ArtifactHandlerOptions {
  store: ArtifactStore;
  beforeRead?: (request: Request) => ReadDecision | Promise<ReadDecision>;
  onError?: (error: unknown) => void | Promise<void>;
}

export const MAX_KEY_LENGTH = 512;
export const MAX_METADATA_BYTES = 256 * 1024;
export const MAX_INDEX_SHARD_BYTES = 2 * 1024 * 1024;
const MAX_PATH_LENGTH = 2048;
const MAX_NAMESPACE_LENGTH = 128;
const MAX_SNAPSHOT_LENGTH = 512;
const CURRENT_CACHE = "max-age=86400, stale-while-revalidate=604800";
const PINNED_CACHE = "max-age=31536000, immutable";
const ERROR_CACHE = "max-age=3600";
const METHODS = "GET, HEAD, OPTIONS";
// RFC 9110 §8.8.3: etagc = %x21 / %x23-7E / obs-text.
const STRONG_ETAG = /^"[\x21\x23-\x7e\x80-\xff]*"$/;

type Route =
  | { type: "meta" }
  | { type: "artifact"; snapshot: string; suffix: string; key: string | null };

class RequestError extends Error {
  constructor(
    readonly code: "invalid_key" | "snapshot_not_found",
    readonly query: string,
  ) {
    super(code);
  }
}

/** A Fetch Request has already normalized URL dot-directory segments. */
function parseRoute(url: string): Route | null {
  const raw = /^https?:\/\/[^/?#]+([^?#]*)/.exec(url)?.[1] || "/";
  if (raw.length > MAX_PATH_LENGTH || /%(?:2f|5c)/i.test(raw)) {
    throw new RequestError("invalid_key", raw.slice(0, MAX_PATH_LENGTH));
  }
  let path: string;
  try {
    path = decodeURIComponent(raw);
  } catch {
    throw new RequestError("invalid_key", raw);
  }
  if (path.includes("%") || path.includes("\\")) throw new RequestError("invalid_key", raw);
  if (path === "/v1/meta.json") return { type: "meta" };
  const match = /^\/v1\/([^/]+)\/(.*)$/.exec(path);
  if (!match) return null;
  const snapshot = match[1]!;
  const suffix = match[2]!;
  if (
    snapshot !== "current" &&
    (snapshot.length > MAX_SNAPSHOT_LENGTH ||
      snapshot.includes("..") ||
      !snapshotIdentifierSchema.safeParse(snapshot).success)
  ) {
    throw new RequestError("snapshot_not_found", snapshot);
  }
  if (suffix === "browsers.json" || suffix === "index.json") {
    return { type: "artifact", snapshot, suffix, key: null };
  }
  if (suffix.startsWith("index/")) {
    const namespace = suffix.slice(6, -5);
    if (
      !suffix.endsWith(".json") ||
      namespace.length > MAX_NAMESPACE_LENGTH ||
      !namespaceSchema.safeParse(namespace).success
    ) {
      throw new RequestError("invalid_key", namespace || suffix);
    }
    return { type: "artifact", snapshot, suffix: `index/${namespace}.json`, key: null };
  }
  const feature = /^(features|raw)\/(.*)$/.exec(suffix);
  if (!feature) return null;
  const resource = feature[1]!;
  const filename = feature[2]!;
  const key = filename.endsWith(".json") ? filename.slice(0, -5) : filename;
  if (
    !filename.endsWith(".json") ||
    key.length > MAX_KEY_LENGTH ||
    key.split(".").some((segment) => segment.length === 0) ||
    !featureKeySchema.safeParse(key).success
  ) {
    throw new RequestError("invalid_key", key || filename || path);
  }
  return { type: "artifact", snapshot, suffix: `${resource}/${key}.json`, key };
}

/** RFC 9110 §13.1.2: weak comparison for GET/HEAD, including tag lists. */
export function matchesIfNoneMatch(value: string | null, etag: string): boolean {
  if (value === null) return false;
  if (value.trim() === "*") return true;
  let matched = false;
  let cursor = 0;
  let count = 0;
  while (cursor < value.length) {
    while (value[cursor] === " " || value[cursor] === "\t" || value[cursor] === ",") cursor += 1;
    if (cursor === value.length) break;
    if (value.slice(cursor, cursor + 2) === "W/") cursor += 2;
    if (value[cursor] !== '"') return false;
    const start = cursor;
    cursor += 1;
    while (cursor < value.length && value[cursor] !== '"') {
      const char = value.charCodeAt(cursor);
      if (char < 0x21 || char > 0xff || char === 0x7f) return false;
      cursor += 1;
    }
    if (value[cursor] !== '"') return false;
    cursor += 1;
    matched ||= value.slice(start, cursor) === etag;
    count += 1;
    while (value[cursor] === " " || value[cursor] === "\t") cursor += 1;
    if (cursor < value.length && value[cursor] !== ",") return false;
  }
  return count > 0 && matched;
}

function headers(etag: string, cache: string): Headers {
  return new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": cache,
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "etag, retry-after",
    "x-content-type-options": "nosniff",
    etag,
  });
}

async function digest(body: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", body));
  return `"${Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("")}"`;
}

async function jsonResponse(
  request: Request,
  status: number,
  body: unknown,
  cache: string,
  extra?: Record<string, string>,
): Promise<Response> {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const responseHeaders = headers(await digest(bytes), cache);
  for (const [name, value] of Object.entries(extra ?? {})) responseHeaders.set(name, value);
  responseHeaders.set("content-length", String(bytes.length));
  return new Response(request.method === "HEAD" ? null : bytes, {
    status,
    headers: responseHeaders,
  });
}

function contractError(
  request: Request,
  code: ApiErrorCode,
  query: string | null,
  retryAfter?: number,
): Promise<Response> {
  const messages: Record<ApiErrorCode, string> = {
    invalid_key: "The requested key is invalid.",
    feature_not_found: `No compatibility data for key '${query}'.`,
    namespace_not_queryable: `Key '${query}' is an organizational namespace, not a queryable feature.`,
    snapshot_not_found: `Snapshot '${query}' does not exist or has been retired.`,
    rate_limited: "Request rate limit exceeded.",
    generation_in_progress: "Artifact generation is in progress.",
  };
  const status =
    code === "invalid_key"
      ? 400
      : code === "rate_limited"
        ? 429
        : code === "generation_in_progress"
          ? 503
          : 404;
  const body = apiErrorResponseSchema.parse({ error: { code, message: messages[code], query } });
  return jsonResponse(
    request,
    status,
    body,
    status >= 429 ? "no-store" : ERROR_CACHE,
    retryAfter === undefined ? undefined : { "retry-after": String(retryAfter) },
  );
}

async function assertArtifact(artifact: Artifact): Promise<void> {
  if (
    !STRONG_ETAG.test(artifact.etag) ||
    (artifact.size !== undefined && (!Number.isSafeInteger(artifact.size) || artifact.size < 0))
  ) {
    await artifact.body.cancel();
    throw new Error("Storage returned invalid artifact metadata.");
  }
}

async function serveArtifact(
  request: Request,
  artifact: Artifact,
  cache: string,
): Promise<Response> {
  await assertArtifact(artifact);
  const responseHeaders = headers(artifact.etag, cache);
  if (artifact.size !== undefined) responseHeaders.set("content-length", String(artifact.size));
  const notModified = matchesIfNoneMatch(request.headers.get("if-none-match"), artifact.etag);
  if (request.method === "HEAD" || notModified) {
    await artifact.body.cancel();
    return new Response(null, { status: notModified ? 304 : 200, headers: responseHeaders });
  }
  return new Response(artifact.body, { status: 200, headers: responseHeaders });
}

async function boundedJson(artifact: Artifact, limit: number): Promise<unknown> {
  await assertArtifact(artifact);
  if (artifact.size !== undefined && artifact.size > limit) {
    await artifact.body.cancel();
    throw new Error("Artifact exceeds bounded JSON limit.");
  }
  const reader = artifact.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength === 0) continue;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new Error("Artifact exceeds bounded JSON limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let cursor = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, cursor);
    cursor += chunk.length;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

/** No BCD dependency or normalization: successful payloads pass through unchanged. */
export function createArtifactHandler(
  options: ArtifactHandlerOptions,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      const route = parseRoute(request.url);
      if (route === null)
        return jsonResponse(request, 404, { error: { message: "Route not found." } }, "no-store");
      if (request.method === "OPTIONS") {
        const responseHeaders = headers('"options-v1"', "no-store");
        responseHeaders.set("allow", METHODS);
        responseHeaders.set("access-control-allow-methods", METHODS);
        responseHeaders.set("access-control-allow-headers", "if-none-match");
        return new Response(null, { status: 204, headers: responseHeaders });
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        return jsonResponse(
          request,
          405,
          { error: { message: "Method not allowed." } },
          "no-store",
          { allow: METHODS },
        );
      }
      const decision = await options.beforeRead?.(request);
      if (decision?.code === "rate_limited") {
        if (!Number.isSafeInteger(decision.retryAfter) || decision.retryAfter < 0)
          throw new Error("Invalid rate-limit retry delay.");
        return contractError(request, decision.code, null, decision.retryAfter);
      }
      if (decision?.code === "generation_in_progress")
        return contractError(request, decision.code, null);
      const metaArtifact = await options.store.get("v1/meta.json");
      if (metaArtifact === null) throw new Error("Artifact metadata missing.");
      if (route.type === "meta") return await serveArtifact(request, metaArtifact, CURRENT_CACHE);
      const metadata = metaResponseSchema.parse(
        await boundedJson(metaArtifact, MAX_METADATA_BYTES),
      );
      const selected = route.snapshot === "current" ? metadata.current : route.snapshot;
      const selectedSnapshot = metadata.snapshots.find((snapshot) => snapshot.id === selected);
      if (selectedSnapshot === undefined)
        return contractError(request, "snapshot_not_found", route.snapshot);
      const artifact = await options.store.get(`v1/${selected}/${route.suffix}`);
      if (artifact !== null)
        return await serveArtifact(
          request,
          artifact,
          route.snapshot === "current" ? CURRENT_CACHE : PINNED_CACHE,
        );
      if (route.key === null) {
        // A missing optional shard is a transport 404; other structural artifacts are corrupt.
        if (route.suffix.startsWith("index/")) {
          const namespace = route.suffix.slice(6, -5);
          if (selected === metadata.current && metadata.namespaces.includes(namespace))
            throw new Error("Required current index shard missing.");
          return jsonResponse(
            request,
            404,
            { error: { message: "Index shard not found." } },
            ERROR_CACHE,
          );
        }
        throw new Error("Required snapshot artifact missing.");
      }
      const namespace = route.key.split(".", 1)[0]!;
      const shardArtifact = await options.store.get(`v1/${selected}/index/${namespace}.json`);
      if (shardArtifact === null) {
        if (selected === metadata.current && metadata.namespaces.includes(namespace))
          throw new Error("Required current index shard missing.");
        return contractError(request, "feature_not_found", route.key);
      }
      const shard = indexResponseSchema.parse(
        await boundedJson(shardArtifact, MAX_INDEX_SHARD_BYTES),
      );
      if (shard.namespace !== namespace) throw new Error("Index shard namespace mismatch.");
      if (shard.source.version !== selectedSnapshot.source.version)
        throw new Error("Index shard source version mismatch.");
      let grouping = false;
      const prefix = `${route.key}.`;
      for (const key of shard.keys) {
        if (key === route.key) throw new Error("Indexed artifact missing.");
        if (key.startsWith(prefix)) grouping = true;
      }
      return contractError(
        request,
        grouping ? "namespace_not_queryable" : "feature_not_found",
        route.key,
      );
    } catch (error) {
      if (error instanceof RequestError) return contractError(request, error.code, error.query);
      // Reporting failures must not replace the safe transport failure response.
      try {
        void Promise.resolve(options.onError?.(error)).catch(() => {
          // Isolate async reporting failures without delaying the HTTP response.
        });
      } catch {
        /* Reporter isolation. */
      }
      return jsonResponse(
        request,
        500,
        { error: { message: "Artifact service unavailable." } },
        "no-store",
      );
    }
  };
}
