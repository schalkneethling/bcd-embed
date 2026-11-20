import type { FeatureResponse } from "@bcd-embed/schema";

export type { MessageId, MessageValues, StringTable } from "./strings/format.js";

/**
 * The payload that the `.data` property and the `source` attribute carry: a feature response from
 * the API contract. This is a type-only import, so the built package holds no schema code.
 */
export type CompatTableData = FeatureResponse;

/** The values of the `loading` attribute. It mirrors the native `<img loading>` attribute. */
export type CompatTableLoading = "lazy" | "eager";
