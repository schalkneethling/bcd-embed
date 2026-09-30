import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_MS = 5_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 30_000;
const MAX_PROBES = 24;
const MAX_TOTAL_DURATION_MS = 120_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_RESPONSE_BYTES = 32 * 1024 * 1024;
const PROBE_ORIGIN = "https://bcd-embed-verification.invalid";
const FEATURE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._$@-]*$/;
const NAMESPACE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const SNAPSHOT_ID_PATTERN = /^bcd-[A-Za-z0-9.-]+-gen-[A-Za-z0-9.-]+$/;

export const usage = `Usage: node packages/server/scripts/verify-endpoint.mjs --base-url <http(s)://host[:port]> [--allow-remote] [--local-identity-only] [--timeout-ms <100..30000>]

Verify a running bcd-embed v1 endpoint using bounded, sequential GET, HEAD, and OPTIONS requests.
The base URL must be an origin with no path, query, or fragment. Non-loopback HTTPS endpoints
require the explicit --allow-remote opt-in. --local-identity-only skips compressed probes and is
restricted to loopback endpoints. No endpoint is built into this command.`;

const invalid = (message) => {
  throw new Error(`${message}\n${usage}`);
};

const localHostname = (hostname) => {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost") return true;
  const unbracketed =
    normalized.startsWith("[") && normalized.endsWith("]") ? normalized.slice(1, -1) : normalized;
  const addressType = isIP(unbracketed);
  if (addressType === 4) return Number(unbracketed.split(".")[0]) === 127;
  return addressType === 6 && unbracketed === "::1";
};

const assertSnapshotId = (value, label) => {
  if (
    typeof value !== "string" ||
    value.length > 512 ||
    value.includes("..") ||
    !SNAPSHOT_ID_PATTERN.test(value)
  ) {
    throw new Error(`${label} does not match the bounded snapshot identifier grammar.`);
  }
};

const assertFeatureKey = (value, label) => {
  if (
    typeof value !== "string" ||
    value.length > 512 ||
    value.startsWith(".") ||
    value.endsWith(".") ||
    value.includes("..") ||
    !FEATURE_KEY_PATTERN.test(value)
  ) {
    throw new Error(
      `${label} does not match the bounded feature-key grammar or has an empty dot segment.`,
    );
  }
};

const assertNamespace = (value, label) => {
  if (
    typeof value !== "string" ||
    value.length > 128 ||
    value.includes("..") ||
    !NAMESPACE_PATTERN.test(value)
  ) {
    throw new Error(`${label} does not match the bounded namespace grammar.`);
  }
};

export const parseVerifyArguments = (arguments_) => {
  if (arguments_.length === 1 && ["--help", "-h"].includes(arguments_[0] ?? "")) {
    return { type: "help" };
  }

  let baseUrl;
  let allowRemote = false;
  let localIdentityOnly = false;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  const seen = new Set();
  for (let index = 0; index < arguments_.length; index += 1) {
    const option = arguments_[index];
    if (option === "--allow-remote") {
      if (seen.has(option)) invalid("Argument '--allow-remote' may only be provided once.");
      seen.add(option);
      allowRemote = true;
      continue;
    }
    if (option === "--local-identity-only") {
      if (seen.has(option)) invalid("Argument '--local-identity-only' may only be provided once.");
      seen.add(option);
      localIdentityOnly = true;
      continue;
    }
    if (!["--base-url", "--timeout-ms"].includes(option ?? "")) {
      invalid(`Unknown argument '${option ?? ""}'.`);
    }
    if (seen.has(option)) invalid(`Argument '${option}' may only be provided once.`);
    seen.add(option);
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith("--")) {
      invalid(`Argument '${option}' requires a value.`);
    }
    index += 1;
    if (option === "--base-url") {
      baseUrl = value;
      continue;
    }
    const parsedTimeout = Number(value);
    if (
      !Number.isSafeInteger(parsedTimeout) ||
      parsedTimeout < MIN_TIMEOUT_MS ||
      parsedTimeout > MAX_TIMEOUT_MS
    ) {
      invalid(
        `--timeout-ms must be a whole number from ${MIN_TIMEOUT_MS} through ${MAX_TIMEOUT_MS}.`,
      );
    }
    timeoutMs = parsedTimeout;
  }

  if (baseUrl === undefined) invalid("--base-url is required.");

  let parsedBase;
  try {
    parsedBase = new URL(baseUrl);
  } catch {
    invalid("--base-url must be an absolute HTTP or HTTPS URL.");
  }
  if (!["http:", "https:"].includes(parsedBase.protocol)) {
    invalid("--base-url must use HTTP or HTTPS.");
  }
  if (
    parsedBase.username !== "" ||
    parsedBase.password !== "" ||
    parsedBase.pathname !== "/" ||
    parsedBase.search !== "" ||
    parsedBase.hash !== ""
  ) {
    invalid("--base-url must contain an origin only (no credentials, path, query, or fragment).");
  }
  const remoteTarget = !localHostname(parsedBase.hostname);
  if (localIdentityOnly && remoteTarget) {
    invalid("--local-identity-only is restricted to loopback endpoints.");
  }
  if (remoteTarget) {
    if (!allowRemote) invalid("A non-loopback endpoint requires explicit --allow-remote opt-in.");
    if (parsedBase.protocol !== "https:") {
      invalid("A non-loopback endpoint must use HTTPS, even with --allow-remote.");
    }
  }

  return {
    type: "verify",
    baseUrl: parsedBase.origin,
    allowRemote,
    localIdentityOnly,
    timeoutMs,
  };
};

const header = (response, name) => {
  const value = response.headers[name.toLowerCase()];
  return Array.isArray(value) ? value.join(", ") : value;
};

const requestRaw = (baseUrl, requestPath, { method = "GET", headers = {}, timeoutMs }) =>
  new Promise((resolvePromise, rejectPromise) => {
    if (!requestPath.startsWith("/") || requestPath.includes("\r") || requestPath.includes("\n")) {
      rejectPromise(new Error(`Refusing unsafe HTTP request target '${requestPath}'.`));
      return;
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      rejectPromise(new Error(`Refusing non-read-only verification method '${method}'.`));
      return;
    }
    const base = new URL(baseUrl);
    const hostname =
      base.hostname.startsWith("[") && base.hostname.endsWith("]")
        ? base.hostname.slice(1, -1)
        : base.hostname;
    const request = (base.protocol === "https:" ? httpsRequest : httpRequest)({
      protocol: base.protocol,
      hostname,
      port: base.port || undefined,
      method,
      path: requestPath,
      headers: {
        accept: "application/json",
        "accept-encoding": "identity",
        origin: PROBE_ORIGIN,
        "user-agent": "bcd-embed-endpoint-verifier/1",
        ...headers,
      },
    });

    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectPromise(error);
      else resolvePromise(result);
    };
    const timer = setTimeout(() => {
      request.destroy(new Error(`${method} ${requestPath} exceeded ${timeoutMs} ms.`));
    }, timeoutMs);
    timer.unref?.();
    request.on("error", (error) => finish(error));
    request.on("response", (response) => {
      const chunks = [];
      let bytes = 0;
      response.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          request.destroy(
            new Error(
              `${method} ${requestPath} exceeded the ${MAX_RESPONSE_BYTES}-byte response limit.`,
            ),
          );
          return;
        }
        chunks.push(chunk);
      });
      response.on("aborted", () =>
        finish(new Error(`${method} ${requestPath} response was aborted.`)),
      );
      response.on("error", (error) => finish(error));
      response.on("end", () => {
        finish(undefined, {
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    request.end();
  });

const parseJson = (response, requestPath) => {
  const contentType = header(response, "content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new Error(`${requestPath} did not return an application/json content type.`);
  }
  const encoding = header(response, "content-encoding");
  if (encoding !== undefined && encoding !== "identity") {
    throw new Error(`Expected an identity response for ${requestPath}; received '${encoding}'.`);
  }
  try {
    return JSON.parse(response.body.toString("utf8"));
  } catch (cause) {
    throw new Error(`${requestPath} did not return valid JSON.`, { cause });
  }
};

const assertStatus = (response, expected, requestPath, method = "GET") => {
  if (response.status !== expected) {
    throw new Error(
      `${method} ${requestPath}: expected HTTP ${expected}, received ${response.status}.`,
    );
  }
};

const assertCors = (response, requestPath) => {
  if (header(response, "access-control-allow-origin") !== "*") {
    throw new Error(`${requestPath} is missing 'access-control-allow-origin: *'.`);
  }
  const exposed = (header(response, "access-control-expose-headers") ?? "").toLowerCase();
  if (!exposed.split(/,\s*/).includes("etag")) {
    throw new Error(`${requestPath} does not expose the ETag response header through CORS.`);
  }
};

const cacheDirectives = (response) =>
  (header(response, "cache-control") ?? "")
    .split(",")
    .map((directive) => directive.trim().toLowerCase())
    .filter(Boolean)
    .sort();

const hasExactCachePolicy = (response, expected) => {
  const actual = cacheDirectives(response);
  const expectedWithPublic = [...expected, "public"].sort();
  return (
    actual.join(",") === [...expected].sort().join(",") ||
    actual.join(",") === expectedWithPublic.join(",")
  );
};

const assertCurrentCache = (response, requestPath) => {
  const actual = header(response, "cache-control") ?? "";
  if (!hasExactCachePolicy(response, ["max-age=86400", "stale-while-revalidate=604800"])) {
    throw new Error(`${requestPath} has unexpected current cache policy '${actual}'.`);
  }
};

const assertPinnedCache = (response, requestPath) => {
  const actual = header(response, "cache-control") ?? "";
  if (!hasExactCachePolicy(response, ["max-age=31536000", "immutable"])) {
    throw new Error(`${requestPath} has unexpected pinned cache policy '${actual}'.`);
  }
};

const assertErrorCache = (response, requestPath) => {
  const actual = header(response, "cache-control") ?? "";
  if (!hasExactCachePolicy(response, ["max-age=3600"])) {
    throw new Error(`${requestPath} has unexpected error cache policy '${actual}'.`);
  }
};

const assertStrongEtag = (response, requestPath) => {
  const etag = header(response, "etag");
  if (etag === undefined || !etag.startsWith('"') || !etag.endsWith('"') || etag.startsWith("W/")) {
    throw new Error(`${requestPath} did not return a strong ETag.`);
  }
  return etag;
};

const assertSuccess = (response, requestPath) => {
  assertStatus(response, 200, requestPath);
  assertCors(response, requestPath);
  return response;
};

const parseError = (response, expectedStatus, expectedCode, requestPath) => {
  assertStatus(response, expectedStatus, requestPath);
  assertCors(response, requestPath);
  assertErrorCache(response, requestPath);
  const body = parseJson(response, requestPath);
  if (
    !body ||
    typeof body !== "object" ||
    !body.error ||
    Object.keys(body).length !== 1 ||
    Object.keys(body.error).sort().join(",") !== "code,message,query" ||
    body.error.code !== expectedCode ||
    typeof body.error.message !== "string" ||
    !(typeof body.error.query === "string" || body.error.query === null)
  ) {
    throw new Error(`${requestPath} returned an invalid ${expectedCode} error response.`);
  }
  return body.error;
};

const expectJsonGet = async (context, requestPath, status = 200) => {
  const response = await context.request(requestPath);
  assertStatus(response, status, requestPath);
  assertCors(response, requestPath);
  return { response, value: parseJson(response, requestPath) };
};

export const verifyEndpoint = async ({
  baseUrl,
  allowRemote,
  localIdentityOnly = false,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) => {
  const base = parseVerifyArguments([
    "--base-url",
    baseUrl,
    ...(allowRemote ? ["--allow-remote"] : []),
    ...(localIdentityOnly ? ["--local-identity-only"] : []),
    "--timeout-ms",
    String(timeoutMs),
  ]);
  if (base.type !== "verify") throw new Error("Internal verifier configuration error.");

  const remoteTarget = !localHostname(new URL(base.baseUrl).hostname);
  const deadline = Date.now() + MAX_TOTAL_DURATION_MS;
  const context = {
    probes: 0,
    responseBytes: 0,
    async request(requestPath, options = {}) {
      if (this.probes >= MAX_PROBES)
        throw new Error(`Probe plan exceeded its ${MAX_PROBES}-request bound.`);
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new Error(`Probe plan exceeded its ${MAX_TOTAL_DURATION_MS} ms total-time bound.`);
      }
      this.probes += 1;
      const response = await requestRaw(base.baseUrl, requestPath, {
        ...options,
        timeoutMs: Math.min(base.timeoutMs, remainingMs),
      });
      this.responseBytes += response.body.length;
      if (this.responseBytes > MAX_TOTAL_RESPONSE_BYTES) {
        throw new Error(
          `Probe plan exceeded its ${MAX_TOTAL_RESPONSE_BYTES}-byte total response bound.`,
        );
      }
      return response;
    },
  };

  const checks = [];
  const record = (name) => checks.push(name);
  const metaPath = "/v1/meta.json";
  const { response: metaResponse, value: meta } = await expectJsonGet(context, metaPath);
  assertCurrentCache(metaResponse, metaPath);
  assertStrongEtag(metaResponse, metaPath);
  if (
    !meta ||
    typeof meta !== "object" ||
    typeof meta.current !== "string" ||
    !Array.isArray(meta.snapshots) ||
    !Array.isArray(meta.namespaces) ||
    !meta.snapshots.some((snapshot) => snapshot?.id === meta.current)
  ) {
    throw new Error("/v1/meta.json does not identify a current snapshot and snapshot list.");
  }
  record("metadata/current snapshot");

  const snapshot = meta.snapshots.find((candidate) => candidate?.id === meta.current);
  const pinnedId = snapshot.id;
  assertSnapshotId(meta.current, "Metadata current snapshot ID");
  assertSnapshotId(pinnedId, "Metadata pinned snapshot ID");
  const fullIndexPath = "/v1/current/index.json";
  const { response: fullIndexResponse, value: fullIndex } = await expectJsonGet(
    context,
    fullIndexPath,
  );
  assertCurrentCache(fullIndexResponse, fullIndexPath);
  assertStrongEtag(fullIndexResponse, fullIndexPath);
  if (
    fullIndex?.namespace !== null ||
    !Array.isArray(fullIndex?.keys) ||
    fullIndex.keys.length === 0
  ) {
    throw new Error(`${fullIndexPath} did not return a non-empty full index.`);
  }
  for (const indexedKey of fullIndex.keys) {
    assertFeatureKey(indexedKey, `${fullIndexPath} key`);
  }
  const key = fullIndex.keys[0];
  assertFeatureKey(key, `${fullIndexPath} first key`);
  const namespace = key.split(".")[0];
  assertNamespace(namespace, "Discovered namespace");
  for (const listedNamespace of meta.namespaces) {
    assertNamespace(listedNamespace, "Metadata namespace");
  }
  if (!meta.namespaces.includes(namespace)) {
    throw new Error(`Metadata does not list the selected namespace '${namespace}'.`);
  }
  record("full index/key discovery");

  const currentBrowsersPath = "/v1/current/browsers.json";
  const { response: currentBrowsersResponse, value: currentBrowsers } = await expectJsonGet(
    context,
    currentBrowsersPath,
  );
  assertCurrentCache(currentBrowsersResponse, currentBrowsersPath);
  if (!currentBrowsers?.browsers || typeof currentBrowsers.browsers !== "object") {
    throw new Error(`${currentBrowsersPath} does not contain browser metadata.`);
  }
  record("current browser metadata");

  const shardPath = `/v1/current/index/${namespace}.json`;
  const { response: shardResponse, value: shard } = await expectJsonGet(context, shardPath);
  assertCurrentCache(shardResponse, shardPath);
  if (shard?.namespace !== namespace || !Array.isArray(shard.keys) || !shard.keys.includes(key)) {
    throw new Error(`${shardPath} does not contain the selected key '${key}'.`);
  }
  record("namespace shard");

  const featurePath = `/v1/current/features/${key}.json`;
  const { response: featureResponse, value: feature } = await expectJsonGet(context, featurePath);
  assertCurrentCache(featureResponse, featurePath);
  const featureEtag = assertStrongEtag(featureResponse, featurePath);
  if (
    feature?.query !== key ||
    !Array.isArray(feature.features) ||
    feature.features[0]?.key !== key
  ) {
    throw new Error(`${featurePath} does not return the selected feature as its first entry.`);
  }
  record("current feature");

  const headResponse = await context.request(featurePath, { method: "HEAD" });
  assertStatus(headResponse, 200, featurePath, "HEAD");
  assertCors(headResponse, featurePath);
  assertCurrentCache(headResponse, featurePath);
  if (
    headResponse.body.length !== 0 ||
    assertStrongEtag(headResponse, featurePath) !== featureEtag
  ) {
    throw new Error(`HEAD ${featurePath} must be bodyless and preserve the GET ETag.`);
  }
  record("HEAD");

  const conditionalResponse = await context.request(featurePath, {
    headers: { "if-none-match": featureEtag },
  });
  assertStatus(conditionalResponse, 304, featurePath);
  assertCors(conditionalResponse, featurePath);
  assertCurrentCache(conditionalResponse, featurePath);
  if (
    conditionalResponse.body.length !== 0 ||
    assertStrongEtag(conditionalResponse, featurePath) !== featureEtag
  ) {
    throw new Error(
      `Conditional GET ${featurePath} must return bodyless 304 with the matching strong ETag.`,
    );
  }
  record("If-None-Match");

  let contentEncoding = "identity";
  if (base.localIdentityOnly) {
    record("compressed probes skipped (--local-identity-only)");
  } else {
    const compressedResponse = await context.request(featurePath, {
      headers: { "accept-encoding": "br, gzip" },
    });
    assertSuccess(compressedResponse, featurePath);
    assertCurrentCache(compressedResponse, featurePath);
    const compressedEtag = assertStrongEtag(compressedResponse, featurePath);
    contentEncoding = (header(compressedResponse, "content-encoding") ?? "identity").toLowerCase();
    if (contentEncoding !== "identity" && !["br", "gzip"].includes(contentEncoding)) {
      throw new Error(`${featurePath} used unsupported compression '${contentEncoding}'.`);
    }
    if (contentEncoding !== "identity" && compressedEtag === featureEtag) {
      const sameBytes = compressedResponse.body.equals(featureResponse.body);
      throw new Error(
        `${featurePath} reused identity ETag ${featureEtag} for ${contentEncoding} response ETag ${compressedEtag}; response bodies were ${sameBytes ? "identical" : "different"} (${featureResponse.body.length} identity bytes, ${compressedResponse.body.length} encoded-response bytes). A compressed representation requires a different strong validator.`,
      );
    }
    if (remoteTarget && contentEncoding === "identity") {
      throw new Error(
        `Remote ${featurePath} did not negotiate Brotli or gzip; strong ETag behavior over compressed responses remains unverified.`,
      );
    }
    record(
      contentEncoding === "identity"
        ? "strong ETag (identity; compression unavailable locally)"
        : `strong ETag (${contentEncoding})`,
    );

    const compressedConditional = await context.request(featurePath, {
      headers: {
        "accept-encoding": "br, gzip",
        "if-none-match": compressedEtag,
      },
    });
    assertStatus(compressedConditional, 304, featurePath);
    assertCors(compressedConditional, featurePath);
    if (
      compressedConditional.body.length !== 0 ||
      assertStrongEtag(compressedConditional, featurePath) !== compressedEtag
    ) {
      throw new Error(
        `Compressed conditional GET ${featurePath} did not preserve its strong ETag.`,
      );
    }
    record("compressed If-None-Match");
  }

  const rawPath = `/v1/current/raw/${key}.json`;
  const { response: rawResponse, value: raw } = await expectJsonGet(context, rawPath);
  assertCurrentCache(rawResponse, rawPath);
  if (!raw || typeof raw !== "object" || !raw.__compat || typeof raw.__compat !== "object") {
    throw new Error(`${rawPath} does not return the untouched addressable BCD subtree.`);
  }
  record("current raw subtree");

  const pinnedFeaturePath = `/v1/${pinnedId}/features/${key}.json`;
  const { response: pinnedFeatureResponse, value: pinnedFeature } = await expectJsonGet(
    context,
    pinnedFeaturePath,
  );
  assertPinnedCache(pinnedFeatureResponse, pinnedFeaturePath);
  if (pinnedFeature?.query !== key)
    throw new Error(`${pinnedFeaturePath} returned the wrong query.`);
  record("pinned feature");

  const pinnedRawPath = `/v1/${pinnedId}/raw/${key}.json`;
  const { response: pinnedRawResponse, value: pinnedRaw } = await expectJsonGet(
    context,
    pinnedRawPath,
  );
  assertPinnedCache(pinnedRawResponse, pinnedRawPath);
  if (!pinnedRaw?.__compat) throw new Error(`${pinnedRawPath} is missing its raw subtree.`);
  record("pinned raw subtree");

  const missingKey = `${key}.__bcd_embed_verifier_missing__`;
  if (fullIndex.keys.includes(missingKey))
    throw new Error(`Verification miss key unexpectedly exists: '${missingKey}'.`);
  const missingPath = `/v1/current/features/${missingKey}.json`;
  const missingResponse = await context.request(missingPath);
  parseError(missingResponse, 404, "feature_not_found", missingPath);
  record("feature_not_found");

  const indexedKeys = new Set(fullIndex.keys);
  const namespaceKey = meta.namespaces.find((candidate) => !indexedKeys.has(candidate));
  if (namespaceKey === undefined) {
    throw new Error(
      "Every manifest namespace is also a feature key; no namespace_not_queryable path is safe to infer.",
    );
  }
  assertFeatureKey(namespaceKey, "Discovered non-addressable feature prefix");
  const namespacePath = `/v1/current/features/${namespaceKey}.json`;
  parseError(await context.request(namespacePath), 404, "namespace_not_queryable", namespacePath);
  record("namespace_not_queryable");

  let missingSnapshot = "bcd-verifier-unknown-gen-0.0.0";
  for (
    let suffix = 1;
    meta.snapshots.some((candidate) => candidate?.id === missingSnapshot);
    suffix += 1
  ) {
    missingSnapshot = `bcd-verifier-unknown-${suffix}-gen-0.0.0`;
  }
  const missingSnapshotPath = `/v1/${missingSnapshot}/features/${key}.json`;
  parseError(
    await context.request(missingSnapshotPath),
    404,
    "snapshot_not_found",
    missingSnapshotPath,
  );
  record("snapshot_not_found");

  const invalidKeyCases = ["%ZZ", "%2fsecret", "%5csecret", "%2e%2e%2fsecret", "%00"];
  for (const [index, encodedSuffix] of invalidKeyCases.entries()) {
    const invalidPath = `/v1/current/features/${namespace}.${encodedSuffix}.json`;
    parseError(await context.request(invalidPath), 400, "invalid_key", invalidPath);
    record(`invalid key encoding/traversal ${index + 1}`);
  }

  const optionsResponse = await context.request(featurePath, { method: "OPTIONS" });
  assertStatus(optionsResponse, 204, featurePath, "OPTIONS");
  assertCors(optionsResponse, featurePath);
  if (optionsResponse.body.length !== 0)
    throw new Error(`OPTIONS ${featurePath} must be bodyless.`);
  const allowMethods = (
    header(optionsResponse, "access-control-allow-methods") ?? ""
  ).toUpperCase();
  const allowed = (header(optionsResponse, "allow") ?? "").toUpperCase();
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    if (!allowMethods.split(/,\s*/).includes(method)) {
      throw new Error(`OPTIONS ${featurePath} does not allow ${method}.`);
    }
    if (!allowed.split(/,\s*/).includes(method)) {
      throw new Error(`OPTIONS ${featurePath} is missing ${method} from its Allow header.`);
    }
  }
  const allowedHeaders = (
    header(optionsResponse, "access-control-allow-headers") ?? ""
  ).toLowerCase();
  if (!allowedHeaders.split(/,\s*/).includes("if-none-match")) {
    throw new Error(`OPTIONS ${featurePath} does not allow the If-None-Match request header.`);
  }
  record("CORS preflight");

  if (context.probes > MAX_PROBES)
    throw new Error(`Probe plan used ${context.probes} requests; maximum is ${MAX_PROBES}.`);
  return {
    baseUrl: base.baseUrl,
    remote: remoteTarget,
    probes: context.probes,
    responseBytes: context.responseBytes,
    checks,
    compression: base.localIdentityOnly
      ? "skipped (--local-identity-only)"
      : remoteTarget
        ? contentEncoding
        : "local transport only; edge compression not verified",
    note: remoteTarget
      ? "Read-only remote probes were explicitly authorized by --allow-remote. Do not use this as a substitute for controlled deployment acceptance."
      : base.localIdentityOnly
        ? "Local identity-only probes intentionally skip compressed representations; they do not establish Cloudflare edge compression or strong-ETag behavior. A future explicit LIVE probe is still required."
        : "Local endpoint checks do not establish Cloudflare edge compression or strong-ETag behavior; a future explicit LIVE probe is still required.",
  };
};

const main = async () => {
  try {
    const options = parseVerifyArguments(process.argv.slice(2));
    if (options.type === "help") {
      process.stdout.write(`${usage}\n`);
      return;
    }
    const report = await verifyEndpoint(options);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
};

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
