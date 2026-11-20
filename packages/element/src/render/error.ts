import { html } from "lit";
import type { TemplateResult } from "lit";

import { formatMessage } from "../strings/format.js";
import type { StringTable } from "../strings/format.js";

/** The class of the paragraph the element renders after an error. It is a public class name. */
export const ERROR_CLASS = "bcd-error";

/** The class of the paragraph the element renders while it loads. It is a public class name. */
export const LOADING_CLASS = "bcd-loading";

/**
 * Renders the sentence the element shows after an error when the author gave no fallback content.
 * In fetch mode the sentence names the query, "Browser compatibility data for {query} could not
 * be loaded." In data mode, and for an empty query, it names none, because a value that is not a
 * payload may have no query: "Browser compatibility data could not be shown."
 *
 * It is a plain paragraph with no live region, so a page with several tables announces nothing by
 * itself; the `bcd-error` event is how a page reacts. Lit writes the query through a text binding,
 * so a query that contains markup stays text. O(q) time and space for a query of q characters.
 */
export const renderErrorMessage = (strings: StringTable, query: string | null): TemplateResult => {
  const message = query
    ? formatMessage(strings, "error", { query })
    : formatMessage(strings, "error-no-query", {});
  return html`<p class=${ERROR_CLASS}>${message}</p>`;
};

/**
 * Renders the sentence the element shows in fetch mode until the answer arrives, when the author
 * gave no fallback content. While a request is in flight it says "Loading browser compatibility
 * data for {query}." Before any request, while a lazy element waits for the viewport, it says
 * "Browser compatibility data for {query} has not loaded yet.", because nothing is loading then,
 * and the wait may never end (a host with no box never meets the viewport).
 *
 * Like the error sentence it is a plain paragraph, not a live region, so ten loading tables
 * produce no status announcement (Document 3 section 4). A reader who reaches the element hears
 * the sentence, and while a request is in flight the element's `aria-busy` attribute says that
 * its content is about to change. O(q) time and space for a query of q characters.
 */
export const renderLoadingMessage = (
  strings: StringTable,
  query: string,
  inFlight: boolean,
): TemplateResult => {
  const message = formatMessage(strings, inFlight ? "loading" : "not-loaded", { query });
  return html`<p class=${LOADING_CLASS}>${message}</p>`;
};
