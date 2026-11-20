/** The XML namespace of every HTML element. A `<script>` in the SVG namespace is a different thing. */
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

/** The media type a script element must declare for the element to read it. */
const JSON_SCRIPT_TYPE = "application/json";

/** Why a `source` reference could not give a payload. Both are `bcd-error` reasons. */
export type SourceFailure = "source-missing" | "source-invalid-json";

/**
 * The outcome of one read. `payload` is whatever `JSON.parse` returned, so it is `unknown` until
 * the table model has checked it. A failure carries one of the two reasons that belong to
 * `source`; a payload the model rejects is `invalid-payload`, and the element reports that one.
 */
export type SourceReadResult =
  | { readonly ok: true; readonly payload: unknown }
  | { readonly ok: false; readonly reason: SourceFailure };

/**
 * The tree an `id` is looked up in: a document, or the shadow root that holds the element. Both
 * have `getElementById`, from `NonElementParentNode`.
 */
export type SourceScope = Pick<NonElementParentNode, "getElementById">;

/**
 * Whether an element is a `<script type="application/json">` in the HTML namespace. The type is
 * compared as the whole attribute value, in any letter case. A value with parameters, such as
 * `application/json; charset=utf-8`, does not match, because the reader accepts one exact kind of
 * element and nothing near it. The test reads `localName` and `namespaceURI` instead of using
 * `instanceof HTMLScriptElement`, so an element from another window, such as an iframe's, passes
 * it too. O(1).
 */
const isJsonScript = (element: Element): boolean =>
  element.localName === "script" &&
  element.namespaceURI === HTML_NAMESPACE &&
  element.getAttribute("type")?.toLowerCase() === JSON_SCRIPT_TYPE;

/**
 * The tree to look an `id` up in for a connected element: the shadow root that holds it, or else
 * its document. `getRootNode()` returns one of the two for a connected element, and both have
 * `getElementById`. The check looks for that method instead of using `instanceof ShadowRoot`,
 * because each window has its own `ShadowRoot` class, and a shadow root made by an iframe's
 * window is not an instance of this window's. O(1).
 */
export const sourceScopeOf = (element: Element): SourceScope => {
  const root: Partial<SourceScope> & Node = element.getRootNode();
  return typeof root.getElementById === "function"
    ? (root as Node & SourceScope)
    : element.ownerDocument;
};

/**
 * Whether anything in the scope has this `id`. The element uses it to tell a script that the
 * parser has not reached yet from a reference that is wrong: only an `id` that matches nothing can
 * still turn up while the page loads, because the parser appends and `getElementById` returns the
 * first match in tree order. Expected O(1): browsers keep a map from `id` to element for each
 * tree.
 */
export const hasElementWithId = (scope: SourceScope, id: string): boolean =>
  scope.getElementById(id) !== null;

/**
 * Reads the payload that the `<script type="application/json">` with this `id` carries. Nothing
 * is evaluated: the text goes to `JSON.parse`, which builds data and runs no code, and an element
 * that is not that exact kind of script is never read, so a page cannot make the element parse
 * the text of a `<p>` or an `<input>` by pointing `source` at it.
 *
 * - No element has the `id`, or the first one in tree order is not a JSON script: `source-missing`.
 * - The text is not JSON, or is empty: `source-invalid-json`.
 *
 * The reader changes nothing in the tree and reads no attribute other than `type`.
 *
 * The cost is O(n) time and space for a script of n characters: `textContent` copies the text once
 * and `JSON.parse` builds a value of the same size. The lookup before it is expected O(1). The
 * element reads a source once, so a table pays this once, not on every update.
 */
export const readSource = (scope: SourceScope, id: string): SourceReadResult => {
  const element = scope.getElementById(id);
  if (element === null || !isJsonScript(element)) return { ok: false, reason: "source-missing" };
  try {
    return { ok: true, payload: JSON.parse(element.textContent ?? "") as unknown };
  } catch {
    // Text that is not JSON throws a `SyntaxError`. Engines may also throw a `RangeError` or an
    // internal error for extreme nesting or size. Whatever the cause, the script gave no payload,
    // and an exception here would abort `connectedCallback`, so every failure is the same reason.
    return { ok: false, reason: "source-invalid-json" };
  }
};
