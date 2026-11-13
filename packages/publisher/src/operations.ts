import type { PublicationStore } from "./store.js";

/**
 * R2 bills by operation class. Class A is writes and listings, Class B is reads, and deletes are
 * free. Counting them per run shows what a publication cost and makes a regression visible.
 */
export type OperationCounts = { classA: number; classB: number; deletes: number };

/** Wraps a store so that every request it makes is counted. The counts object is live. */
export const countOperations = (
  store: PublicationStore,
): { store: PublicationStore; counts: OperationCounts } => {
  const counts: OperationCounts = { classA: 0, classB: 0, deletes: 0 };
  return {
    counts,
    store: {
      get(key) {
        counts.classB += 1;
        return store.get(key);
      },
      put(input) {
        counts.classA += 1;
        return store.put(input);
      },
      list(prefix, startAfter, limit) {
        counts.classA += 1;
        return store.list(prefix, startAfter, limit);
      },
      delete(keys) {
        if (keys.length > 0) counts.deletes += 1;
        return store.delete(keys);
      },
    },
  };
};
