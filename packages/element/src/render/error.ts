import { html } from "lit";
import type { TemplateResult } from "lit";

import { formatMessage } from "../strings/format.js";
import type { StringTable } from "../strings/format.js";

/** The class of the paragraph the element renders after an error. It is a public class name. */
export const ERROR_CLASS = "bcd-error";

/**
 * Renders the sentence the element shows after a data-mode error when the author gave no fallback
 * content. The sentence names no query, because a value that is not a payload may have none. It
 * is a plain paragraph with no live region, so a page with several tables announces nothing by
 * itself; the `bcd-error` event is how a page reacts. O(1) time and space.
 */
export const renderErrorMessage = (strings: StringTable): TemplateResult =>
  html`<p class=${ERROR_CLASS}>${formatMessage(strings, "error-no-query", {})}</p>`;
