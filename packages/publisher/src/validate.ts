import { createHash } from "node:crypto";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createBrotliDecompress, createGunzip } from "node:zlib";

import { loadContentTree, MAX_META_BYTES, type LocalContentTree } from "@bcd-embed/generator";

import { PublisherError } from "./errors.js";

export { MAX_META_BYTES };
/** A root lists 256 hashes; a shard holds about 82 keys. Both stay far below these caps. */
export const MAX_ROOT_BYTES = 256 * 1024;
export const MAX_SHARD_BYTES = 2 * 1024 * 1024;

export const hashDecodedStream = async (
  input: NodeJS.ReadableStream,
  encoding: "br" | "gzip",
  maximumSize: number,
) => {
  const hash = createHash("sha256");
  let size = 0;
  const sink = new Writable({
    write(chunk: unknown, _encoding, callback) {
      if (!(chunk instanceof Uint8Array)) {
        callback(new PublisherError("Decoder returned non-byte content."));
        return;
      }
      size += chunk.byteLength;
      if (size > maximumSize) {
        callback(new PublisherError("Decoded artifact exceeds its declared identity size."));
        return;
      }
      hash.update(chunk);
      callback();
    },
  });
  await pipeline(input, encoding === "br" ? createBrotliDecompress() : createGunzip(), sink);
  return { sha256: hash.digest("hex"), size };
};

export type ValidatedCandidate = LocalContentTree;

/**
 * Reads the local candidate and checks all of it: every pointer, every blob's hash, both
 * compressed copies, every schema, and that the folder holds nothing else. See `loadContentTree`.
 */
export const validateCandidate = async (candidateRoot: string): Promise<ValidatedCandidate> => {
  const candidate = await loadContentTree(candidateRoot);
  if (candidate === null) throw new PublisherError("Candidate tree must not be empty.");
  if (candidate.meta.generated !== candidate.meta.snapshots[0]!.generated)
    throw new PublisherError("Candidate metadata does not match its snapshot's generation time.");
  return candidate;
};
