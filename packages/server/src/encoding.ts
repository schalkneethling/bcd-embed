import type { ContentEncoding } from "@bcd-embed/schema";
export { representationPath, type ContentEncoding } from "@bcd-embed/schema";

/** RFC 9110 §§12.4.2,12.5.3. Invalid/ambiguous input is rejected (null).
 * Missing/empty headers select identity; equal coded weights prefer Brotli.
 */
export function negotiateEncoding(
  value: string | null,
  available: readonly ContentEncoding[] = ["br", "gzip", "identity"],
): ContentEncoding | null {
  if (value === null || value.trim() === "")
    return available.includes("identity") ? "identity" : null;
  if (value.length > 8192) return null;
  const weights = new Map<string, number>();
  for (const item of value.split(",")) {
    if (item.trim() === "") continue;
    const match =
      /^\s*([!#$%&'*+.^_`|~0-9A-Za-z-]+)(?:\s*;\s*q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?\s*$/i.exec(
        item,
      );
    if (match === null) return null;
    const token = match[1]!.toLowerCase();
    if (weights.has(token)) return null;
    weights.set(token, match[2] === undefined ? 1 : Number(match[2]));
  }
  let selected: ContentEncoding | null = null;
  let best = 0;
  for (const coding of ["br", "gzip", "identity"] as const) {
    if (!available.includes(coding)) continue;
    // Default identity is a fallback, not a preference over explicitly accepted coding.
    const weight =
      weights.get(coding) ??
      (coding === "identity" ? (weights.get("*") === 0 ? 0 : 0.001) : (weights.get("*") ?? 0));
    if (weight > best) {
      best = weight;
      selected = coding;
    }
  }
  return selected;
}
