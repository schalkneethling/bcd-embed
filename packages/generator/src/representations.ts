import { createHash } from "node:crypto";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { representationPath, type ArtifactRepresentation } from "@bcd-embed/schema";

export type EncodedArtifact = ArtifactRepresentation & { bytes: Uint8Array };

/** Offline O(B) time/space per artifact, fixed settings; gzip embeds no wall-clock time. */
export function createRepresentations(logicalPath: string, bytes: Uint8Array): EncodedArtifact[] {
  const identitySha256 = createHash("sha256").update(bytes).digest("hex");
  return (
    [
      ["identity", bytes],
      ["br", brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })],
      ["gzip", gzipSync(bytes, { level: 6 })],
    ] as const
  ).map(([encoding, encoded]) => {
    const sha256 = createHash("sha256").update(encoded).digest("hex");
    return {
      logicalPath,
      encoding,
      path: representationPath(logicalPath, encoding, identitySha256),
      size: encoded.byteLength,
      sha256,
      etag: `"${sha256}"`,
      bytes: encoded,
    };
  });
}
