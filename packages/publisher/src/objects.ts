import { createHash } from "node:crypto";
import { metaResponseSchema, type MetaResponse } from "@bcd-embed/schema";
import type { PublicationStore, PutObject, PutResult, StoredObject } from "./store.js";
import { MAX_META_BYTES } from "./validate.js";
const META_KEY = "v1/meta.json";

export const readVerified = async (
  object: StoredObject,
  expected: { size: number; sha256: string },
  maxBytes?: number,
): Promise<Uint8Array | void> => {
  const hash = createHash("sha256");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (object.size !== expected.size || (maxBytes !== undefined && object.size > maxBytes)) {
      throw new Error("Stored object exceeds its declared size cap.");
    }
    for await (const chunk of object.body) {
      if (!(chunk instanceof Uint8Array)) throw new Error("Stored object body must contain bytes.");
      size += chunk.byteLength;
      if (size > expected.size || (maxBytes !== undefined && size > maxBytes)) {
        throw new Error("Stored object exceeds its declared size cap.");
      }
      hash.update(chunk);
      if (maxBytes !== undefined && chunk.byteLength > 0) chunks.push(chunk);
    }
    if (
      size !== expected.size ||
      object.size !== expected.size ||
      hash.digest("hex") !== expected.sha256 ||
      object.sha256 !== expected.sha256
    ) {
      throw new Error("Stored object bytes or checksum do not match expected content.");
    }
    return maxBytes === undefined ? undefined : Buffer.concat(chunks);
  } finally {
    object.dispose();
  }
};

export const readMetadata = async (
  store: PublicationStore,
): Promise<{ body: MetaResponse; object: StoredObject } | null> => {
  const object = await store.get(META_KEY);
  if (object === null) return null;
  if (
    !Number.isSafeInteger(object.size) ||
    object.size < 0 ||
    object.size > MAX_META_BYTES ||
    object.sha256 === undefined ||
    !/^[a-f0-9]{64}$/.test(object.sha256)
  ) {
    object.dispose();
    throw new Error("Published metadata has no bounded verified SHA-256.");
  }
  const bytes = await readVerified(
    object,
    { size: object.size, sha256: object.sha256 },
    MAX_META_BYTES,
  );
  if (bytes === undefined) throw new Error("Metadata read returned no bytes.");
  return {
    body: metaResponseSchema.parse(JSON.parse(Buffer.from(bytes).toString("utf8"))),
    object,
  };
};

export const putAndVerify = async (store: PublicationStore, input: PutObject): Promise<void> => {
  let result: PutResult;
  try {
    result = await store.put(input);
  } finally {
    if (!(input.body instanceof Uint8Array)) input.body.destroy();
  }
  const object = await store.get(input.key);
  if (object === null) throw new Error(`Published object '${input.key}' is missing after PUT.`);
  await readVerified(object, { size: input.size, sha256: input.sha256 });
  if (result.type === "precondition-failed" && !input.ifNoneMatch) {
    throw new Error("Mutable metadata compare-and-swap lost a concurrent race.");
  }
};
