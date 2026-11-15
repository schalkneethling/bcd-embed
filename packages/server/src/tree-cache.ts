import type { Shard, SnapshotRoot } from "@bcd-embed/schema";

/** A map that forgets its least recently used entry once it holds `limit` entries. */
export class BoundedCache<Value> {
  readonly #entries = new Map<string, Value>();

  constructor(readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new RangeError("Cache limit must be at least 1.");
  }

  get(key: string): Value | undefined {
    const value = this.#entries.get(key);
    if (value === undefined) return undefined;
    // A Map iterates in insertion order, so reinserting marks the entry as most recently used.
    this.#entries.delete(key);
    this.#entries.set(key, value);
    return value;
  }

  set(key: string, value: Value): void {
    this.#entries.delete(key);
    this.#entries.set(key, value);
    if (this.#entries.size > this.limit) this.#entries.delete(this.#entries.keys().next().value!);
  }

  get size(): number {
    return this.#entries.size;
  }
}

/** Parsed roots and shards, keyed by their storage path. Both are immutable once published. */
export type TreeCache = {
  roots: BoundedCache<SnapshotRoot>;
  shards: BoundedCache<Shard>;
};

/**
 * One snapshot has 256 shards of about 16 KB each, so the default keeps every shard of the current
 * snapshot and a retained older one. Get and set are O(1).
 */
export const createTreeCache = ({ roots = 16, shards = 512 } = {}): TreeCache => ({
  roots: new BoundedCache(roots),
  shards: new BoundedCache(shards),
});
