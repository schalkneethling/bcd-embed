import { LitElement, nothing } from "lit";
import type { PropertyValues, TemplateResult } from "lit";

import { buildTableModel, TablePayloadError } from "./model/table-model.js";
import type { TableModel } from "./model/table-model.js";
import type {
  BcdCompatTableElement,
  BcdErrorDetail,
  BcdLoadDetail,
  CompatTableData,
} from "./public-types.js";
import { renderErrorMessage } from "./render/error.js";
import { renderTable } from "./render/table.js";
import { selectStrings } from "./strings/format.js";
import type { StringTable } from "./strings/format.js";

/**
 * The `<bcd-compat-table>` element in data mode: it renders the payload assigned to `.data` as the
 * table Phase 1 validated, with no request (Document 3 sections 4 and 7). Fetch mode and the
 * `source` attribute are later issues.
 *
 * How one update runs, for example after `element.data = payload`:
 *
 * 1. `willUpdate` builds the table model from `data`, `browsers`, and `locale`. A
 *    `TablePayloadError` from the model becomes the error state.
 * 2. `render` maps the model to markup inside the render container. In the error state it
 *    renders one sentence when the author gave no fallback content, and otherwise nothing.
 * 3. `updated` sets or removes the `loaded` attribute, then dispatches `bcd-load` or `bcd-error`,
 *    so a listener always finds the table already in the document. While the element is out of
 *    the document the event waits, and `connectedCallback` dispatches it.
 *
 * Cost of one update: the model is O(F × T + S + C) in time and space (`model/table-model.ts`)
 * and the markup is O(F × T + L + E + C) (`render/table.ts`), for F features, T displayed targets,
 * S statements, L history lines, E note segments, and C characters. Lit then compares the new
 * values with the previous render's in one pass of the same size. Everything else here is O(1).
 */

/** The class of the `<div>` the element renders into. It is a public class name. */
export const RENDER_CONTAINER_CLASS = "bcd-render-container";

/**
 * The attribute the element sets on itself while a table is rendered. The base stylesheet hides
 * the author's fallback children while it is present (Document 3 section 4, "Fallback content").
 */
export const LOADED_ATTRIBUTE = "loaded";

/** What the latest update produced: no payload, a table, or a payload the model rejected. */
type Outcome =
  | { readonly status: "empty" }
  | { readonly status: "loaded"; readonly model: TableModel; readonly strings: StringTable }
  | { readonly status: "error" };

const EMPTY: Outcome = { status: "empty" };

/**
 * A browser compatibility table for one BCD (`@mdn/browser-compat-data`) feature and the features
 * nested under it.
 *
 * @tagname bcd-compat-table
 * @fires bcd-load - A table has rendered. The detail is `{ mode, snapshot }`.
 * @fires bcd-error - No table could be rendered. The detail is `{ mode, reason, status, code }`.
 */
export class BcdCompatTable extends LitElement implements BcdCompatTableElement {
  // Every reactive property is declared here, typed with `declare`, and given its default in the
  // constructor. A plain class field would shadow Lit's accessor and silently stop updates
  // (docs/planning/10-component-spikes.md, Issue #187, section 4).
  static override properties = {
    data: { attribute: false },
    browsers: { type: String },
    locale: { type: String },
  };

  // Counts the elements created on this page, so each one gets a caption id of its own. A counter
  // is enough because an id only has to be unique within one document.
  static #instanceCount = 0;

  declare data: CompatTableData | null;
  declare browsers: string | null;
  declare locale: string | null;

  readonly #captionId: string;
  #outcome: Outcome = EMPTY;
  // Whether the update in progress must dispatch an event once its markup is in the document.
  #announce = false;
  // Puts the render container back when a script removes it. React does this when it changes a
  // single string child: it assigns `textContent`, which replaces every child (Issue #187,
  // section 3).
  readonly #containerGuard = new MutationObserver(() => {
    this.#guardContainer();
    // The error sentence shows only while the author has no fallback content, so a child that
    // arrives or leaves during the error state calls for another render. Rendering changes the
    // container's children, not this element's, so it does not call the observer again.
    if (this.#outcome.status === "error") this.requestUpdate();
  });

  constructor() {
    super();
    this.data = null;
    this.browsers = null;
    this.locale = null;
    BcdCompatTable.#instanceCount += 1;
    this.#captionId = `bcd-compat-table-caption-${BcdCompatTable.#instanceCount}`;
  }

  /**
   * Renders into a `<div>` appended to the element, in light DOM, so the author's children stay
   * where the author put them. Lit calls this once, on the first connection, so a reconnected
   * element keeps the one container (Issue #187, sections 1 and 8).
   *
   * A deep copy of a rendered element, made with `cloneNode(true)` or from its saved HTML, arrives
   * with a copy of the first element's container and table, caption id included. That copy is
   * this element's own stale output, not author content, so it is removed before the new
   * container is added. Otherwise the page would show two tables and hold a duplicate id. When
   * the element is defined before the parser reaches it, the copy arrives after this call, and
   * the observer removes it then.
   */
  protected override createRenderRoot(): HTMLElement {
    this.#removeStaleContainers();
    const container = document.createElement("div");
    container.className = RENDER_CONTAINER_CLASS;
    this.append(container);
    return container;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // The container may have been removed while the element was out of the document, when the
    // observer was not watching.
    this.#guardContainer();
    this.#containerGuard.observe(this, { childList: true });
    // An update that finished while the element was out of the document held its event back.
    // When an update is still pending instead, `updated` dispatches, now that it is connected.
    if (this.hasUpdated && !this.isUpdatePending) this.#dispatchPendingEvent();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#containerGuard.disconnect();
  }

  /**
   * Removes any stale copy of a container, then appends this element's container again when it
   * is no longer a child. It must be the same node, because Lit creates the render root once and
   * keeps rendering into it. Appending fires the observer once more, and that call finds the
   * container in place and does nothing.
   */
  #guardContainer(): void {
    this.#removeStaleContainers();
    if (this.renderRoot.parentNode !== this) this.append(this.renderRoot);
  }

  /**
   * Removes every child with the render container's class that is not this element's container.
   * It reads the children only, never the table inside the container, so it costs O(n) for the
   * element's n children: the author's fallback and one container. The children are copied first,
   * because removing one from the live collection while reading it would skip the next.
   */
  #removeStaleContainers(): void {
    for (const child of [...this.children]) {
      if (child !== this.renderRoot && child.classList.contains(RENDER_CONTAINER_CLASS)) {
        child.remove();
      }
    }
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    const previous = this.#outcome.status;
    this.#outcome = this.#buildOutcome();
    // One event for each update in which `data` changed, and one when `browsers` or `locale`
    // turns a rendered payload into a rejected one or back. Lit batches the assignments made in
    // one task into one update, so two payloads assigned one after the other render the second
    // and fire one event. Assigning the object that is already assigned changes nothing, so Lit
    // runs no update and nothing fires. A change that leaves a table rendered re-renders it
    // without a second `bcd-load`. An event that is still waiting for the element to be
    // connected stays due.
    this.#announce ||= changed.has("data") || this.#outcome.status !== previous;
  }

  /**
   * Whether the author gave fallback content: an element other than the render container, or
   * text that is not only white space. Comments and the line breaks between tags do not count.
   * O(n) for the element's n child nodes.
   */
  #hasFallbackContent(): boolean {
    for (const child of this.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE && child !== this.renderRoot) return true;
      if (child.nodeType === Node.TEXT_NODE && child.nodeValue?.trim()) return true;
    }
    return false;
  }

  #buildOutcome(): Outcome {
    const payload: unknown = this.data;
    if (payload === null || payload === undefined) return EMPTY;
    const strings = selectStrings(this.locale);
    try {
      return {
        status: "loaded",
        model: buildTableModel(payload, { browsers: this.browsers, strings }),
        strings,
      };
    } catch (error) {
      // The model throws a `TablePayloadError` for a payload it cannot read, and nothing else.
      if (error instanceof TablePayloadError) return { status: "error" };
      throw error;
    }
  }

  protected override render(): TemplateResult | typeof nothing {
    const outcome = this.#outcome;
    if (outcome.status === "loaded") {
      return renderTable(outcome.model, outcome.strings, this.#captionId);
    }
    // After an error the author's fallback is the message. Without one the element would be
    // empty, for assistive technology too, so it says that the data could not be shown.
    return outcome.status === "error" && !this.#hasFallbackContent()
      ? renderErrorMessage(selectStrings(this.locale))
      : nothing;
  }

  protected override updated(): void {
    this.toggleAttribute(LOADED_ATTRIBUTE, this.#outcome.status === "loaded");
    this.#dispatchPendingEvent();
  }

  /**
   * Dispatches the event that the latest update owes, once, and only while the element is in a
   * document. The events bubble so that one listener on the document hears every table, and an
   * event dispatched on a detached element would never reach it. The event reports the state at
   * the moment it fires: a payload assigned and then replaced while the element was detached
   * gives one event, for the payload that is rendered.
   */
  #dispatchPendingEvent(): void {
    if (!this.#announce || !this.isConnected) return;
    this.#announce = false;
    const { status } = this.#outcome;
    if (status === "loaded") {
      const detail: BcdLoadDetail = { mode: "data", snapshot: null };
      this.dispatchEvent(new CustomEvent("bcd-load", { bubbles: true, detail }));
    } else if (status === "error") {
      const detail: BcdErrorDetail = {
        mode: "data",
        reason: "invalid-payload",
        status: null,
        code: null,
      };
      this.dispatchEvent(new CustomEvent("bcd-error", { bubbles: true, detail }));
    }
  }
}
