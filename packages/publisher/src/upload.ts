import { Readable } from "node:stream";

import { PublisherError } from "./errors.js";
import { readVerified } from "./objects.js";
import type { PublicationStore } from "./store.js";
import { hashDecodedStream } from "./validate.js";

const CONTENT_TYPE = "application/json; charset=utf-8";
/** Waits before the second and third attempt. A fourth failure is reported. */
const RETRY_DELAYS_MS = [500, 2_000];

export type Sleep = (milliseconds: number) => Promise<void>;
export const realSleep: Sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Retries a request that failed in transit. An integrity failure is a `PublisherError` and is not
 * retried, because the same bytes would fail the same way; a timeout is retried.
 */
export const withRetries = async <T>(action: () => Promise<T>, sleep: Sleep): Promise<T> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt];
      const permanent = error instanceof PublisherError && error.name !== "PublisherTimeoutError";
      if (permanent || delay === undefined) throw error;
      await sleep(delay);
    }
  }
};

export type ImmutableObject = {
  key: string;
  bytes: Uint8Array;
  sha256: string;
  /** Set for a compressed copy, with the size and hash of the plain bytes it must decode to. */
  encoded?: { encoding: "br" | "gzip"; identity: { size: number; sha256: string } };
};

/**
 * Stores an object whose name is derived from its content, then reads it back and verifies it.
 *
 * The write succeeds only if the name is unused. A refused write means an earlier snapshot or an
 * interrupted run already stored the object, and the read-back verifies that copy instead. A
 * compressed copy stored by another zlib or Brotli build may differ in its bytes, so it is
 * accepted when it decodes to the expected plain bytes.
 *
 * The body is a buffer, not a stream, so a retry sends the same bytes again.
 */
export const putImmutable = async (
  store: PublicationStore,
  object: ImmutableObject,
  sleep: Sleep,
): Promise<"stored" | "existing"> =>
  withRetries(async () => {
    const result = await store.put({
      key: object.key,
      body: object.bytes,
      size: object.bytes.byteLength,
      sha256: object.sha256,
      contentType: CONTENT_TYPE,
      contentEncoding: object.encoded?.encoding,
      ifNoneMatch: true,
    });
    const stored = await store.get(object.key);
    if (stored === null) throw new PublisherError("Published object is missing after PUT.");
    if (result.type === "stored" || object.encoded === undefined) {
      await readVerified(stored, { size: object.bytes.byteLength, sha256: object.sha256 });
      return result.type === "stored" ? "stored" : "existing";
    }
    const { encoding, identity } = object.encoded;
    try {
      const decoded = await hashDecodedStream(Readable.from(stored.body), encoding, identity.size);
      if (decoded.size === identity.size && decoded.sha256 === identity.sha256) return "existing";
    } catch (error) {
      if (error instanceof PublisherError) throw error;
    } finally {
      stored.dispose();
    }
    throw new PublisherError("Existing compressed object does not decode to the expected bytes.");
  }, sleep);
