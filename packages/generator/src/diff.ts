import { createHash, type Hash } from "node:crypto";
import { lstat, opendir, readFile } from "node:fs/promises";
import { join, posix, resolve } from "node:path";

import {
  browsersResponseSchema,
  ARTIFACT_MANIFEST_PATH,
  artifactManifestSchema,
  CONTRACT_VERSION,
  featureKeySchema,
  featureResponseSchema,
  indexResponseSchema,
  metaResponseSchema,
  namespaceSchema,
  type IndexResponse,
  type MetaResponse,
  type ArtifactManifest,
} from "@bcd-embed/schema";

import { validateRawArtifact } from "./input.js";

/** Conservative defaults; operators may change these reviewed source constants. */
export const DEFAULT_DIFF_POLICY = Object.freeze({
  maxChangedFeatures: 2_500,
  maxChangedPercent: 10,
  maxAddedFeatures: 500,
  maxAddedPercent: 2,
  maxRemovedFeatures: 50,
  maxRemovedPercent: 0.25,
});

export type DiffApproval = {
  baselineDigest: string;
  candidateDigest: string;
  approved: true;
  reason: string;
};

export type DiffReport = {
  baselineDigest: string;
  candidateDigest: string;
  semanticDigest: string;
  semanticChanged: boolean;
  baselineVersion: string | null;
  candidateVersion: string;
  features: {
    baseline: number;
    candidate: number;
    added: number;
    removed: number;
    changed: number;
  };
  indexes: {
    addedKeys: number;
    removedKeys: number;
    changedShards: number;
    globalIndexChanged: boolean;
  };
  browsersChanged: boolean;
  namespaces: { added: string[]; removed: string[] };
  bootstrap: boolean;
  policy: typeof DEFAULT_DIFF_POLICY;
  blocked: string[];
  approved: boolean;
};

type ArtifactKind = "browsers" | "feature" | "index" | "meta" | "raw";
type Artifact = { relativePath: string; absolutePath: string };
type FileMeasurement = { size: number; sha256: string };
type Identity = { kind: ArtifactKind; key?: string; namespace?: string };
type SnapshotTree = {
  digest: string;
  semanticDigest: string;
  version: string;
  featureDigests: Map<string, string>;
  featureKeys: Set<string>;
  indexDigests: Map<string, string>;
  indexKeys: Set<string>;
  namespaces: Set<string>;
  browsersDigest: string;
  metadataDigest: string;
  rootIsEmpty: boolean;
};

const sha256 = (): Hash => createHash("sha256");
const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;
const addFramed = (hash: Hash, value: Uint8Array): void => {
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(value.byteLength));
  hash.update(length).update(value);
};

const updateCanonical = (hash: Hash, value: unknown): void => {
  if (Array.isArray(value)) {
    hash.update("[");
    value.forEach((item, index) => {
      if (index > 0) hash.update(",");
      updateCanonical(hash, item);
    });
    hash.update("]");
    return;
  }
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    hash.update("{");
    Object.keys(object)
      .sort()
      .forEach((key, index) => {
        if (index > 0) hash.update(",");
        hash.update(JSON.stringify(key)).update(":");
        updateCanonical(hash, object[key]);
      });
    hash.update("}");
    return;
  }
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error("Artifact contains a non-JSON value.");
  hash.update(json);
};

const normalizeProvenance = (kind: ArtifactKind, value: unknown): unknown => {
  if (kind === "raw") return value;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Artifact envelope must be an object.");
  }
  const copy = structuredClone(value) as Record<string, unknown>;
  copy.generated = "<generated>";
  if (kind === "meta") {
    copy.current = "<snapshot-id>";
    const snapshots = copy.snapshots as Array<Record<string, unknown>>;
    for (const snapshot of snapshots) {
      snapshot.id = "<snapshot-id>";
      snapshot.generatorVersion = "<generator-version>";
      snapshot.generated = "<generated>";
      snapshot.expires = "<expires>";
      (snapshot.source as Record<string, unknown>).version = "<source-version>";
    }
  } else {
    const source = copy.source as Record<string, unknown>;
    source.version = "<source-version>";
  }
  return copy;
};

const parseJson = (bytes: Buffer, path: string): unknown => {
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (cause) {
    throw new Error(`Invalid JSON in '${path}'.`, { cause });
  }
};

const parseArtifact = <T>(
  schema: { parse(value: unknown): T },
  value: unknown,
  path: string,
): T => {
  try {
    return schema.parse(value);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "Schema validation failed.";
    throw new Error(`Invalid artifact '${path}': ${detail}`, { cause });
  }
};

const assertEnvelope = (
  value: { contract: string; generated: string; source: { package: string; version: string } },
  meta: MetaResponse,
  path: string,
): void => {
  const snapshot = meta.snapshots.find(({ id }) => id === meta.current);
  if (
    snapshot === undefined ||
    value.contract !== CONTRACT_VERSION ||
    value.generated !== meta.generated ||
    value.source.package !== snapshot.source.package ||
    value.source.version !== snapshot.source.version
  ) {
    throw new Error(`Inconsistent contract/provenance envelope in '${path}'.`);
  }
};

const filesUnder = async (root: string): Promise<Artifact[]> => {
  const files: Artifact[] = [];
  const directories = new Set<string>();
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const handle = await opendir(directory);
    for await (const entry of handle) {
      const absolutePath = join(directory, entry.name);
      const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.isSymbolicLink())
          throw new Error(`Unexpected symlink directory '${relativePath}'.`);
        directories.add(relativePath);
        await visit(absolutePath, relativePath);
      } else if (entry.isFile() && !entry.isSymbolicLink()) {
        if (
          relativePath !== ".bcd-embed-manifest.json" &&
          !relativePath.endsWith(".json") &&
          !relativePath.endsWith(".json.br") &&
          !relativePath.endsWith(".json.gz")
        ) {
          throw new Error(`Unexpected non-JSON artifact '${relativePath}'.`);
        }
        files.push({ relativePath, absolutePath });
      } else {
        throw new Error(`Unexpected artifact entry '${relativePath}'.`);
      }
    }
  };
  await visit(root, "");
  const expectedDirectories = new Set<string>();
  for (const { relativePath } of files) {
    let directory = posix.dirname(relativePath);
    while (directory !== ".") {
      expectedDirectories.add(directory);
      directory = posix.dirname(directory);
    }
  }
  for (const directory of directories) {
    if (!expectedDirectories.has(directory))
      throw new Error(`Unexpected empty directory '${directory}'.`);
  }
  files.sort((left, right) => compareStrings(left.relativePath, right.relativePath));
  return files;
};

const assertRoot = async (path: string): Promise<boolean> => {
  let info;
  try {
    info = await lstat(path);
  } catch (cause) {
    throw new Error(`Artifact directory '${path}' does not exist.`, { cause });
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`Artifact root '${path}' must be a regular directory.`);
  }
  const entries = await opendir(path);
  for await (const _entry of entries) return false;
  return true;
};

const identify = (relativePath: string, snapshotId: string): Identity => {
  if (relativePath === "v1/meta.json") return { kind: "meta" };
  const prefix = `v1/${snapshotId}/`;
  if (!relativePath.startsWith(prefix))
    throw new Error(`Unexpected output path '${relativePath}'.`);
  const path = relativePath.slice(prefix.length);
  if (path === "browsers.json") return { kind: "browsers" };
  if (path === "index.json") return { kind: "index", namespace: "*" };
  if (path.startsWith("index/") && path.endsWith(".json")) {
    const namespace = path.slice("index/".length, -".json".length);
    namespaceSchema.parse(namespace);
    if (namespace.includes("/")) throw new Error(`Invalid index path '${relativePath}'.`);
    return { kind: "index", namespace };
  }
  for (const kind of ["feature", "raw"] as const) {
    const directory = kind === "feature" ? "features" : "raw";
    if (path.startsWith(`${directory}/`) && path.endsWith(".json")) {
      const key = path.slice(directory.length + 1, -".json".length);
      featureKeySchema.parse(key);
      if (path !== `${directory}/${key}.json`)
        throw new Error(`Invalid feature path '${relativePath}'.`);
      return { kind, key };
    }
  }
  throw new Error(`Unexpected output path '${relativePath}'.`);
};

const hashSemantic = (kind: ArtifactKind, value: unknown): string => {
  const hash = sha256();
  updateCanonical(hash, normalizeProvenance(kind, value));
  return hash.digest("hex");
};

const loadTree = async (path: string): Promise<SnapshotTree> => {
  const root = resolve(path);
  const rootIsEmpty = await assertRoot(root);
  const exactHash = sha256();
  if (rootIsEmpty) {
    addFramed(exactHash, Buffer.from("empty-artifact-tree"));
    return {
      digest: exactHash.digest("hex"),
      semanticDigest: "",
      version: "",
      featureDigests: new Map(),
      featureKeys: new Set(),
      indexDigests: new Map(),
      indexKeys: new Set(),
      namespaces: new Set(),
      browsersDigest: "",
      metadataDigest: "",
      rootIsEmpty: true,
    };
  }

  const files = await filesUnder(root);
  let meta: MetaResponse | undefined;
  let manifest: ArtifactManifest | undefined;
  const measurements = new Map<string, FileMeasurement>();
  for (const artifact of files) {
    const bytes = await readFile(artifact.absolutePath);
    addFramed(exactHash, Buffer.from(artifact.relativePath));
    addFramed(exactHash, bytes);
    measurements.set(artifact.relativePath, {
      size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    if (artifact.relativePath === "v1/meta.json") {
      meta = parseArtifact(
        metaResponseSchema,
        parseJson(bytes, artifact.relativePath),
        artifact.relativePath,
      );
    } else if (artifact.relativePath === ARTIFACT_MANIFEST_PATH) {
      manifest = parseArtifact(
        artifactManifestSchema,
        parseJson(bytes, artifact.relativePath),
        artifact.relativePath,
      );
    }
    // Snapshot path identity is checked after metadata has been read below.
  }
  const hasCompressedFiles = files.some(
    ({ relativePath }) => relativePath.endsWith(".json.br") || relativePath.endsWith(".json.gz"),
  );
  if (hasCompressedFiles && manifest === undefined) {
    throw new Error(`Artifact tree '${root}' contains compressed files without a manifest.`);
  }
  if (meta === undefined) throw new Error(`Candidate '${root}' is missing 'v1/meta.json'.`);
  if (meta.snapshots.length !== 1 || meta.snapshots[0]?.id !== meta.current) {
    throw new Error(`Artifact tree '${root}' must describe exactly its current snapshot.`);
  }
  if (new Set(meta.namespaces).size !== meta.namespaces.length) {
    throw new Error(`Artifact tree '${root}' contains duplicate metadata namespaces.`);
  }
  const snapshotId = meta.current;
  if (manifest !== undefined) {
    if (manifest.snapshotId !== snapshotId) {
      throw new Error(`Artifact manifest snapshot does not match '${root}'.`);
    }
    const expectedPaths = new Set<string>();
    for (const item of manifest.artifacts) {
      const measured = measurements.get(item.path);
      if (
        measured === undefined ||
        measured.size !== item.size ||
        measured.sha256 !== item.sha256
      ) {
        throw new Error(`Artifact manifest does not match file '${item.path}'.`);
      }
      expectedPaths.add(item.path);
    }
    const actualPaths = new Set(
      files
        .map(({ relativePath }) => relativePath)
        .filter((relativePath) => relativePath !== ARTIFACT_MANIFEST_PATH),
    );
    if (
      actualPaths.size !== expectedPaths.size ||
      [...actualPaths].some((relativePath) => !expectedPaths.has(relativePath))
    ) {
      throw new Error(`Artifact manifest inventory does not match files in '${root}'.`);
    }
  }
  const featureDigests = new Map<string, string>();
  const rawDigests = new Map<string, string>();
  const featureKeys = new Set<string>();
  const indexDigests = new Map<string, string>();
  const indexKeys = new Set<string>();
  const namespaces = new Set(meta.namespaces);
  let browsersDigest = "";
  const metadataDigest = hashSemantic("meta", meta);
  let hasGlobalIndex = false;
  let globalIndexKeyCount = 0;
  const shardKeys = new Map<string, string[]>();

  // Payload memory is bounded by the largest individual JSON artifact. Only keys and digests persist.
  for (const artifact of files) {
    if (
      artifact.relativePath === "v1/meta.json" ||
      artifact.relativePath === ARTIFACT_MANIFEST_PATH ||
      artifact.relativePath.endsWith(".json.br") ||
      artifact.relativePath.endsWith(".json.gz")
    ) {
      continue;
    }
    const identity = identify(artifact.relativePath, snapshotId);
    const bytes = await readFile(artifact.absolutePath);
    const value = parseJson(bytes, artifact.relativePath);
    switch (identity.kind) {
      case "feature": {
        const response = parseArtifact(featureResponseSchema, value, artifact.relativePath);
        assertEnvelope(response, meta, artifact.relativePath);
        if (response.query !== identity.key)
          throw new Error(`Query does not match '${artifact.relativePath}'.`);
        const digest = hashSemantic("feature", response);
        featureDigests.set(identity.key!, digest);
        featureKeys.add(identity.key!);
        break;
      }
      case "raw": {
        try {
          validateRawArtifact(value);
        } catch (cause) {
          throw new Error(`Invalid raw artifact '${artifact.relativePath}'.`, { cause });
        }
        const key = identity.key!;
        rawDigests.set(key, hashSemantic("raw", value));
        break;
      }
      case "browsers": {
        const response = parseArtifact(browsersResponseSchema, value, artifact.relativePath);
        assertEnvelope(response, meta, artifact.relativePath);
        const digest = hashSemantic("browsers", response);
        browsersDigest = digest;
        break;
      }
      case "index": {
        const response: IndexResponse = parseArtifact(
          indexResponseSchema,
          value,
          artifact.relativePath,
        );
        assertEnvelope(response, meta, artifact.relativePath);
        const expectedNamespace = identity.namespace === "*" ? null : identity.namespace;
        if (response.namespace !== expectedNamespace) {
          throw new Error(`Namespace does not match '${artifact.relativePath}'.`);
        }
        if (identity.namespace === "*") {
          if (hasGlobalIndex) throw new Error("Artifact tree contains duplicate global indexes.");
          hasGlobalIndex = true;
          globalIndexKeyCount = response.keys.length;
          for (const key of response.keys) indexKeys.add(key);
        } else {
          shardKeys.set(identity.namespace!, response.keys);
        }
        const digest = hashSemantic("index", response);
        indexDigests.set(identity.namespace!, digest);
        break;
      }
      case "meta":
        throw new Error("Metadata should only occur at 'v1/meta.json'.");
    }
  }

  if (browsersDigest === "" || !hasGlobalIndex) {
    throw new Error(`Artifact tree '${root}' is missing required browsers/index artifacts.`);
  }
  if (
    featureKeys.size !== rawDigests.size ||
    [...featureKeys].some((key) => !rawDigests.has(key))
  ) {
    throw new Error(`Artifact tree '${root}' must contain exactly one raw artifact per feature.`);
  }
  if (
    indexKeys.size !== globalIndexKeyCount ||
    indexKeys.size !== featureKeys.size ||
    [...indexKeys].some((key) => !featureKeys.has(key))
  ) {
    throw new Error(`Global index does not exactly cover the feature artifacts in '${root}'.`);
  }
  const expectedNamespaces = new Set([...featureKeys].map((key) => key.split(".", 1)[0]!));
  if (
    expectedNamespaces.size !== namespaces.size ||
    [...expectedNamespaces].some((namespace) => !namespaces.has(namespace)) ||
    shardKeys.size !== namespaces.size
  ) {
    throw new Error(`Namespace shards do not match features in '${root}'.`);
  }
  const featureKeysByNamespace = new Map<string, Set<string>>();
  for (const key of featureKeys) {
    const namespace = key.split(".", 1)[0]!;
    let keys = featureKeysByNamespace.get(namespace);
    if (keys === undefined) featureKeysByNamespace.set(namespace, (keys = new Set()));
    keys.add(key);
  }
  for (const namespace of namespaces) {
    const keys = shardKeys.get(namespace);
    const expectedKeys = featureKeysByNamespace.get(namespace);
    if (
      keys === undefined ||
      expectedKeys === undefined ||
      keys.length !== expectedKeys.size ||
      new Set(keys).size !== keys.length
    ) {
      throw new Error(`Index shard '${namespace}' has incomplete feature coverage.`);
    }
    for (const key of keys) {
      if (!expectedKeys.has(key)) {
        throw new Error(`Index shard '${namespace}' contains unexpected key '${key}'.`);
      }
    }
  }
  for (const [key, digest] of rawDigests) {
    const featureDigest = featureDigests.get(key);
    if (featureDigest === undefined)
      throw new Error(`Raw artifact '${key}' has no normalized feature.`);
    featureDigests.set(key, sha256().update(featureDigest).update(digest).digest("hex"));
  }

  const semanticHash = sha256();
  for (const [key, digest] of [...featureDigests].sort(([left], [right]) =>
    compareStrings(left, right),
  )) {
    semanticHash.update(key).update("\0").update(digest);
  }
  semanticHash.update(browsersDigest).update(metadataDigest);
  for (const [namespace, digest] of [...indexDigests].sort(([left], [right]) =>
    compareStrings(left, right),
  )) {
    semanticHash.update(namespace).update("\0").update(digest);
  }
  return {
    digest: exactHash.digest("hex"),
    semanticDigest: semanticHash.digest("hex"),
    version: meta.snapshots[0]!.source.version,
    featureDigests,
    featureKeys,
    indexDigests,
    indexKeys,
    namespaces,
    browsersDigest,
    metadataDigest,
    rootIsEmpty: false,
  };
};

const percent = (count: number, total: number): number => (total === 0 ? 0 : (count / total) * 100);

const validateApproval = (value: unknown): DiffApproval => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Approval must be a JSON object.");
  }
  const approval = value as Record<string, unknown>;
  if (
    Object.keys(approval).sort().join(",") !== "approved,baselineDigest,candidateDigest,reason" ||
    approval.approved !== true ||
    typeof approval.baselineDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(approval.baselineDigest) ||
    typeof approval.candidateDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(approval.candidateDigest) ||
    typeof approval.reason !== "string" ||
    approval.reason.trim().length < 8
  ) {
    throw new Error(
      "Approval must contain exact SHA-256 digests, approved:true, and a reason of at least 8 characters.",
    );
  }
  return approval as DiffApproval;
};

export const parseDiffApproval = (value: unknown): DiffApproval => validateApproval(value);

export type CompareOutputTreesOptions = {
  baselineRoot: string;
  candidateRoot: string;
  approval?: unknown;
};

/** Compare emitted JSON artifacts one file at a time; does not load BCD source data. */
export const compareOutputTrees = async ({
  baselineRoot,
  candidateRoot,
  approval: unparsedApproval,
}: CompareOutputTreesOptions): Promise<DiffReport> => {
  const baseline = await loadTree(baselineRoot);
  const candidate = await loadTree(candidateRoot);
  if (candidate.rootIsEmpty) throw new Error("Candidate artifact tree must not be empty.");
  const bootstrap = baseline.rootIsEmpty;

  const addedKeys = [...candidate.featureKeys].filter((key) => !baseline.featureKeys.has(key));
  const removedKeys = [...baseline.featureKeys].filter((key) => !candidate.featureKeys.has(key));
  let changed = 0;
  for (const key of candidate.featureKeys) {
    if (
      baseline.featureKeys.has(key) &&
      baseline.featureDigests.get(key) !== candidate.featureDigests.get(key)
    ) {
      changed += 1;
    }
  }
  const addedIndexKeys = [...candidate.indexKeys].filter(
    (key) => !baseline.indexKeys.has(key),
  ).length;
  const removedIndexKeys = [...baseline.indexKeys].filter(
    (key) => !candidate.indexKeys.has(key),
  ).length;
  const changedShards = [...candidate.indexDigests].filter(
    ([namespace, digest]) =>
      namespace !== "*" &&
      baseline.indexDigests.has(namespace) &&
      baseline.indexDigests.get(namespace) !== digest,
  ).length;
  const globalIndexChanged =
    baseline.rootIsEmpty ||
    (baseline.indexDigests.has("*") &&
      baseline.indexDigests.get("*") !== candidate.indexDigests.get("*"));
  const denominator = Math.max(baseline.featureKeys.size, candidate.featureKeys.size);
  const namespacesAdded = [...candidate.namespaces]
    .filter((namespace) => !baseline.namespaces.has(namespace))
    .sort();
  const namespacesRemoved = [...baseline.namespaces]
    .filter((namespace) => !candidate.namespaces.has(namespace))
    .sort();
  const blocked: string[] = [];
  if (bootstrap) blocked.push("Bootstrap has no approved baseline.");
  if (
    changed > DEFAULT_DIFF_POLICY.maxChangedFeatures ||
    percent(changed, denominator) > DEFAULT_DIFF_POLICY.maxChangedPercent
  ) {
    blocked.push("Changed feature magnitude exceeds the reviewed policy.");
  }
  if (
    addedKeys.length > DEFAULT_DIFF_POLICY.maxAddedFeatures ||
    percent(addedKeys.length, candidate.featureKeys.size) > DEFAULT_DIFF_POLICY.maxAddedPercent
  )
    blocked.push("Added feature magnitude exceeds the reviewed policy.");
  if (
    removedKeys.length > DEFAULT_DIFF_POLICY.maxRemovedFeatures ||
    percent(removedKeys.length, baseline.featureKeys.size) > DEFAULT_DIFF_POLICY.maxRemovedPercent
  )
    blocked.push("Removed feature magnitude exceeds the reviewed policy.");
  if (!bootstrap && (namespacesAdded.length > 0 || namespacesRemoved.length > 0)) {
    blocked.push("Namespace structure changes require explicit review.");
  }

  let approved = false;
  if (unparsedApproval !== undefined) {
    const approval = validateApproval(unparsedApproval);
    if (
      approval.baselineDigest !== baseline.digest ||
      approval.candidateDigest !== candidate.digest
    ) {
      throw new Error("Approval digest does not match these exact baseline and candidate trees.");
    }
    approved = true;
  }
  if (blocked.length > 0 && !approved) {
    // The caller receives the measured report with a non-passing gate; only a digest-bound approval passes.
  }
  return {
    baselineDigest: baseline.digest,
    candidateDigest: candidate.digest,
    semanticDigest: candidate.semanticDigest,
    semanticChanged: bootstrap || baseline.semanticDigest !== candidate.semanticDigest,
    baselineVersion: baseline.rootIsEmpty ? null : baseline.version,
    candidateVersion: candidate.version,
    features: {
      baseline: baseline.featureKeys.size,
      candidate: candidate.featureKeys.size,
      added: addedKeys.length,
      removed: removedKeys.length,
      changed,
    },
    indexes: {
      addedKeys: addedIndexKeys,
      removedKeys: removedIndexKeys,
      changedShards,
      globalIndexChanged,
    },
    browsersChanged: baseline.rootIsEmpty || baseline.browsersDigest !== candidate.browsersDigest,
    namespaces: { added: namespacesAdded, removed: namespacesRemoved },
    bootstrap,
    policy: DEFAULT_DIFF_POLICY,
    blocked,
    approved,
  };
};
