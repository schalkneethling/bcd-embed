import { lstat, mkdir, mkdtemp, opendir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, posix, relative, resolve, sep } from "node:path";

import {
  CONTRACT_VERSION,
  ARTIFACT_MANIFEST_PATH,
  artifactManifestSchema,
  featureKeySchema,
  namespaceSchema,
  snapshotIdentifierSchema,
  type Snapshot,
  type ArtifactManifest,
  type ArtifactRepresentation,
} from "@bcd-embed/schema";

import type { GeneratedArtifact, GeneratedSnapshot } from "./generate.js";
import { createRepresentations } from "./representations.js";

const stagingPrefix = ".bcd-embed-stage-";

export type EmitGeneratedSnapshotOptions = {
  outputRoot: string;
  generatedSnapshot: GeneratedSnapshot;
};

export type EmissionResult = {
  files: number;
  meta: "created" | "existing";
  snapshot: "created" | "existing";
  snapshotId: string;
  manifest: ArtifactManifest;
};

const fileBytes = (value: unknown): Uint8Array => {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch (error) {
    throw new Error("Generated artifact is not JSON-serializable.", { cause: error });
  }
  if (json === undefined) throw new Error("Generated artifact cannot be serialized as JSON.");
  return Buffer.from(`${json}\n`, "utf8");
};

const isSchemaMatch = (schema: { safeParse(value: string): { success: boolean } }, value: string) =>
  schema.safeParse(value).success;

const assertArtifactPath = (artifact: GeneratedArtifact, snapshotId: string): void => {
  const { kind, path } = artifact;
  if (path.includes("\\") || posix.normalize(path) !== path || path.startsWith("/")) {
    throw new Error(`Unsafe generated artifact path '${path}'.`);
  }

  const snapshotPrefix = `v1/${snapshotId}/`;
  if (kind === "meta") {
    if (path !== "v1/meta.json") throw new Error(`Unexpected metadata path '${path}'.`);
    return;
  }
  if (!path.startsWith(snapshotPrefix)) {
    throw new Error(`Artifact '${path}' does not belong to snapshot '${snapshotId}'.`);
  }

  const relativePath = path.slice(snapshotPrefix.length);
  if (kind === "browsers" && relativePath === "browsers.json") return;
  if (kind === "index" && relativePath === "index.json") return;
  if (kind === "index" && relativePath.startsWith("index/") && relativePath.endsWith(".json")) {
    const namespace = relativePath.slice("index/".length, -".json".length);
    if (isSchemaMatch(namespaceSchema, namespace)) return;
  }

  const directory = kind === "feature" ? "features" : kind === "raw" ? "raw" : undefined;
  if (
    directory !== undefined &&
    relativePath.startsWith(`${directory}/`) &&
    relativePath.endsWith(".json")
  ) {
    const key = basename(relativePath, ".json");
    if (relativePath === `${directory}/${key}.json` && isSchemaMatch(featureKeySchema, key)) return;
  }

  throw new Error(`Unexpected ${kind} artifact path '${path}'.`);
};

const hasExpectedEnvelope = (
  artifact: Exclude<GeneratedArtifact, { kind: "raw" } | { kind: "meta" }>,
  snapshot: Snapshot,
): boolean =>
  artifact.data.contract === CONTRACT_VERSION &&
  artifact.data.generated === snapshot.generated &&
  artifact.data.source.package === snapshot.source.package &&
  artifact.data.source.version === snapshot.source.version;

const hasExpectedSnapshot = (candidate: Snapshot, snapshot: Snapshot): boolean =>
  candidate.id === snapshot.id &&
  candidate.generatorVersion === snapshot.generatorVersion &&
  candidate.generated === snapshot.generated &&
  candidate.expires === snapshot.expires &&
  candidate.source.package === snapshot.source.package &&
  candidate.source.version === snapshot.source.version;

/** Guard trusted-generator orchestration without reparsing each already-validated payload. */
const assertArtifactIdentity = (
  artifact: GeneratedArtifact,
  generatedSnapshot: GeneratedSnapshot,
): void => {
  const { snapshot, namespaces } = generatedSnapshot;
  if (artifact.kind === "raw") return;
  if (artifact.kind === "meta") {
    if (
      artifact.data.contract !== CONTRACT_VERSION ||
      artifact.data.generated !== snapshot.generated ||
      artifact.data.current !== snapshot.id ||
      artifact.data.snapshots.length !== 1 ||
      !hasExpectedSnapshot(artifact.data.snapshots[0]!, snapshot) ||
      artifact.data.namespaces.length !== namespaces.length ||
      artifact.data.namespaces.some((namespace, index) => namespace !== namespaces[index])
    ) {
      throw new Error("Candidate metadata does not describe the generated snapshot.");
    }
    return;
  }
  if (!hasExpectedEnvelope(artifact, snapshot)) {
    throw new Error(`Artifact '${artifact.path}' has an unexpected contract envelope.`);
  }
  if (artifact.kind === "feature") {
    const key = basename(artifact.path, ".json");
    if (artifact.data.query !== key)
      throw new Error(`Feature artifact '${artifact.path}' has a mismatched query.`);
    return;
  }
  if (artifact.kind === "index") {
    const snapshotPrefix = `v1/${snapshot.id}/`;
    const expectedNamespace =
      artifact.path === `${snapshotPrefix}index.json` ? null : basename(artifact.path, ".json");
    if (artifact.data.namespace !== expectedNamespace) {
      throw new Error(`Index artifact '${artifact.path}' has a mismatched namespace.`);
    }
  }
};

const pathIn = (root: string, artifactPath: string): string => {
  const destination = resolve(root, artifactPath);
  const pathRelativeToRoot = relative(root, destination);
  if (pathRelativeToRoot === ".." || pathRelativeToRoot.startsWith(`..${sep}`)) {
    throw new Error(`Artifact path escapes its output root: '${artifactPath}'.`);
  }
  return destination;
};

const lstatIfPresent = async (path: string) => {
  try {
    return await lstat(path);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
};

const acquireOutputLock = async (root: string): Promise<string> => {
  const lockPath = join(root, ".bcd-embed-emission.lock");
  try {
    await writeFile(lockPath, `${process.pid}\n`, { encoding: "utf8", flag: "wx" });
    return lockPath;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Another local artifact emission holds '${lockPath}'.`);
    }
    throw error;
  }
};

const assertMatchingTree = async (
  stagedSnapshot: string,
  existingSnapshot: string,
  expectedFiles: ReadonlySet<string>,
): Promise<void> => {
  const existing = await lstatIfPresent(existingSnapshot);
  if (existing === undefined) return;
  if (!existing.isDirectory() || existing.isSymbolicLink()) {
    throw new Error(`Existing snapshot path '${existingSnapshot}' is not a directory.`);
  }

  const expectedDirectories = new Set<string>();
  for (const expectedFile of expectedFiles) {
    let directory = posix.dirname(expectedFile);
    while (directory !== ".") {
      expectedDirectories.add(directory);
      directory = posix.dirname(directory);
    }
  }

  let encountered = 0;
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const handle = await opendir(directory);
    for await (const entry of handle) {
      const entryPath = join(directory, entry.name);
      const entryRelativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.isSymbolicLink() || !expectedDirectories.has(entryRelativePath)) {
          throw new Error(
            `Existing snapshot '${existingSnapshot}' has unexpected path '${entryRelativePath}'.`,
          );
        }
        await visit(entryPath, entryRelativePath);
        continue;
      }
      if (!entry.isFile() || entry.isSymbolicLink() || !expectedFiles.has(entryRelativePath)) {
        throw new Error(
          `Existing snapshot '${existingSnapshot}' has unexpected path '${entryRelativePath}'.`,
        );
      }
      const [stagedBytes, existingBytes] = await Promise.all([
        readFile(join(stagedSnapshot, entryRelativePath)),
        readFile(entryPath),
      ]);
      if (!stagedBytes.equals(existingBytes)) {
        throw new Error(`Existing immutable snapshot differs at '${entryRelativePath}'.`);
      }
      encountered += 1;
    }
  };

  await visit(existingSnapshot, "");
  if (encountered !== expectedFiles.size) {
    throw new Error(`Existing immutable snapshot '${existingSnapshot}' is incomplete.`);
  }
};

const assertMatchingMeta = async (
  stagedMeta: string,
  existingMeta: string,
): Promise<"created" | "existing"> => {
  const existing = await lstatIfPresent(existingMeta);
  if (existing === undefined) return "created";
  if (!existing.isFile() || existing.isSymbolicLink()) {
    throw new Error(`Existing metadata path '${existingMeta}' is not a regular file.`);
  }
  const [stagedBytes, existingBytes] = await Promise.all([
    readFile(stagedMeta),
    readFile(existingMeta),
  ]);
  if (!stagedBytes.equals(existingBytes)) {
    throw new Error("Existing candidate metadata differs; refusing to replace it.");
  }
  return "existing";
};

/** Emits a local candidate; publication aliases such as `v1/current` are intentionally excluded. */
export const emitGeneratedSnapshot = async ({
  outputRoot,
  generatedSnapshot,
}: EmitGeneratedSnapshotOptions): Promise<EmissionResult> => {
  if (outputRoot.trim().length === 0) throw new Error("Output root must not be empty.");
  const snapshotId = generatedSnapshot.snapshot.id;
  if (!isSchemaMatch(snapshotIdentifierSchema, snapshotId)) {
    throw new Error(`Invalid generated snapshot identifier '${snapshotId}'.`);
  }

  const root = resolve(outputRoot);
  await mkdir(root, { recursive: true });
  const lockPath = await acquireOutputLock(root);
  let stagingRoot: string | undefined;

  try {
    const existingV1 = await lstatIfPresent(join(root, "v1"));
    if (existingV1 !== undefined && (!existingV1.isDirectory() || existingV1.isSymbolicLink())) {
      throw new Error(`Existing artifact root '${join(root, "v1")}' is not a directory.`);
    }
    stagingRoot = await mkdtemp(join(root, stagingPrefix));
    const stagedV1 = join(stagingRoot, "v1");
    const stagedSnapshot = join(stagedV1, snapshotId);
    const stagedMeta = join(stagedV1, "meta.json");
    const finalV1 = join(root, "v1");
    const finalSnapshot = join(finalV1, snapshotId);
    const finalMeta = join(finalV1, "meta.json");
    const manifestPath = join(root, ARTIFACT_MANIFEST_PATH);
    const stagedManifest = join(stagingRoot, ARTIFACT_MANIFEST_PATH);
    const artifactPaths = new Set<string>();
    const snapshotFiles = new Set<string>();
    const representations: ArtifactRepresentation[] = [];
    const metaVariants: string[] = [];
    let files = 0;
    let hasMeta = false;

    for (const artifact of generatedSnapshot.artifacts) {
      assertArtifactPath(artifact, snapshotId);
      assertArtifactIdentity(artifact, generatedSnapshot);
      if (artifactPaths.has(artifact.path)) {
        throw new Error(`Generated artifact path collision at '${artifact.path}'.`);
      }
      artifactPaths.add(artifact.path);
      if (artifact.kind === "meta") {
        if (hasMeta) throw new Error("Generated snapshot contains multiple metadata artifacts.");
        hasMeta = true;
      }
      for (const { bytes, ...representation } of createRepresentations(
        artifact.path,
        fileBytes(artifact.data),
      )) {
        representations.push(representation);
        if (artifact.kind !== "meta")
          snapshotFiles.add(representation.path.slice(`v1/${snapshotId}/`.length));
        else if (representation.encoding !== "identity") metaVariants.push(representation.path);
        const destination = pathIn(stagingRoot, representation.path);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, bytes, { flag: "wx" });
        files += 1;
      }
    }

    if (!hasMeta || snapshotFiles.size === 0) {
      throw new Error("Generated snapshot must contain metadata and snapshot artifacts.");
    }

    const meta = await assertMatchingMeta(stagedMeta, finalMeta);
    const manifest = artifactManifestSchema.parse({
      version: 1,
      snapshotId,
      artifacts: representations,
    });
    await writeFile(stagedManifest, fileBytes(manifest), { flag: "wx" });
    const metaDirectory = join(finalV1, "_meta");
    const existingMetaDirectory = await lstatIfPresent(metaDirectory);
    if (
      existingMetaDirectory !== undefined &&
      (!existingMetaDirectory.isDirectory() || existingMetaDirectory.isSymbolicLink())
    )
      throw new Error("Existing metadata representation root is not a directory.");
    const newMetaVariants: string[] = [];
    for (const path of metaVariants) {
      if ((await assertMatchingMeta(pathIn(stagingRoot, path), pathIn(root, path))) === "created")
        newMetaVariants.push(path);
    }
    const existingSnapshot = (await lstatIfPresent(finalSnapshot)) !== undefined;
    await assertMatchingTree(stagedSnapshot, finalSnapshot, snapshotFiles);
    const existingManifest = await assertMatchingMeta(stagedManifest, manifestPath);
    await mkdir(finalV1, { recursive: true });
    if (!existingSnapshot) await rename(stagedSnapshot, finalSnapshot);
    await mkdir(metaDirectory, { recursive: true });
    for (const path of newMetaVariants) await rename(pathIn(stagingRoot, path), pathIn(root, path));
    if (existingManifest === "created") await rename(stagedManifest, manifestPath);
    if (meta === "created") await rename(stagedMeta, finalMeta);

    return {
      files: files + 1,
      meta,
      snapshot: existingSnapshot ? "existing" : "created",
      snapshotId,
      manifest,
    };
  } finally {
    try {
      if (stagingRoot !== undefined) await rm(stagingRoot, { recursive: true, force: true });
    } finally {
      await rm(lockPath, { force: true });
    }
  }
};
