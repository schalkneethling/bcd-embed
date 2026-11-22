// What the three framework pages have in common, so each page differs only in how its framework
// binds `data`, registers the event listeners, and re-renders. This module imports no framework
// and never imports the element: the order in which the element is defined is the test's variable.
import type { BcdErrorDetail, BcdLoadDetail, CompatTableData } from "@schalkneethling/bcd-embed";

import { v1NormalizedFixture } from "../../../schema/src/fixtures/v1.js";

/** The scenario a test selects through the page's query string. */
export type PageOptions = {
  /**
   * When the element is defined: before the framework first renders it, or after. React and Vue
   * decide how to set a prop when they apply it, so the order matters to them (Document 10,
   * #187 section 5).
   */
  readonly define: "before" | "after";
  /**
   * How the page hands over `data`. "plain" is the framework's ordinary binding; "robust" is the
   * form that works in every load order (see each page).
   */
  readonly binding: "plain" | "robust";
  /** Whether the author's fallback is a `<p>` element or a bare string child. */
  readonly fallback: "element" | "string";
  /** Whether the page keeps the payload in the framework's deeply reactive state. */
  readonly state: "raw" | "deep";
  /**
   * "docs" renders the documentation site's example component (`examples/<framework>/`) instead
   * of the page's own, so the sample the site shows is a sample a test runs. The example imports
   * the element itself, which makes `define` irrelevant to it.
   */
  readonly example: "none" | "docs";
};

const pick = <Value extends string>(
  params: URLSearchParams,
  name: string,
  allowed: readonly [Value, ...Value[]],
): Value => {
  const value = params.get(name);
  return allowed.find((candidate) => candidate === value) ?? allowed[0];
};

export const readOptions = (search: string): PageOptions => {
  const params = new URLSearchParams(search);
  return {
    define: pick(params, "define", ["before", "after"]),
    binding: pick(params, "binding", ["plain", "robust"]),
    fallback: pick(params, "fallback", ["element", "string"]),
    state: pick(params, "state", ["raw", "deep"]),
    example: pick(params, "example", ["none", "docs"]),
  };
};

/** What the page records for the tests, which reach it through `window.bcdPage`. */
export type PageRecord = {
  /** The `detail` of every `bcd-load` that the framework's listener received, in order. */
  readonly loads: BcdLoadDetail[];
  /** The `detail` of every `bcd-error` that the framework's listener received, in order. */
  readonly errors: BcdErrorDetail[];
  /** The object the page passes as `data`, for an identity check. */
  readonly payload: CompatTableData;
  /**
   * Whether `customElements.get("bcd-compat-table")` was `undefined` right after the framework's
   * first render, so a test can tell a page that rendered before the definition from one that
   * rendered after it. `null` until the first render.
   */
  undefinedAtFirstRender: boolean | null;
};

declare global {
  // An interface, because only an interface can add a member to the DOM library's `Window`.
  interface Window {
    bcdPage: PageRecord;
  }
}

export const payload: CompatTableData = v1NormalizedFixture;

/** A value the element rejects, so the page can show the error path. */
export const brokenPayload = {} as CompatTableData;

export const createRecord = (): PageRecord => {
  const record: PageRecord = { loads: [], errors: [], payload, undefinedAtFirstRender: null };
  window.bcdPage = record;
  return record;
};

/** The `browsers` attribute for a revision: the "Re-render" button flips it. */
export const browsersFor = (revision: number): string =>
  revision % 2 === 0 ? "chrome" : "chrome opera";

/** The fallback sentence for a revision. */
export const fallbackFor = (revision: number): string => `Fallback, revision ${revision}.`;

/** Records whether the element was still undefined once the framework had rendered. */
export const recordFirstRender = (record: PageRecord): void => {
  record.undefinedAtFirstRender = customElements.get("bcd-compat-table") === undefined;
};

/** Defines the element, the way a page does with `import "@schalkneethling/bcd-embed"`. */
export const defineElement = async (): Promise<void> => {
  await import("@schalkneethling/bcd-embed");
};

/** Marks the page as ready, so a test waits for the mount and for the definition. */
export const markReady = (): void => {
  document.body.setAttribute("data-ready", "");
};
