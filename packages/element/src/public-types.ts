import type { FeatureResponse } from "@bcd-embed/schema";

export type { MessageId, MessageValues, StringTable } from "./strings/format.js";

/**
 * The payload that the `.data` property and the `source` attribute carry: a feature response from
 * the API contract. This is a type-only import, so the built package holds no schema code.
 */
export type CompatTableData = FeatureResponse;

/** The values of the `loading` attribute. It mirrors the native `<img loading>` attribute. */
export type CompatTableLoading = "lazy" | "eager";

/** Which input supplied the payload, or failed to. */
export type BcdMode = "data" | "source" | "fetch";

/** The `detail` of the `bcd-load` event. */
export type BcdLoadDetail = {
  readonly mode: BcdMode;
  /** In fetch mode, the response's `bcd-embed-snapshot` header. Null in every other mode. */
  readonly snapshot: string | null;
};

/** Why the element could not render a table. */
export type BcdErrorReason =
  | "invalid-query"
  | "invalid-endpoint"
  | "network"
  | "http"
  | "invalid-payload"
  | "source-missing"
  | "source-invalid-json";

/** The `detail` of the `bcd-error` event. */
export type BcdErrorDetail = {
  readonly mode: BcdMode;
  readonly reason: BcdErrorReason;
  /** The HTTP status for the reason `http`. Null for every other reason. */
  readonly status: number | null;
  /** The contract's error code, such as `feature_not_found`, when the body carries one. */
  readonly code: string | null;
};

/**
 * The `<bcd-compat-table>` element as a page sees it. It is written by hand, so no type from Lit,
 * the library the element is built with, reaches a consumer (Document 3 section 2).
 *
 * This is an `interface`, not a `type` alias, because it extends `HTMLElement`, and because an
 * entry in `HTMLElementTagNameMap` must be assignable to `HTMLElement`.
 */
export interface BcdCompatTableElement extends HTMLElement {
  /**
   * A contract-conformant payload. The element renders it without a request. `null` removes the
   * table. The element reads the payload when it is assigned, so assign a new object to show new
   * data; a change made inside the same object is not seen.
   */
  data: CompatTableData | null;
  /**
   * The `query` attribute: the BCD dotted key to request, such as `css.properties.display`, or
   * `null` when it is absent. The element requests it only while `data` is `null`.
   */
  query: string | null;
  /**
   * The `endpoint` attribute: the base URL of the API, or `null` for the hosted API,
   * `https://api.browser-compat.dev`. It must be an absolute `https:` or `http:` URL with no query
   * string, fragment, or credentials; any other value gives the error `invalid-endpoint`.
   */
  endpoint: string | null;
  /**
   * The `loading` attribute. `lazy`, the default, holds the first request back until the element
   * nears the viewport; `eager` requests on connection. A missing or unknown value reads as
   * `lazy`, and the property does not write the attribute back.
   */
  loading: CompatTableLoading;
  /** The `browsers` attribute: space-separated support target ids, or `null` for the default. */
  browsers: string | null;
  /** The `locale` attribute. An unknown locale, and `null`, select English. */
  locale: string | null;
}

declare global {
  // These two are interfaces because TypeScript's DOM library declares them as interfaces, and
  // only an interface can merge new members into an existing one.
  interface HTMLElementTagNameMap {
    "bcd-compat-table": BcdCompatTableElement;
  }

  // The two events bubble, so a listener on the element, on an ancestor, on the document, or on
  // the window receives them. This is the map those four share.
  interface GlobalEventHandlersEventMap {
    "bcd-load": CustomEvent<BcdLoadDetail>;
    "bcd-error": CustomEvent<BcdErrorDetail>;
  }
}
