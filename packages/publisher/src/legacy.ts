import { snapshotIdentifierSchema } from "@bcd-embed/schema";

import { PublisherError } from "./errors.js";
import { listingProblem } from "./listing.js";
import { readMetadata } from "./objects.js";
import type { ListPage, PublicationStore } from "./store.js";

const PAGE_SIZE = 1_000;

/**
 * Lists every key under a prefix, page by page, with R2's continuation token. Each page passes the
 * same order-free checks as retention cleanup before `visit` sees it, so a page that repeats keys
 * or loops is never acted on. Cost: one listing per 1,000 keys and one remembered cursor per page.
 */
const forEachPage = async (
  store: PublicationStore,
  prefix: string,
  visit: (page: ListPage) => Promise<void>,
): Promise<void> => {
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (let pageNumber = 1; ; pageNumber += 1) {
    const page = await store.list(prefix, cursor, PAGE_SIZE);
    const problem = listingProblem(prefix, page, seenCursors);
    if (problem !== undefined)
      throw new PublisherError(`Listing ${prefix} failed on page ${pageNumber}: ${problem}`);
    await visit(page);
    if (page.cursor === undefined) return;
    seenCursors.add(page.cursor);
    cursor = page.cursor;
  }
};

export type BucketSummary = {
  /** Keys under `v1/`, counted by their first path segment, such as `blobs/` or `meta.json`. */
  groups: Record<string, number>;
};

/** Counts what the bucket holds under `v1/`, without reading or changing any object. */
export const summarizeBucket = async (store: PublicationStore): Promise<BucketSummary> => {
  const groups = new Map<string, number>();
  await forEachPage(store, "v1/", async ({ objects }) => {
    for (const { key } of objects) {
      const rest = key.slice("v1/".length);
      const slash = rest.indexOf("/");
      const group = slash === -1 ? rest : rest.slice(0, slash + 1);
      groups.set(group, (groups.get(group) ?? 0) + 1);
    }
  });
  return {
    groups: Object.fromEntries([...groups].sort(([left], [right]) => (left < right ? -1 : 1))),
  };
};

export type LegacyDeletion = {
  prefix: string;
  /** True when nothing was deleted and `matched` says what a real run would delete. */
  dryRun: boolean;
  matched: number;
  deleted: number;
  /** Keys still under the prefix after the run, counted by listing it again. */
  remaining: number;
};

/**
 * Deletes the folder `v1/<snapshot>/` that the pre-Document 8 publisher wrote, one page at a time.
 *
 * A snapshot identifier always starts with `bcd-` and has no slash, so the prefix cannot reach
 * `v1/blobs/`, `v1/shards/`, `v1/snapshots/`, `v1/_meta/`, or `v1/_publication/`. A snapshot that
 * `meta.json` lists is refused, because only a folder nothing can serve is safe to remove. A real
 * run lists the prefix again afterwards and reports what is left, so a run that missed keys says so.
 */
export const deleteLegacySnapshot = async (
  store: PublicationStore,
  snapshotId: string,
  { dryRun = true }: { dryRun?: boolean } = {},
): Promise<LegacyDeletion> => {
  if (!snapshotIdentifierSchema.safeParse(snapshotId).success)
    throw new PublisherError("Invalid snapshot identifier.");
  const metadata = await readMetadata(store);
  if (metadata === null)
    throw new PublisherError("Canonical metadata is required before deleting.");
  if (
    metadata.body.current === snapshotId ||
    metadata.body.snapshots.some(({ id }) => id === snapshotId)
  ) {
    throw new PublisherError("meta.json lists this snapshot; only an unlisted folder is deleted.");
  }

  const prefix = `v1/${snapshotId}/`;
  let matched = 0;
  let deleted = 0;
  await forEachPage(store, prefix, async ({ objects }) => {
    matched += objects.length;
    if (dryRun || objects.length === 0) return;
    await store.delete(objects.map(({ key }) => key));
    deleted += objects.length;
  });
  let remaining = matched;
  if (!dryRun) {
    remaining = 0;
    await forEachPage(store, prefix, async ({ objects }) => {
      remaining += objects.length;
    });
  }
  return { prefix, dryRun, matched, deleted, remaining };
};
