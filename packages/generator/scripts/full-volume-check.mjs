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
import { mkdtemp, opendir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, posix } from "node:path";

import bcd from "@mdn/browser-compat-data" with { type: "json" };
import Ajv from "ajv";
import addFormats from "ajv-formats";
import {
  browsersResponseSchema,
  featureResponseSchema,
  indexResponseSchema,
  metaResponseSchema,
  ARTIFACT_MANIFEST_PATH,
  artifactManifestSchema,
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

const assertCaseSensitiveFilesystem = async (directory) => {
  const probe = `.bcd-embed-case-${process.pid}-${Math.random().toString(36).slice(2)}`;
  const lowerPath = join(directory, `${probe}a`);
  const upperPath = join(directory, `${probe}A`);
  await writeFile(lowerPath, "", { flag: "wx" });
  try {
    await writeFile(upperPath, "", { flag: "wx" });
  } catch (error) {
    await Promise.all([rm(lowerPath, { force: true }), rm(upperPath, { force: true })]);
    if (error?.code === "EEXIST") {
      fail(
        "Full-volume generation requires a case-sensitive output filesystem: BCD contains distinct keys that differ only by case, and the documented key-as-filename layout cannot represent both on a case-insensitive volume.",
      );
    }
    throw error;
  }
  await Promise.all([rm(lowerPath, { force: true }), rm(upperPath, { force: true })]);
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
const snapshotArtifactCount = (keyCount, namespaceCount) =>
  (keyCount * 2 + namespaceCount + 3) * 3 + 1;

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

const assertEnvelope = (value, path) => {
  if (
    value.generated !== GENERATED ||
    value.source?.package !== "@mdn/browser-compat-data" ||
    value.source?.version !== bcd.__meta.version
  ) {
    fail(`Artifact '${path}' has unexpected generation/source provenance.`);
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
  const expectedPaths = new Set([
    "v1/meta.json",
    `${snapshotPrefix}browsers.json`,
    `${snapshotPrefix}index.json`,
  ]);
  for (const key of sourceKeys) {
    expectedPaths.add(`${snapshotPrefix}features/${key}.json`);
    expectedPaths.add(`${snapshotPrefix}raw/${key}.json`);
  }
  for (const namespace of sourceNamespaces) {
    expectedPaths.add(`${snapshotPrefix}index/${namespace}.json`);
  }
  const identityPaths = new Set(expectedPaths);
  const manifest = artifactManifestSchema.parse(
    JSON.parse(await readFile(join(outputRoot, ARTIFACT_MANIFEST_PATH), "utf8")),
  );
  if (manifest.snapshotId !== snapshotId) fail("Manifest snapshot identity mismatch.");
  const inventory = new Map(manifest.artifacts.map((artifact) => [artifact.path, artifact]));
  const logicalPaths = new Set(manifest.artifacts.map((artifact) => artifact.logicalPath));
  if (
    logicalPaths.size !== identityPaths.size ||
    [...logicalPaths].some((path) => !identityPaths.has(path))
  )
    fail("Manifest logical artifacts differ from BCD.");
  for (const artifact of manifest.artifacts) expectedPaths.add(artifact.path);
  expectedPaths.add(ARTIFACT_MANIFEST_PATH);
  const expectedDirectories = new Set();
  for (const path of expectedPaths) {
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      expectedDirectories.add(segments.slice(0, index).join("/"));
    }
  }

  const actualPaths = new Set();
  const actualDirectories = new Set();
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

  const consumeFile = async (absolutePath, relativePath) => {
    if (actualPaths.has(relativePath)) fail(`Duplicate generated path '${relativePath}'.`);
    actualPaths.add(relativePath);
    const fileInfo = await stat(absolutePath);
    if (!fileInfo.isFile()) fail(`Generated path '${relativePath}' is not a regular file.`);
    const diskBuffer = await readFile(absolutePath);
    if (relativePath === ARTIFACT_MANIFEST_PATH) return;
    const representation = inventory.get(relativePath);
    if (
      representation === undefined ||
      representation.size !== diskBuffer.length ||
      representation.sha256 !== createHash("sha256").update(diskBuffer).digest("hex")
    )
      fail(`Representation checksum mismatch at '${relativePath}'.`);
    if (representation.encoding !== "identity") {
      const decoded =
        representation.encoding === "br"
          ? brotliDecompressSync(diskBuffer)
          : gunzipSync(diskBuffer);
      if (!decoded.equals(await readFile(join(outputRoot, representation.logicalPath))))
        fail(`Representation contents mismatch at '${relativePath}'.`);
      return;
    }
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

  const visitOutput = async (absoluteDirectory, prefix) => {
    const directory = await opendir(absoluteDirectory);
    for await (const entry of directory) {
      const childPath = join(absoluteDirectory, entry.name);
      const childRelativePath = prefix === "" ? entry.name : posix.join(prefix, entry.name);
      if (entry.isDirectory()) {
        if (!expectedDirectories.has(childRelativePath))
          fail(`Unexpected generated directory '${childRelativePath}'.`);
        actualDirectories.add(childRelativePath);
        await visitOutput(childPath, childRelativePath);
      } else if (entry.isFile()) {
        await consumeFile(childPath, childRelativePath);
      } else {
        fail(`Generated path '${childRelativePath}' is not a regular file or directory.`);
      }
    }
  };

  await visitOutput(outputRoot, "");

  const missing = [...expectedPaths].filter((path) => !actualPaths.has(path));
  const unexpected = [...actualPaths].filter((path) => !expectedPaths.has(path));
  const missingDirectories = [...expectedDirectories].filter(
    (path) => !actualDirectories.has(path),
  );
  if (missing.length > 0 || unexpected.length > 0 || missingDirectories.length > 0) {
    fail(
      `Generated output tree differs from BCD: ${missing.length} files missing (${missing.slice(0, 5).join(", ")}); ${unexpected.length} files unexpected (${unexpected.slice(0, 5).join(", ")}); ${missingDirectories.length} directories missing (${missingDirectories.slice(0, 5).join(", ")}).`,
    );
  }

  const expectedArtifacts = snapshotArtifactCount(sourceKeys.length, sourceNamespaces.length);
  if (actualPaths.size !== expectedArtifacts || cliResult.artifactCount !== expectedArtifacts) {
    fail(
      `Artifact count mismatch: disk=${actualPaths.size}, CLI=${cliResult.artifactCount}, expected=${expectedArtifacts}.`,
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
    await assertCaseSensitiveFilesystem(outputRoot);
    const cli = await waitForCli(outputRoot, timeoutMs);
    const expectedCliSummary = `Emitted ${snapshotArtifactCount(sourceKeys.length, sourceNamespaces.length)} artifacts for bcd-${bcd.__meta.version}-gen-${generatorPackage.version}.`;
    if (cli.stdout.trim() !== expectedCliSummary) {
      fail(
        `Unexpected generator CLI summary. Expected '${expectedCliSummary}', received '${cli.stdout.trim()}'.`,
      );
    }

    const snapshotId = `bcd-${bcd.__meta.version}-gen-${generatorPackage.version}`;

    const measured = await validateAndMeasureOutput(outputRoot, snapshotId, {
      artifactCount: snapshotArtifactCount(sourceKeys.length, sourceNamespaces.length),
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
