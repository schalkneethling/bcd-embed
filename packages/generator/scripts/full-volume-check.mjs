import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  brotliCompressSync,
  brotliDecompressSync,
  constants as zlibConstants,
  gzipSync,
  gunzipSync,
} from "node:zlib";
import { cpus, platform, release, tmpdir, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { mkdtemp, opendir, readFile, rm } from "node:fs/promises";
import { basename, join, posix } from "node:path";

import bcd from "@mdn/browser-compat-data" with { type: "json" };
import Ajv from "ajv";
import addFormats from "ajv-formats";
import {
  browsersResponseSchema,
  featureResponseSchema,
  indexResponseSchema,
  metaResponseSchema,
  blobPath,
  representationPath,
  shardPath,
  shardSchema,
  snapshotRootPath,
  snapshotRootSchema,
} from "@bcd-embed/schema";
import { normalizeFeatureSubtree } from "@bcd-embed/core";
import publicSchema from "../src/upstream/public.schema.json" with { type: "json" };

const GENERATED = "2026-09-27T12:00:00Z";
const EXPIRES = "2026-12-26";
const DEFAULT_TIMEOUT_MS = 8 * 60 * 1000;
const TOP_LARGEST = 10;
const BROTLI_QUALITY = 4;
const MEMORY_SAMPLER = fileURLToPath(new URL("./process-memory-sampler.mjs", import.meta.url));
const CLI_ENTRY = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const require = createRequire(import.meta.url);
const generatorPackage = require("../package.json");

const timeoutFromEnvironment = () => {
  const rawValue = process.env.BCD_EMBED_FULL_VOLUME_TIMEOUT_MS;
  if (rawValue === undefined) return DEFAULT_TIMEOUT_MS;
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("BCD_EMBED_FULL_VOLUME_TIMEOUT_MS must be a positive integer.");
  }
  return value;
};

const upstreamAjv = new Ajv({ strict: true, strictRequired: false, allErrors: false });
addFormats(upstreamAjv, { mode: "fast" });
upstreamAjv.addKeyword({ keyword: "tsType", schemaType: "string", valid: true });
upstreamAjv.addSchema(publicSchema, "bcd-public-full-volume-check");
const validateIdentifier = upstreamAjv.compile({
  $ref: "bcd-public-full-volume-check#/definitions/identifier",
});

const fail = (message, cause) => {
  throw new Error(message, cause === undefined ? undefined : { cause });
};

const summarizeZodIssues = (issues) =>
  issues
    .slice(0, 4)
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("; ");

const expectedSource = new Map();
const expectedByNamespace = new Map();
let maximumKeyLength = 0;

const visitSource = (key, node, namespace) => {
  if (Object.hasOwn(node, "__compat")) {
    if (expectedSource.has(key)) fail(`Duplicate source addressable key '${key}'.`);
    expectedSource.set(key, node);
    const namespaceKeys = expectedByNamespace.get(namespace) ?? [];
    namespaceKeys.push(key);
    expectedByNamespace.set(namespace, namespaceKeys);
    maximumKeyLength = Math.max(maximumKeyLength, Buffer.byteLength(key));
  }
  for (const [segment, child] of Object.entries(node)) {
    if (segment !== "__compat") visitSource(`${key}.${segment}`, child, namespace);
  }
};

for (const [namespace, tree] of Object.entries(bcd)) {
  if (namespace !== "__meta" && namespace !== "browsers") {
    visitSource(namespace, tree, namespace);
  }
}

const sourceKeys = [...expectedSource.keys()];
const sourceNamespaces = [...expectedByNamespace.keys()];
/** Served files in a snapshot: two per key, one index per namespace, index.json and browsers.json. */
const servedFileCount = (keyCount, namespaceCount) => keyCount * 2 + namespaceCount + 2;
const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");
/** Computed here, not imported from the generator, so the check is independent of it. */
const shardIndexOf = (key) => createHash("sha256").update(key, "utf8").digest()[0];

const waitForCli = (outputRoot, timeoutMs) =>
  new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const child = fork(
      CLI_ENTRY,
      ["--out", outputRoot, "--generated", GENERATED, "--expires", EXPIRES],
      {
        execArgv: ["--import", MEMORY_SAMPLER],
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    let stdout = "";
    let stderr = "";
    let peakRssBytes = null;
    let timedOut = false;
    let killTimer;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      killTimer.unref();
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      if (stdout.length < 64_000) stdout += chunk.toString("utf8").slice(0, 64_000 - stdout.length);
    });
    child.stderr?.on("data", (chunk) => {
      if (stderr.length < 64_000) stderr += chunk.toString("utf8").slice(0, 64_000 - stderr.length);
    });
    child.on("message", (message) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "peakRssBytes" in message &&
        typeof message.peakRssBytes === "number"
      ) {
        peakRssBytes =
          peakRssBytes === null
            ? message.peakRssBytes
            : Math.max(peakRssBytes, message.peakRssBytes);
      }
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      reject(new Error("Unable to start the generator CLI.", { cause: error }));
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      const durationMs = Math.round(performance.now() - startedAt);
      if (timedOut) {
        reject(
          new Error(
            `Full-volume generation exceeded ${timeoutMs} ms and was terminated.\n${stderr}`,
          ),
        );
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            `Generator CLI failed with exit code ${code ?? "unknown"} (${signal ?? "no signal"}).\n${stderr || stdout}`,
          ),
        );
        return;
      }
      resolve({ durationMs, peakRssBytes, stderr, stdout });
    });
  });

const validateZodArtifact = (schema, value, path) => {
  const result = schema.safeParse(value);
  if (!result.success)
    fail(`Schema validation failed for '${path}': ${summarizeZodIssues(result.error.issues)}`);
  return result.data;
};

// A body must not name its release: identical data must have identical bytes in every snapshot.
const assertEnvelope = (value, path) => {
  if (Object.hasOwn(value, "generated") || Object.hasOwn(value, "source")) {
    fail(`Artifact '${path}' names its release in the body.`);
  }
};

const assertExactArray = (actual, expected, path) => {
  if (!Array.isArray(actual) || actual.length !== expected.length) {
    fail(
      `Index '${path}' has ${Array.isArray(actual) ? actual.length : "a non-array"} keys; expected ${expected.length}.`,
    );
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] !== expected[index]) {
      fail(
        `Index '${path}' differs at position ${index}: expected '${expected[index]}', received '${actual[index]}'.`,
      );
    }
  }
};

const parseFeatureKey = (relativePath, snapshotPrefix) => {
  const remainder = relativePath.slice(snapshotPrefix.length);
  for (const [kind, directory] of [
    ["feature", "features"],
    ["raw", "raw"],
  ]) {
    const prefix = `${directory}/`;
    if (remainder.startsWith(prefix) && remainder.endsWith(".json")) {
      return { kind, key: remainder.slice(prefix.length, -".json".length) };
    }
  }
  return undefined;
};

const expectedFeatureKeys = (rootKey, rootNode) => {
  const result = [];
  const visit = (key, node, depth) => {
    if (Object.hasOwn(node, "__compat")) {
      result.push({ key, depth, supportTargets: Object.keys(node.__compat.support) });
    }
    for (const [segment, child] of Object.entries(node)) {
      if (segment !== "__compat") visit(`${key}.${segment}`, child, depth + 1);
    }
  };
  visit(rootKey, rootNode, 0);
  return result;
};

const validateAndMeasureOutput = async (outputRoot, snapshotId, cliResult) => {
  const snapshotPrefix = `v1/${snapshotId}/`;
  // The request paths the snapshot must answer, derived from BCD and not from the output.
  const identityPaths = new Set([
    "v1/meta.json",
    `${snapshotPrefix}browsers.json`,
    `${snapshotPrefix}index.json`,
  ]);
  for (const key of sourceKeys) {
    identityPaths.add(`${snapshotPrefix}features/${key}.json`);
    identityPaths.add(`${snapshotPrefix}raw/${key}.json`);
  }
  for (const namespace of sourceNamespaces) {
    identityPaths.add(`${snapshotPrefix}index/${namespace}.json`);
  }
  // The files that must be on disk. Filled in as pointers are resolved.
  const expectedPaths = new Set();

  const actualPaths = new Set();
  const consumedPaths = new Set();
  const totals = {
    artifacts: 0,
    compactBytes: 0,
    diskBytes: 0,
    gzipBytes: 0,
    brotliBytes: 0,
    parsedArtifacts: 0,
    jsonParseMs: 0,
    largestPayloads: [],
    namespaceIndexes: {},
    array: {},
    runnerPeakObservedRssBytes: process.memoryUsage().rss,
  };
  const sampleRunnerRss = () => {
    totals.runnerPeakObservedRssBytes = Math.max(
      totals.runnerPeakObservedRssBytes,
      process.memoryUsage().rss,
    );
  };

  /** Reads a file the snapshot names and records that it must exist. */
  const readExpected = async (path) => {
    expectedPaths.add(path);
    try {
      return await readFile(join(outputRoot, path));
    } catch (cause) {
      fail(`Generated file '${path}' is missing.`, cause);
    }
  };
  const assertEncodings = async (plain, pathFor) => {
    for (const encoding of ["br", "gzip"]) {
      const path = pathFor(encoding);
      const encoded = await readExpected(path);
      const decoded = encoding === "br" ? brotliDecompressSync(encoded) : gunzipSync(encoded);
      if (!decoded.equals(plain)) fail(`Representation contents mismatch at '${path}'.`);
    }
  };
  const verifiedBlobs = new Set();
  /** Returns the plain bytes a pointer names, checking the blob's three files once. */
  const readBlob = async (sha256, relativePath) => {
    if (typeof sha256 !== "string") fail(`No pointer for '${relativePath}'.`);
    const plain = await readExpected(blobPath(sha256, "identity"));
    if (!verifiedBlobs.has(sha256)) {
      verifiedBlobs.add(sha256);
      if (sha256Hex(plain) !== sha256)
        fail(`Blob for '${relativePath}' does not hash to its name.`);
      await assertEncodings(plain, (encoding) => blobPath(sha256, encoding));
    }
    return plain;
  };

  /** Validates one served file. `relativePath` is its request path; `diskBuffer` its plain bytes. */
  const consumeFile = async (relativePath, diskBuffer) => {
    if (consumedPaths.has(relativePath)) fail(`Duplicate generated path '${relativePath}'.`);
    consumedPaths.add(relativePath);
    const diskText = diskBuffer.toString("utf8");
    let value;
    const isArrayArtifact =
      relativePath === `${snapshotPrefix}features/javascript.builtins.Array.json` ||
      relativePath === `${snapshotPrefix}raw/javascript.builtins.Array.json`;
    if (isArrayArtifact && typeof globalThis.gc === "function") globalThis.gc();
    const heapBefore = process.memoryUsage().heapUsed;
    const parseStartedAt = performance.now();
    try {
      value = JSON.parse(diskText);
    } catch (cause) {
      fail(`Generated artifact '${relativePath}' is not valid JSON.`, cause);
    }
    const parseMs = performance.now() - parseStartedAt;
    const heapAfter = process.memoryUsage().heapUsed;
    totals.jsonParseMs += parseMs;
    totals.parsedArtifacts += 1;
    sampleRunnerRss();

    const featureInfo = parseFeatureKey(relativePath, snapshotPrefix);
    if (featureInfo?.kind === "feature") {
      const response = validateZodArtifact(featureResponseSchema, value, relativePath);
      assertEnvelope(response, relativePath);
      if (response.query !== featureInfo.key)
        fail(`Feature path '${relativePath}' disagrees with query '${response.query}'.`);
      const sourceNode = expectedSource.get(featureInfo.key);
      if (sourceNode === undefined)
        fail(`Feature artifact '${relativePath}' has no addressable source node.`);
      const expectedFeatures = expectedFeatureKeys(featureInfo.key, sourceNode);
      const expectedNormalizedFeatures = featureResponseSchema.parse({
        ...response,
        ...normalizeFeatureSubtree({
          key: featureInfo.key,
          subtree: sourceNode,
          browsers: bcd.browsers,
        }),
      }).features;
      if (response.features.length !== expectedFeatures.length) {
        fail(
          `Feature artifact '${relativePath}' contains ${response.features.length} entries; expected ${expectedFeatures.length} addressable source descendants.`,
        );
      }
      for (let index = 0; index < expectedFeatures.length; index += 1) {
        const expected = expectedFeatures[index];
        const actual = response.features[index];
        if (actual?.key !== expected?.key || actual?.depth !== expected?.depth) {
          fail(
            `Feature artifact '${relativePath}' differs at feature ${index}: expected '${expected?.key}' depth ${expected?.depth}, received '${actual?.key}' depth ${actual?.depth}.`,
          );
        }
        assertExactArray(
          Object.keys(actual?.support ?? {}),
          expected?.supportTargets ?? [],
          `${relativePath}#${expected?.key} support targets`,
        );
        if (!isDeepStrictEqual(actual, expectedNormalizedFeatures[index])) {
          fail(
            `Feature artifact '${relativePath}' has incorrect normalized content for '${expected?.key}'.`,
          );
        }
      }
      const referencedTargets = [
        ...new Set(expectedFeatures.flatMap(({ supportTargets }) => supportTargets)),
      ];
      assertExactArray(
        Object.keys(response.browsers),
        referencedTargets,
        `${relativePath} embedded browser metadata`,
      );
      for (const target of referencedTargets) {
        const sourceBrowser = bcd.browsers[target];
        const responseBrowser = response.browsers[target];
        const expectedBrowser = {
          name: sourceBrowser.name,
          type: sourceBrowser.type,
          previewName: sourceBrowser.preview_name ?? null,
        };
        if (!isDeepStrictEqual(responseBrowser, expectedBrowser)) {
          fail(
            `Feature artifact '${relativePath}' has incorrect metadata for support target '${target}'.`,
          );
        }
      }
      const compact = Buffer.from(JSON.stringify(response));
      const payload = {
        path: relativePath,
        kind: "feature",
        diskBytes: diskBuffer.length,
        compactBytes: compact.length,
        gzipBytes: gzipSync(diskBuffer, { level: 6 }).length,
        brotliBytes: brotliCompressSync(diskBuffer, {
          params: { [zlibConstants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY },
        }).length,
      };
      addPayloadMetrics(totals, payload);
      if (featureInfo.key === "javascript.builtins.Array") {
        totals.array.normalized = {
          ...payload,
          jsonParseMs: Number(parseMs.toFixed(3)),
          heapBeforeBytes: heapBefore,
          heapAfterBytes: heapAfter,
          heapDeltaBytes: heapAfter - heapBefore,
        };
      }
      totals.diskBytes += diskBuffer.length;
      sampleRunnerRss();
      return;
    }

    if (featureInfo?.kind === "raw") {
      const sourceNode = expectedSource.get(featureInfo.key);
      if (sourceNode === undefined)
        fail(`Raw artifact '${relativePath}' has no addressable source node.`);
      if (!validateIdentifier(value)) {
        fail(
          `Published BCD identifier schema rejected '${relativePath}': ${upstreamAjv.errorsText(validateIdentifier.errors)}.`,
        );
      }
      if (!Object.hasOwn(value, "__compat"))
        fail(`Raw artifact '${relativePath}' is not addressable at its root.`);
      if (JSON.stringify(value) !== JSON.stringify(sourceNode))
        fail(
          `Raw artifact '${relativePath}' differs from its source BCD subtree or document order.`,
        );
      const compact = Buffer.from(JSON.stringify(value));
      const payload = {
        path: relativePath,
        kind: "raw",
        diskBytes: diskBuffer.length,
        compactBytes: compact.length,
        gzipBytes: gzipSync(diskBuffer, { level: 6 }).length,
        brotliBytes: brotliCompressSync(diskBuffer, {
          params: { [zlibConstants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY },
        }).length,
      };
      addPayloadMetrics(totals, payload);
      if (featureInfo.key === "javascript.builtins.Array") {
        totals.array.raw = {
          ...payload,
          jsonParseMs: Number(parseMs.toFixed(3)),
          heapBeforeBytes: heapBefore,
          heapAfterBytes: heapAfter,
          heapDeltaBytes: heapAfter - heapBefore,
        };
      }
      totals.diskBytes += diskBuffer.length;
      sampleRunnerRss();
      return;
    }

    if (relativePath === `${snapshotPrefix}browsers.json`) {
      const browsers = validateZodArtifact(browsersResponseSchema, value, relativePath);
      assertEnvelope(browsers, relativePath);
      const sourceTargets = Object.keys(bcd.browsers);
      const generatedTargets = Object.keys(browsers.browsers);
      assertExactArray(generatedTargets, sourceTargets, relativePath);
      for (const target of sourceTargets) {
        const sourceBrowser = bcd.browsers[target];
        const actualBrowser = browsers.browsers[target];
        const expectedBrowser = {
          name: sourceBrowser.name,
          type: sourceBrowser.type,
          previewName: sourceBrowser.preview_name ?? null,
          releases: Object.entries(sourceBrowser.releases).map(([version, release]) => ({
            version,
            releaseDate: release.release_date ?? null,
            status: release.status,
          })),
        };
        if (!isDeepStrictEqual(actualBrowser, expectedBrowser)) {
          fail(
            `Browser metadata artifact '${relativePath}' differs for support target '${target}'.`,
          );
        }
      }
    } else if (relativePath === `${snapshotPrefix}index.json`) {
      const index = validateZodArtifact(indexResponseSchema, value, relativePath);
      assertEnvelope(index, relativePath);
      if (index.namespace !== null)
        fail(`Full index '${relativePath}' does not have a null namespace.`);
      assertExactArray(index.keys, sourceKeys, relativePath);
      totals.namespaceIndexes.$all = { entries: index.keys.length };
    } else if (relativePath.startsWith(`${snapshotPrefix}index/`)) {
      const index = validateZodArtifact(indexResponseSchema, value, relativePath);
      assertEnvelope(index, relativePath);
      const namespace = basename(relativePath, ".json");
      const expectedKeys = expectedByNamespace.get(namespace);
      if (index.namespace !== namespace || expectedKeys === undefined) {
        fail(`Namespaced index '${relativePath}' has unexpected namespace '${index.namespace}'.`);
      }
      assertExactArray(index.keys, expectedKeys, relativePath);
      const compact = Buffer.from(JSON.stringify(index));
      totals.namespaceIndexes[namespace] = {
        entries: index.keys.length,
        compactBytes: compact.length,
        gzipBytes: gzipSync(diskBuffer, { level: 6 }).length,
        brotliBytes: brotliCompressSync(diskBuffer, {
          params: { [zlibConstants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY },
        }).length,
      };
      totals.compactBytes += compact.length;
      totals.gzipBytes += totals.namespaceIndexes[namespace].gzipBytes;
      totals.brotliBytes += totals.namespaceIndexes[namespace].brotliBytes;
      totals.diskBytes += diskBuffer.length;
      totals.artifacts += 1;
      return;
    } else if (relativePath === "v1/meta.json") {
      const meta = validateZodArtifact(metaResponseSchema, value, relativePath);
      if (meta.generated !== GENERATED)
        fail(`Candidate metadata '${relativePath}' has an unexpected timestamp.`);
      if (
        meta.current !== snapshotId ||
        meta.namespaces.join("\0") !== sourceNamespaces.join("\0")
      ) {
        fail(`Candidate metadata '${relativePath}' does not match source namespaces/snapshot.`);
      }
      if (meta.snapshots.length !== 1 || meta.snapshots[0]?.source.version !== bcd.__meta.version) {
        fail(`Candidate metadata '${relativePath}' does not describe the pinned BCD snapshot.`);
      }
      if (
        meta.snapshots[0]?.generated !== GENERATED ||
        meta.snapshots[0]?.expires !== EXPIRES ||
        meta.snapshots[0]?.generatorVersion !== generatorPackage.version
      ) {
        fail(`Candidate metadata '${relativePath}' has unexpected snapshot provenance.`);
      }
    } else {
      fail(`Generated path '${relativePath}' is not an expected artifact kind.`);
    }

    const compact = Buffer.from(JSON.stringify(value));
    const gzipBytes = gzipSync(diskBuffer, { level: 6 }).length;
    const brotliBytes = brotliCompressSync(diskBuffer, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY },
    }).length;
    totals.compactBytes += compact.length;
    totals.gzipBytes += gzipBytes;
    totals.brotliBytes += brotliBytes;
    if (relativePath === `${snapshotPrefix}index.json`) {
      totals.namespaceIndexes.$all.compactBytes = compact.length;
      totals.namespaceIndexes.$all.gzipBytes = gzipBytes;
      totals.namespaceIndexes.$all.brotliBytes = brotliBytes;
    }
    totals.diskBytes += diskBuffer.length;
    totals.artifacts += 1;
    sampleRunnerRss();
  };

  // Resolve every request path through metadata, the root and the shards, as the Worker will.
  const metaBytes = await readExpected("v1/meta.json");
  await assertEncodings(metaBytes, (encoding) =>
    representationPath("v1/meta.json", encoding, sha256Hex(metaBytes)),
  );
  await consumeFile("v1/meta.json", metaBytes);

  const root = snapshotRootSchema.parse(
    JSON.parse((await readExpected(snapshotRootPath(snapshotId))).toString("utf8")),
  );
  if (root.snapshot !== snapshotId) fail("Root names another snapshot.");
  const shards = new Map();
  for (const sha256 of new Set(root.shards)) {
    const bytes = await readExpected(shardPath(sha256));
    if (sha256Hex(bytes) !== sha256) fail(`Shard '${sha256}' does not hash to its name.`);
    shards.set(sha256, shardSchema.parse(JSON.parse(bytes.toString("utf8"))).pointers);
  }
  let pointedKeys = 0;
  root.shards.forEach((sha256, index) => {
    for (const key of Object.keys(shards.get(sha256))) {
      if (shardIndexOf(key) !== index) fail(`Key '${key}' is in shard ${index}, not its own.`);
      if (!expectedSource.has(key)) fail(`Shard ${index} points to unknown key '${key}'.`);
      pointedKeys += 1;
    }
  });
  if (pointedKeys !== sourceKeys.length)
    fail(`Shards hold ${pointedKeys} keys; BCD has ${sourceKeys.length}.`);

  const structuralPaths = [
    "browsers.json",
    "index.json",
    ...sourceNamespaces.map((namespace) => `index/${namespace}.json`),
  ];
  assertExactArray(Object.keys(root.structural), structuralPaths.toSorted(), "root structural");
  for (const path of structuralPaths) {
    const relativePath = `${snapshotPrefix}${path}`;
    await consumeFile(relativePath, await readBlob(root.structural[path], relativePath));
  }
  for (const key of sourceKeys) {
    const pointer = shards.get(root.shards[shardIndexOf(key)])[key];
    for (const [kind, directory] of [
      ["feature", "features"],
      ["raw", "raw"],
    ]) {
      const relativePath = `${snapshotPrefix}${directory}/${key}.json`;
      await consumeFile(relativePath, await readBlob(pointer?.[kind], relativePath));
    }
  }

  const visitOutput = async (absoluteDirectory, prefix) => {
    for await (const entry of await opendir(absoluteDirectory)) {
      const childRelativePath = prefix === "" ? entry.name : posix.join(prefix, entry.name);
      if (entry.isDirectory())
        await visitOutput(join(absoluteDirectory, entry.name), childRelativePath);
      else if (entry.isFile()) actualPaths.add(childRelativePath);
      else fail(`Generated path '${childRelativePath}' is not a regular file or directory.`);
    }
  };
  await visitOutput(outputRoot, "");

  const missingLogical = [...identityPaths].filter((path) => !consumedPaths.has(path));
  const unexpected = [...actualPaths].filter((path) => !expectedPaths.has(path));
  if (missingLogical.length > 0 || unexpected.length > 0) {
    fail(
      `Generated output differs from BCD: ${missingLogical.length} request paths unanswered (${missingLogical.slice(0, 5).join(", ")}); ${unexpected.length} files unexpected (${unexpected.slice(0, 5).join(", ")}).`,
    );
  }

  const expectedArtifacts = verifiedBlobs.size * 3 + shards.size + 1 + 3;
  if (actualPaths.size !== expectedArtifacts || cliResult.blobs !== verifiedBlobs.size) {
    fail(
      `File count mismatch: disk=${actualPaths.size}, expected=${expectedArtifacts}; blobs CLI=${cliResult.blobs}, resolved=${verifiedBlobs.size}.`,
    );
  }
  if (totals.array.normalized === undefined || totals.array.raw === undefined) {
    fail("Expected both normalized and raw javascript.builtins.Array artifacts.");
  }
  if (totals.artifacts !== identityPaths.size) {
    fail(
      `Metrics counted ${totals.artifacts} identity artifacts but expected ${identityPaths.size}.`,
    );
  }

  return {
    ...totals,
    addressableKeys: sourceKeys.length,
    namespaces: sourceNamespaces.length,
    maximumKeyLengthBytes: maximumKeyLength,
    expectedFileCount: expectedArtifacts,
    actualFileCount: actualPaths.size,
    distinctBlobs: verifiedBlobs.size,
    distinctShards: shards.size,
  };
};

const addPayloadMetrics = (totals, payload) => {
  totals.compactBytes += payload.compactBytes;
  totals.gzipBytes += payload.gzipBytes;
  totals.brotliBytes += payload.brotliBytes;
  totals.artifacts += 1;
  totals.largestPayloads.push(payload);
  totals.largestPayloads.sort((left, right) => right.compactBytes - left.compactBytes);
  if (totals.largestPayloads.length > TOP_LARGEST) totals.largestPayloads.length = TOP_LARGEST;
};

const run = async () => {
  const timeoutMs = timeoutFromEnvironment();
  const outputRoot = await mkdtemp(join(tmpdir(), "bcd-embed-full-volume-"));
  try {
    const cli = await waitForCli(outputRoot, timeoutMs);
    const snapshotId = `bcd-${bcd.__meta.version}-gen-${generatorPackage.version}`;
    const served = servedFileCount(sourceKeys.length, sourceNamespaces.length);
    const summary = new RegExp(
      `^Emitted ${served} artifacts as (\\d+) blobs for ${snapshotId.replaceAll(".", "\\.")}; root [a-f0-9]{64}\\.$`,
    ).exec(cli.stdout.trim());
    if (summary === null) {
      fail(`Unexpected generator CLI summary for ${served} artifacts: '${cli.stdout.trim()}'.`);
    }

    const measured = await validateAndMeasureOutput(outputRoot, snapshotId, {
      blobs: Number(summary[1]),
    });
    return {
      bcdVersion: bcd.__meta.version,
      generatorVersion: generatorPackage.version,
      generated: GENERATED,
      expires: EXPIRES,
      host: {
        platform: `${platform()} ${release()}`,
        architecture: process.arch,
        node: process.version,
        cpu: cpus()[0]?.model ?? "unknown",
        logicalCpus: cpus().length,
        totalMemoryBytes: totalmem(),
      },
      generation: {
        durationMs: cli.durationMs,
        peakSampledRssBytes: cli.peakRssBytes,
      },
      measurement: {
        compressionInput:
          "compact emitted artifact bytes plus the trailing newline, per independently served artifact",
        gzipLevel: 6,
        brotliQuality: BROTLI_QUALITY,
        note: "Compression totals sum each artifact independently; they are not a single archive. RSS is sampled every 50 ms in the generation process. Array heap deltas are observational and include runtime allocation behavior.",
      },
      ...measured,
    };
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
};

try {
  const report = await run();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
}
