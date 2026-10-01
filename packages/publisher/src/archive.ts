import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, opendir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { compareOutputTrees } from "@bcd-embed/generator";
import { ARTIFACT_MANIFEST_PATH, artifactManifestSchema } from "@bcd-embed/schema";

import { putAndVerify, readMetadata, readVerified } from "./objects.js";
import { runBounded } from "./concurrency.js";
import type { PublicationStore } from "./store.js";
import {
  MAX_IDENTITY_BYTES,
  MAX_MANIFEST_BYTES,
  MAX_TOTAL_BYTES,
  validateCandidate,
  type ValidatedCandidate,
} from "./validate.js";

const controlPrefix = (snapshotId: string): string => `v1/_candidates/${snapshotId}/`;

/** Private immutable controls preserve the exact original candidate, not merged canonical metadata. */
export const uploadCandidateControls = async (
  store: PublicationStore,
  candidate: ValidatedCandidate,
): Promise<void> => {
  const prefix = controlPrefix(candidate.manifest.snapshotId);
  await putAndVerify(store, {
    key: `${prefix}${ARTIFACT_MANIFEST_PATH}`,
    body: createReadStream(join(candidate.root, ARTIFACT_MANIFEST_PATH)),
    size: candidate.manifestFile.size,
    sha256: candidate.manifestFile.sha256,
    contentType: "application/json; charset=utf-8",
    ifNoneMatch: true,
  });
  for (const artifact of candidate.manifest.artifacts) {
    if (artifact.logicalPath !== "v1/meta.json") continue;
    await putAndVerify(store, {
      key: `${prefix}${artifact.path}`,
      body: createReadStream(join(candidate.root, artifact.path)),
      size: artifact.size,
      sha256: artifact.sha256,
      contentType: "application/json; charset=utf-8",
      contentEncoding: artifact.encoding === "identity" ? undefined : artifact.encoding,
      ifNoneMatch: true,
    });
  }
};

export type RestoreBaselineOptions = { store: PublicationStore; outputRoot: string };
export type RestoredBaseline = { root: string; snapshotId: string; candidateDigest: string };

/** Reconstruct exact original current output in an empty trusted local directory, without regeneration. */
export const restorePublishedBaseline = async ({
  store,
  outputRoot,
}: RestoreBaselineOptions): Promise<RestoredBaseline | null> => {
  const root = resolve(outputRoot);
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Baseline output root must be a regular empty directory.");
  for await (const _entry of await opendir(root))
    throw new Error("Baseline output root must be empty.");
  const remote = await readMetadata(store);
  if (remote === null) return null;
  const candidateDigest = remote.object.metadata["tree-digest"];
  if (candidateDigest === undefined || !/^[a-f0-9]{64}$/.test(candidateDigest))
    throw new Error("Current metadata lacks its exact candidate digest.");
  const snapshotId = remote.body.current;
  const prefix = controlPrefix(snapshotId);
  const control = await store.get(`${prefix}${ARTIFACT_MANIFEST_PATH}`);
  if (control === null) throw new Error("Current snapshot lacks durable candidate controls.");
  if (
    !Number.isSafeInteger(control.size) ||
    control.size < 0 ||
    control.size > MAX_MANIFEST_BYTES ||
    control.sha256 === undefined ||
    !/^[a-f0-9]{64}$/.test(control.sha256)
  ) {
    control.dispose();
    throw new Error("Candidate control manifest lacks bounded verified bytes.");
  }
  const bytes = await readVerified(
    control,
    { size: control.size, sha256: control.sha256 },
    MAX_MANIFEST_BYTES,
  );
  if (bytes === undefined) throw new Error("Candidate control manifest has no bytes.");
  const manifest = artifactManifestSchema.parse(JSON.parse(Buffer.from(bytes).toString("utf8")));
  if (manifest.snapshotId !== snapshotId)
    throw new Error("Candidate controls do not belong to current snapshot.");
  let total = bytes.byteLength;
  for (const artifact of manifest.artifacts) {
    total += artifact.size;
    if (
      total > MAX_TOTAL_BYTES ||
      (artifact.encoding === "identity" && artifact.size > MAX_IDENTITY_BYTES)
    )
      throw new Error("Candidate controls exceed reviewed restoration bounds.");
  }
  await writeFile(join(root, ARTIFACT_MANIFEST_PATH), bytes, { flag: "wx" });
  await runBounded(manifest.artifacts, async (artifact) => {
    const key =
      artifact.logicalPath === "v1/meta.json" ? `${prefix}${artifact.path}` : artifact.path;
    const object = await store.get(key);
    if (object === null) throw new Error("Restoration object is missing.");
    try {
      if (object.size !== artifact.size || object.sha256 !== artifact.sha256)
        throw new Error("Restoration object metadata differs from candidate controls.");
      const target = join(root, artifact.path);
      await mkdir(dirname(target), { recursive: true });
      const file = createWriteStream(target, { flags: "wx" });
      const hash = createHash("sha256");
      let size = 0;
      const verifier = new Transform({
        transform(chunk: unknown, _encoding, callback) {
          if (!(chunk instanceof Uint8Array)) {
            callback(new Error("Restoration body must contain bytes."));
            return;
          }
          size += chunk.byteLength;
          if (size > artifact.size) {
            callback(new Error("Restoration object exceeds declared size."));
            return;
          }
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      await pipeline(object.body, verifier, file);
      if (size !== artifact.size || hash.digest("hex") !== artifact.sha256)
        throw new Error("Restored object failed byte verification.");
    } finally {
      object.dispose();
    }
  });
  await validateCandidate(root);
  const empty = await mkdtemp(join(tmpdir(), "bcd-embed-baseline-digest-"));
  try {
    const report = await compareOutputTrees({ baselineRoot: empty, candidateRoot: root });
    if (report.candidateDigest !== candidateDigest)
      throw new Error("Restored baseline differs from published exact candidate digest.");
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
  const current = await readMetadata(store);
  if (current?.object.etag !== remote.object.etag || current.object.sha256 !== remote.object.sha256)
    throw new Error(
      "Published current changed during restoration; retry with a fresh empty directory.",
    );
  return { root, snapshotId, candidateDigest };
};
