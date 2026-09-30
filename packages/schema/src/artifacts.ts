import { z } from "zod";
import { featureKeySchema, namespaceSchema, snapshotIdentifierSchema } from "./schemas.js";

export const ARTIFACT_MANIFEST_PATH = ".bcd-embed-manifest.json";
export const contentEncodingSchema = z.enum(["identity", "br", "gzip"]);
export type ContentEncoding = z.infer<typeof contentEncodingSchema>;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

/** Internal object naming, not new public HTTP routes. */
export function representationPath(
  path: string,
  encoding: ContentEncoding,
  metaSha256?: string,
): string {
  if (encoding === "identity") return path;
  const suffix = encoding === "br" ? ".br" : ".gz";
  if (path !== "v1/meta.json") return `${path}${suffix}`;
  return `v1/_meta/${sha256Schema.parse(metaSha256)}.json${suffix}`;
}

export const artifactRepresentationSchema = z.strictObject({
  logicalPath: z.string(),
  encoding: contentEncodingSchema,
  path: z.string(),
  size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sha256: sha256Schema,
  etag: z.string().regex(/^"[a-f0-9]{64}"$/),
});
export type ArtifactRepresentation = z.infer<typeof artifactRepresentationSchema>;

const validLogicalPath = (path: string, snapshotId: string): boolean => {
  if (path === "v1/meta.json") return true;
  const prefix = `v1/${snapshotId}/`;
  if (!path.startsWith(prefix)) return false;
  const suffix = path.slice(prefix.length);
  if (suffix === "index.json" || suffix === "browsers.json") return true;
  const shard = /^index\/([^/]+)\.json$/.exec(suffix);
  if (shard) return namespaceSchema.safeParse(shard[1]).success;
  const feature = /^(?:features|raw)\/([^/]+)\.json$/.exec(suffix);
  return (
    feature !== null &&
    !feature[1]!.split(".").includes("") &&
    featureKeySchema.safeParse(feature[1]).success
  );
};

/** O(K) validation; consumers must additionally verify actual filesystem bytes. */
export const artifactManifestSchema = z
  .strictObject({
    version: z.literal(1),
    snapshotId: snapshotIdentifierSchema,
    artifacts: z.array(artifactRepresentationSchema).nonempty(),
  })
  .superRefine((manifest, context) => {
    const groups = new Map<string, Map<ContentEncoding, ArtifactRepresentation>>();
    const paths = new Set<string>();
    for (const artifact of manifest.artifacts) {
      if (
        !validLogicalPath(artifact.logicalPath, manifest.snapshotId) ||
        paths.has(artifact.path) ||
        artifact.etag !== `"${artifact.sha256}"`
      ) {
        context.addIssue({
          code: "custom",
          message: "Unsafe, duplicate, or inconsistent artifact representation.",
        });
      }
      paths.add(artifact.path);
      const group = groups.get(artifact.logicalPath) ?? new Map();
      if (group.has(artifact.encoding))
        context.addIssue({ code: "custom", message: "Duplicate artifact encoding." });
      group.set(artifact.encoding, artifact);
      groups.set(artifact.logicalPath, group);
    }
    if (!groups.has("v1/meta.json"))
      context.addIssue({ code: "custom", message: "Canonical metadata missing." });
    for (const [path, group] of groups) {
      const identity = group.get("identity");
      if (identity === undefined || group.size !== 3) {
        context.addIssue({
          code: "custom",
          message: "Every artifact requires identity, Brotli, and gzip representations.",
        });
        continue;
      }
      if (!sha256Schema.safeParse(identity.sha256).success) continue;
      for (const artifact of group.values()) {
        if (artifact.path !== representationPath(path, artifact.encoding, identity.sha256)) {
          context.addIssue({
            code: "custom",
            message: "Representation path does not match its logical artifact.",
          });
        }
      }
    }
  });
export type ArtifactManifest = z.infer<typeof artifactManifestSchema>;
