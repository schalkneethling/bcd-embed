import { Readable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn<
    (
      command: { input: unknown },
      options: { abortSignal: AbortSignal },
    ) => Promise<Record<string, unknown>>
  >(),
  client: vi.fn<(options: unknown) => void>(),
}));
vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const original = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return {
    ...original,
    S3Client: class {
      constructor(options: unknown) {
        mocks.client(options);
      }
      send = mocks.send;
    },
  };
});

import { createR2S3Store } from "../src/r2-s3.js";

const options = {
  accountId: "0".repeat(32),
  bucket: "artifact-test",
  accessKeyId: "test-key",
  secretAccessKey: "test-secret",
};
afterEach(() => {
  vi.useRealTimers();
  mocks.send.mockReset();
  mocks.client.mockClear();
});

describe("R2 S3 adapter", () => {
  it("constructs only the scoped endpoint, without requests", () => {
    createR2S3Store(options);
    expect(mocks.client).toHaveBeenCalledWith(
      expect.objectContaining({
        region: "auto",
        endpoint: `https://${options.accountId}.r2.cloudflarestorage.com`,
        requestChecksumCalculation: "WHEN_REQUIRED",
      }),
    );
    expect(mocks.send).not.toHaveBeenCalled();
    expect(() => createR2S3Store({ ...options, accountId: "../secret" })).toThrow("account");
    expect(() => createR2S3Store({ ...options, bucket: "../secret" })).toThrow("bucket");
    expect(() => createR2S3Store({ ...options, accessKeyId: "" })).toThrow("credentials");
  });

  it("cleans the deadline and stream even before body consumption", async () => {
    vi.useFakeTimers();
    const body = Readable.from([Buffer.from("abc")]);
    mocks.send.mockResolvedValue({
      Body: body,
      ETag: '"etag"',
      ContentLength: 3,
      Metadata: { sha256: "a".repeat(64) },
    });
    const object = await createR2S3Store(options).get("v1/meta.json");
    expect(object?.size).toBe(3);
    expect(vi.getTimerCount()).toBe(1);
    object?.dispose();
    expect(body.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("validates returned metadata and disposes malformed streams", async () => {
    vi.useFakeTimers();
    for (const metadata of [
      { ETag: "weak", ContentLength: 3 },
      { ETag: '"etag"', ContentLength: -1 },
      { ETag: '"etag"', ContentLength: Number.NaN },
    ]) {
      const body = Readable.from([Buffer.from("abc")]);
      mocks.send.mockResolvedValue({ Body: body, ...metadata });
      await expect(createR2S3Store(options).get("key")).rejects.toThrow();
      expect(body.destroyed).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it("streams byte chunks and clears the deadline on completion or non-byte failure", async () => {
    vi.useFakeTimers();
    mocks.send.mockResolvedValue({
      Body: Readable.from([Buffer.from("abc")]),
      ETag: '"etag"',
      ContentLength: 3,
    });
    const object = await createR2S3Store(options).get("key");
    const chunks = [];
    for await (const chunk of object!.body) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString()).toBe("abc");
    expect(vi.getTimerCount()).toBe(0);
    mocks.send.mockResolvedValue({
      Body: Readable.from(["not bytes"]),
      ETag: '"etag"',
      ContentLength: 9,
    });
    const invalid = await createR2S3Store(options).get("key");
    await expect(async () => {
      for await (const chunk of invalid!.body) void chunk;
    }).rejects.toThrow("non-byte");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts an outstanding GET and releases its timer", async () => {
    vi.useFakeTimers();
    mocks.send.mockImplementation(
      (_command, { abortSignal }) =>
        new Promise((_resolve, reject) => {
          abortSignal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    );
    const pending = createR2S3Store(options).get("key");
    const assertion = expect(pending).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("destroys a stalled response body at its total read deadline", async () => {
    vi.useFakeTimers();
    const body = new Readable({ read() {} });
    mocks.send.mockResolvedValue({ Body: body, ETag: '"etag"', ContentLength: 3 });
    const object = await createR2S3Store(options).get("key");
    const pending = (async () => {
      for await (const chunk of object!.body) void chunk;
    })();
    const assertion = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    expect(body.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses create-only and compare-and-swap fields with exact byte metadata", async () => {
    vi.useFakeTimers();
    const store = createR2S3Store(options);
    mocks.send.mockResolvedValue({ ETag: '"stored"' });
    const input = {
      key: "v1/key.json.br",
      body: new Uint8Array([1]),
      size: 1,
      sha256: "a".repeat(64),
      contentType: "application/json",
      contentEncoding: "br" as const,
    };
    expect(await store.put({ ...input, ifNoneMatch: true })).toEqual({
      type: "stored",
      etag: '"stored"',
    });
    expect(mocks.send.mock.calls[0]![0].input).toMatchObject({
      Bucket: options.bucket,
      Key: input.key,
      IfNoneMatch: "*",
      ContentLength: 1,
      ContentEncoding: "br",
      Metadata: { sha256: input.sha256 },
    });
    await store.put({ ...input, ifMatch: '"prior"', metadata: { "tree-digest": "b".repeat(64) } });
    expect(mocks.send.mock.calls[1]![0].input).toMatchObject({
      IfMatch: '"prior"',
      Metadata: { sha256: input.sha256, "tree-digest": "b".repeat(64) },
    });
    expect(vi.getTimerCount()).toBe(0);
    for (const name of ["PreconditionFailed", "ConditionalRequestConflict"]) {
      mocks.send.mockRejectedValue(Object.assign(new Error("conditional"), { name }));
      expect(await store.put(input)).toEqual({ type: "precondition-failed" });
    }
    mocks.send.mockRejectedValue(Object.assign(new Error("forbidden"), { name: "AccessDenied" }));
    await expect(store.put(input)).rejects.toThrow("forbidden");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("distinguishes missing objects from failures", async () => {
    const store = createR2S3Store(options);
    for (const name of ["NoSuchKey", "NotFound"]) {
      mocks.send.mockRejectedValue(Object.assign(new Error("missing"), { name }));
      expect(await store.get("key")).toBeNull();
    }
    mocks.send.mockRejectedValue(new Error("backend"));
    await expect(store.get("key")).rejects.toThrow("backend");
  });

  it("bounds paginated list and deletion operations", async () => {
    vi.useFakeTimers();
    const store = createR2S3Store(options);
    mocks.send.mockResolvedValue({ Contents: [{ Key: "prefix/a" }], IsTruncated: true });
    expect(await store.list("prefix/", "prefix/0", 500)).toEqual({
      keys: ["prefix/a"],
      truncated: true,
    });
    expect(mocks.send.mock.calls[0]![0].input).toEqual({
      Bucket: options.bucket,
      Prefix: "prefix/",
      StartAfter: "prefix/0",
      MaxKeys: 500,
    });
    for (const limit of [0, 1001, 1.5])
      await expect(store.list("prefix/", undefined, limit)).rejects.toThrow("limit");
    mocks.send.mockResolvedValue({ Contents: [{}] });
    await expect(store.list("prefix/", undefined, 500)).rejects.toThrow("without a key");
    mocks.send.mockResolvedValue({});
    await store.delete(["a", "b"]);
    expect(mocks.send.mock.lastCall?.[0].input).toMatchObject({
      Delete: { Objects: [{ Key: "a" }, { Key: "b" }], Quiet: true },
    });
    await expect(store.delete(Array.from({ length: 1001 }, () => "x"))).rejects.toThrow("1000");
    mocks.send.mockResolvedValue({ Errors: [{ Key: "a" }] });
    await expect(store.delete(["a"])).rejects.toThrow("failed");
    expect(vi.getTimerCount()).toBe(0);
  });
});
