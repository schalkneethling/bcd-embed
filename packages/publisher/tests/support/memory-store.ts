import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import type { PublicationStore, PutObject, PutResult, StoredObject } from "../../src/store.js";

/** An in-memory bucket with switches that simulate the R2 failures the publisher must survive. */
export class MemoryStore implements PublicationStore {
  objects = new Map<
    string,
    { bytes: Buffer; etag: string; metadata: Record<string, string>; modified: Date }
  >();
  puts: string[] = [];
  gets = 0;
  lists = 0;
  /** The date new objects are stamped with. */
  now = new Date("2026-01-01T12:00:00Z");
  failAfter: number | undefined;
  /** Throws this many times on PUT, as a dropped connection would, then works. */
  transientPutFailures = 0;
  corruptKey: string | undefined;
  raceOnMeta = false;
  failDelete = false;
  throwOnMetaPutAfterWrite = false;
  throwOnMetaGetAfterPut = false;
  repeatedPage = false;
  /** The most keys one listing page returns, so tests can force several pages. */
  maxPage = Number.POSITIVE_INFINITY;
  onDelete: (() => void) | undefined;

  async get(key: string): Promise<StoredObject | null> {
    this.gets += 1;
    if (this.throwOnMetaGetAfterPut && key === "v1/meta.json" && this.puts.includes(key)) {
      throw new Error("Simulated readback failure");
    }
    const object = this.objects.get(key);
    if (object === undefined) return null;
    return {
      body: Readable.from([object.bytes]),
      dispose: () => {},
      etag: object.etag,
      lastModified: object.modified,
      metadata: object.metadata,
      sha256: object.metadata.sha256,
      size: object.bytes.byteLength,
    };
  }

  async put(input: PutObject): Promise<PutResult> {
    if (this.transientPutFailures > 0) {
      this.transientPutFailures -= 1;
      throw new Error("Simulated dropped connection");
    }
    if (this.failAfter !== undefined && this.puts.length >= this.failAfter) {
      throw new Error("Simulated interrupted upload");
    }
    const old = this.objects.get(input.key);
    if (this.raceOnMeta && input.key === "v1/meta.json") return { type: "precondition-failed" };
    if (
      (input.ifNoneMatch && old !== undefined) ||
      (input.ifMatch && old?.etag !== input.ifMatch)
    ) {
      return { type: "precondition-failed" };
    }
    if (!(input.body instanceof Uint8Array)) throw new Error("Test store expects buffers.");
    const bytes = Buffer.from(input.body);
    if (this.corruptKey === input.key) bytes[0] = (bytes[0] ?? 0) ^ 1;
    const etag = `"${createHash("md5").update(bytes).digest("hex")}"`;
    this.objects.set(input.key, {
      bytes,
      etag,
      metadata: { ...input.metadata, sha256: input.sha256 },
      modified: this.now,
    });
    this.puts.push(input.key);
    if (this.throwOnMetaPutAfterWrite && input.key === "v1/meta.json") {
      throw new Error("Simulated connection loss after commit");
    }
    return { type: "stored", etag };
  }

  /**
   * Lists in the order R2 was seen to use, which puts `<hash>.json.br` and `<hash>.json.gz` before
   * `<hash>.json`, unlike a byte-wise sort. The cursor is opaque to callers. Here it holds the last
   * key returned, so deleting keys that were already listed does not shift the next page.
   */
  async list(prefix: string, cursor: string | undefined, limit: number) {
    this.lists += 1;
    const r2Order = (key: string) => `${key}\uffff`;
    const all = [...this.objects.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([left], [right]) => (r2Order(left) < r2Order(right) ? -1 : 1))
      .map(([key, { modified }]) => ({ key, lastModified: modified }));
    if (this.repeatedPage) return { objects: all.slice(0, 1), cursor: "same-cursor" };
    const after = cursor === undefined ? undefined : Buffer.from(cursor, "base64url").toString();
    const remaining = all.filter(({ key }) => after === undefined || r2Order(key) > r2Order(after));
    const objects = remaining.slice(0, Math.min(limit, this.maxPage));
    return {
      objects,
      cursor:
        remaining.length > objects.length
          ? Buffer.from(objects.at(-1)!.key).toString("base64url")
          : undefined,
    };
  }

  async delete(keys: readonly string[]) {
    if (this.failDelete) throw new Error("Simulated cleanup interruption");
    this.onDelete?.();
    for (const key of keys) this.objects.delete(key);
  }

  keys(prefix: string): string[] {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
  }
}
