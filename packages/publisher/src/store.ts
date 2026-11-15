import type { Readable } from "node:stream";

/** Storage operations needed by the publication state machine. */
export type StoredObject = {
  body: AsyncIterable<Uint8Array>;
  /** Release the body and deadline, including when it is rejected before consumption. */
  dispose(): void;
  etag: string;
  /** When the object was written. */
  lastModified: Date;
  metadata: Readonly<Record<string, string>>;
  size: number;
  sha256: string | undefined;
};

export type PutObject = {
  body: Readable | Uint8Array;
  contentEncoding?: "br" | "gzip";
  contentType: string;
  ifMatch?: string;
  ifNoneMatch?: true;
  key: string;
  metadata?: Readonly<Record<string, string>>;
  sha256: string;
  size: number;
};

export type ListedObject = { key: string; lastModified: Date };

/**
 * One page of a listing. `cursor` is the store's own opaque token for the next page, and is
 * undefined on the last page. Callers pass it back unchanged and never derive one from a key,
 * because R2 does not order keys the way a byte-wise comparison does.
 */
export type ListPage = { objects: readonly ListedObject[]; cursor: string | undefined };

export type PutResult = { type: "stored"; etag: string } | { type: "precondition-failed" };

export interface PublicationStore {
  get(key: string): Promise<StoredObject | null>;
  put(input: PutObject): Promise<PutResult>;
  /** Lists keys under `prefix`, in the store's own order. `lastModified` is when the object was written. */
  list(prefix: string, cursor: string | undefined, limit: number): Promise<ListPage>;
  delete(keys: readonly string[]): Promise<void>;
}
