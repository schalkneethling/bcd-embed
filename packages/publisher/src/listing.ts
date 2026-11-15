import type { ListPage } from "./store.js";

/**
 * Why a listing page cannot be trusted, or undefined when it can. Every key must be inside the
 * prefix and appear once on the page, and a page that continues must have keys and a cursor not
 * seen before, or the listing could loop forever. None of this assumes an order, because R2 lists
 * `<hash>.json.br` and `<hash>.json.gz` before `<hash>.json`. Answers name a position on the page,
 * never a key, because R2 controls that text.
 */
export const listingProblem = (
  prefix: string,
  page: ListPage,
  seenCursors: ReadonlySet<string>,
): string | undefined => {
  const keys = new Set<string>();
  for (const [index, { key }] of page.objects.entries()) {
    const position = `key ${index + 1} of ${page.objects.length}`;
    if (!key.startsWith(prefix)) return `R2 returned a key outside the prefix at ${position}.`;
    if (keys.has(key)) return `R2 returned ${position} twice on the same page.`;
    keys.add(key);
  }
  if (page.cursor === undefined) return undefined;
  if (page.objects.length === 0) return "R2 said the listing continues but returned no keys.";
  if (seenCursors.has(page.cursor))
    return "R2 returned a continuation token it had already returned.";
  return undefined;
};
