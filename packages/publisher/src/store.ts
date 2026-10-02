import type { Readable } from "node:stream";

/** Storage operations needed by the publication state machine. */
export type StoredObject = {
  body: AsyncIterable<Uint8Array>;
  /** Release the body and deadline, including when it is rejected before consumption. */
  dispose(): void;
  etag: string;
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

export type PutResult = { type: "stored"; etag: string } | { type: "precondition-failed" };

export interface PublicationStore {
  get(key: string): Promise<StoredObject | null>;
  put(input: PutObject): Promise<PutResult>;
  list(
    prefix: string,
    startAfter: string | undefined,
    limit: number,
  ): Promise<{ keys: readonly string[]; truncated: boolean }>;
  delete(keys: readonly string[]): Promise<void>;
}
