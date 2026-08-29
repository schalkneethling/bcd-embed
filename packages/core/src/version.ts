import type { VersionValue } from "@bcd-embed/schema";

export type RawVersionValue = string | false | null;

export type NormalizedVersion = {
  value: VersionValue;
  approximate: boolean;
  preview: boolean;
};

/** Preserve BCD's approximate and preview semantics while normalizing its wire value. */
export const normalizeVersion = (raw: RawVersionValue): NormalizedVersion => {
  if (raw === false || raw === null) {
    return { value: raw, approximate: false, preview: false };
  }

  const approximate = raw.startsWith("≤");
  const value = approximate ? raw.slice(1) : raw;
  if (value.length === 0) throw new Error("A BCD version value must be non-empty.");

  return {
    value,
    approximate,
    preview: value === "preview",
  };
};
