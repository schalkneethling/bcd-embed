import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { blobPath } from "@bcd-embed/schema";

import { createPointerTree, type ContentPointer } from "../../src/content-tree.js";
import type { GeneratedArtifact, GeneratedSnapshot } from "../../src/generate.js";
import { createRepresentations } from "../../src/representations.js";

const write = async (root: string, path: string, bytes: Uint8Array): Promise<void> => {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), bytes);
};

/**
 * Writes artifacts in the content-addressed layout without checking them, so that a test can
 * build a tree the real emitter would refuse. The files are consistent with each other: every
 * pointer names a blob that exists and hashes to its name.
 */
export const writeContentTree = async (
  root: string,
  snapshotId: string,
  artifacts: Iterable<GeneratedArtifact>,
): Promise<void> => {
  const prefix = `v1/${snapshotId}/`;
  const pointers: ContentPointer[] = [];
  for (const artifact of artifacts) {
    const bytes = Buffer.from(`${JSON.stringify(artifact.data)}\n`, "utf8");
    if (artifact.kind === "meta") {
      for (const item of createRepresentations("v1/meta.json", bytes))
        await write(root, item.path, item.bytes);
      continue;
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    for (const item of createRepresentations(artifact.path, bytes))
      await write(root, blobPath(sha256, item.encoding), item.bytes);
    pointers.push(
      artifact.kind === "feature" || artifact.kind === "raw"
        ? { kind: artifact.kind, key: basename(artifact.path, ".json"), sha256 }
        : { kind: "structural", path: artifact.path.slice(prefix.length), sha256 },
    );
  }
  const tree = createPointerTree(snapshotId, pointers);
  for (const shard of tree.shardFiles) await write(root, shard.path, shard.bytes);
  await write(root, tree.rootFile.path, tree.rootFile.bytes);
};

/**
 * Renames the release a generated snapshot belongs to, leaving its data alone. The generator is
 * pinned to one BCD version, so this is how a test gets two snapshots of different releases.
 */
export const withRelease = (
  generated: GeneratedSnapshot,
  release: { version: string; generatorVersion?: string },
): GeneratedSnapshot => {
  const generatorVersion = release.generatorVersion ?? generated.snapshot.generatorVersion;
  const id = `bcd-${release.version}-gen-${generatorVersion}`;
  const snapshot = {
    ...generated.snapshot,
    id,
    generatorVersion,
    source: { ...generated.snapshot.source, version: release.version },
  };
  const oldPrefix = `v1/${generated.snapshot.id}/`;
  const artifacts = [...generated.artifacts].map((artifact): GeneratedArtifact => {
    if (artifact.kind !== "meta")
      return { ...artifact, path: `v1/${id}/${artifact.path.slice(oldPrefix.length)}` };
    return { ...artifact, data: { ...artifact.data, current: id, snapshots: [snapshot] } };
  });
  return { snapshot, namespaces: generated.namespaces, artifacts };
};
