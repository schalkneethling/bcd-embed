import { Readable } from "node:stream";

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type { PublicationStore, PutObject, PutResult, StoredObject } from "./store.js";

export type R2S3Options = {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

const isS3Error = (error: unknown, name: string): boolean =>
  error instanceof Error && error.name === name;

const REQUEST_TIMEOUT_MS = 60_000;
const withDeadline = async <T>(action: (signal: AbortSignal) => Promise<T>): Promise<T> => {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await action(controller.signal);
  } finally {
    clearTimeout(deadline);
  }
};

const objectBody = async function* (
  body: AsyncIterable<unknown>,
  clearDeadline: () => void,
  didTimeout: () => boolean,
): AsyncGenerator<Uint8Array> {
  try {
    for await (const chunk of body) {
      if (!(chunk instanceof Uint8Array)) throw new Error("R2 returned a non-byte object body.");
      yield chunk;
    }
    if (didTimeout()) throw new Error("R2 object read exceeded its deadline.");
  } finally {
    clearDeadline();
  }
};

/** Node-side S3 adapter. No account operations happen until methods are invoked. */
export const createR2S3Store = (options: R2S3Options): PublicationStore => {
  if (!/^[a-f0-9]{32}$/.test(options.accountId)) throw new Error("Invalid R2 account ID.");
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(options.bucket)) {
    throw new Error("Invalid R2 bucket name.");
  }
  if (!options.accessKeyId || !options.secretAccessKey) {
    throw new Error("R2 S3 credentials are required.");
  }
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${options.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  const Bucket = options.bucket;
  return {
    async get(key): Promise<StoredObject | null> {
      const controller = new AbortController();
      let body: Readable | undefined;
      let timedOut = false;
      const deadline = setTimeout(() => {
        timedOut = true;
        controller.abort();
        body?.destroy();
      }, REQUEST_TIMEOUT_MS);
      const dispose = (): void => {
        clearTimeout(deadline);
        controller.abort();
        body?.destroy();
      };
      try {
        const result = await client.send(new GetObjectCommand({ Bucket, Key: key }), {
          abortSignal: controller.signal,
        });
        if (result.Body instanceof Readable) body = result.Body;
        if (
          body === undefined ||
          result.ETag === undefined ||
          !/^"[\x21\x23-\x7e\x80-\xff]*"$/.test(result.ETag)
        ) {
          throw new Error("R2 returned an object without an iterable body or ETag.");
        }
        if (
          result.ContentLength === undefined ||
          !Number.isSafeInteger(result.ContentLength) ||
          result.ContentLength < 0
        ) {
          throw new Error("R2 object has no length.");
        }
        return {
          body: objectBody(body, dispose, () => timedOut),
          dispose,
          etag: result.ETag,
          metadata: result.Metadata ?? {},
          size: result.ContentLength,
          sha256: result.Metadata?.sha256,
        };
      } catch (error) {
        dispose();
        if (isS3Error(error, "NoSuchKey") || isS3Error(error, "NotFound")) return null;
        throw error;
      }
    },
    async put(input: PutObject): Promise<PutResult> {
      try {
        const result = await withDeadline((abortSignal) =>
          client.send(
            new PutObjectCommand({
              Bucket,
              Key: input.key,
              Body: input.body,
              ContentLength: input.size,
              ContentType: input.contentType,
              ContentEncoding: input.contentEncoding,
              Metadata: { ...input.metadata, sha256: input.sha256 },
              IfMatch: input.ifMatch,
              IfNoneMatch: input.ifNoneMatch ? "*" : undefined,
            }),
            { abortSignal },
          ),
        );
        if (result.ETag === undefined) throw new Error("R2 PUT returned no ETag.");
        return { type: "stored", etag: result.ETag };
      } catch (error) {
        if (
          isS3Error(error, "PreconditionFailed") ||
          isS3Error(error, "ConditionalRequestConflict")
        ) {
          return { type: "precondition-failed" };
        }
        throw error;
      }
    },
    async list(prefix, startAfter, limit) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
        throw new Error("R2 list limit must be 1..1000.");
      }
      const result = await withDeadline((abortSignal) =>
        client.send(
          new ListObjectsV2Command({
            Bucket,
            Prefix: prefix,
            StartAfter: startAfter,
            MaxKeys: limit,
          }),
          { abortSignal },
        ),
      );
      if ((result.Contents ?? []).some((item) => item.Key === undefined))
        throw new Error("R2 listing returned an object without a key.");
      return {
        keys: (result.Contents ?? []).flatMap((item) => (item.Key === undefined ? [] : [item.Key])),
        truncated: result.IsTruncated === true,
      };
    },
    async delete(keys) {
      if (keys.length === 0) return;
      if (keys.length > 1_000) throw new Error("R2 batch delete exceeds 1000 keys.");
      const result = await withDeadline((abortSignal) =>
        client.send(
          new DeleteObjectsCommand({
            Bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
          }),
          { abortSignal },
        ),
      );
      if ((result.Errors?.length ?? 0) > 0) throw new Error("R2 batch deletion failed.");
    },
  };
};
