import { Task, TaskStatus } from "@lit/task";
import { LitElement, nothing } from "lit";
import type { PropertyValues, TemplateResult } from "lit";

import {
  FEATURE_KEY_PATTERN,
  getPageFeatureClient,
  isValidEndpoint,
} from "./data/feature-client.js";
import type { FeatureRequest, FeatureResult, FeatureSuccess } from "./data/feature-client.js";
import { hasElementWithId, readSource, sourceScopeOf } from "./data/source-reader.js";
import type { SourceReadResult } from "./data/source-reader.js";
import { buildTableModel, TablePayloadError } from "./model/table-model.js";
import type { TableModel } from "./model/table-model.js";
import type {
  BcdCompatTableElement,
  BcdErrorDetail,
  BcdLoadDetail,
  CompatTableData,
  CompatTableLoading,
} from "./public-types.js";
import { renderErrorMessage, renderLoadingMessage } from "./render/error.js";
import { renderTable } from "./render/table.js";
import { selectStrings } from "./strings/format.js";
import type { StringTable } from "./strings/format.js";

/**
 * The `<bcd-compat-table>` element. It renders a payload as the table Phase 1 validated
 * (Document 3 sections 4 and 7), from one of three inputs, in this order:
 *
 * 1. Data mode: the payload assigned to `.data`. No request is sent.
 * 2. Source mode: the `source` attribute, while `data` is `null`. It names a
 *    `<script type="application/json">` that holds the payload, and the element reads that script
 *    once (`data/source-reader.ts`). No request is sent, and a `source` that fails does not fall
 *    through to `query` (Document 3 section 4, #205).
 * 3. Fetch mode: the `query` attribute, while `data` is `null` and `source` is absent. The element
 *    asks the page's feature client (`data/feature-client.ts`) for
 *    `{endpoint}/v1/current/features/{query}.json`.
 *
 * How one update runs, for example after `element.data = payload`:
 *
 * 1. `willUpdate` starts, replaces, or cancels the request when the fetch inputs changed
 *    (`#syncRequest`), then works out the outcome: empty, deferred, pending, loaded, or error. A
 *    `TablePayloadError` from the model becomes the error state.
 * 2. `render` maps the outcome to markup inside the render container: the table, or, when the
 *    author gave no fallback content, one sentence for the loading or error state.
 * 3. `updated` sets or removes the `loaded` and `aria-busy` attributes, starts or stops the
 *    viewport observer, then dispatches `bcd-load` or `bcd-error`, so a listener always finds the
 *    table already in the document. While the element is out of the document the event waits, and
 *    `connectedCallback` dispatches it.
 *
 * How a request moves through the states, for `<bcd-compat-table query="css.properties.display">`
 * with the default `loading="lazy"`:
 *
 * ```text
 * connected, far from the viewport -> deferred (no request, no aria-busy)
 *   observer: near the viewport    -> pending  (one request, aria-busy="true")
 *     the answer arrives           -> loaded   (the table, `loaded`, one bcd-load)
 *                                  or error    (the fallback, one bcd-error)
 * ```
 *
 * A new `query` or `endpoint` while a request is pending starts the new request and drops the old
 * one: `Task` aborts the old run's signal and ignores its result, so the old answer neither
 * renders nor fires an event. Removing the element aborts its wait too, and adding it back asks
 * again, which the request cache answers without a second request when the first is still in
 * flight or succeeded.
 *
 * Cost of one update: the model is O(F × T + S + C) in time and space (`model/table-model.ts`)
 * and the markup is O(F × T + L + E + C) (`render/table.ts`), for F features, T displayed targets,
 * S statements, L history lines, E note segments, and C characters. Lit then compares the new
 * values with the previous render's in one pass of the same size. Everything else here is O(1),
 * apart from O(q) work on a query of q characters: the key pattern and the loading sentence.
 */

/** The class of the `<div>` the element renders into. It is a public class name. */
export const RENDER_CONTAINER_CLASS = "bcd-render-container";

/**
 * The attribute the element sets on itself while a table is rendered. The base stylesheet hides
 * the author's fallback children while it is present (Document 3 section 4, "Fallback content").
 */
export const LOADED_ATTRIBUTE = "loaded";

/**
 * How far outside the viewport a lazy element starts its request, as an `IntersectionObserver`
 * `rootMargin`. 400 pixels is about half a phone screen, enough for a cached answer to arrive and
 * render before a reader who scrolls at a normal pace reaches the table. The browser applies the
 * margin only when the element's document can reach the top-level page's origin; in a cross-origin
 * iframe it ignores the margin, and the request starts when the element enters the viewport.
 */
export const LAZY_ROOT_MARGIN = "400px";

/**
 * What the element holds for its `source` attribute: the id it read, and either the answer or the
 * fact that the script has not been parsed yet. `waiting` ends when the parser finishes, because
 * the script can no longer arrive after that.
 */
type SourceState =
  | { readonly id: string; readonly status: "waiting" }
  | { readonly id: string; readonly status: "read"; readonly result: SourceReadResult };

/** The arguments of one request: the query and the `endpoint` attribute. */
type FetchArgs = readonly [query: string, endpoint: string | null];

/**
 * What the latest update produced. `deferred` has no request in flight: the element waits for the
 * viewport, or to be connected again. `pending` has a request in flight.
 */
type Outcome =
  | { readonly status: "empty" }
  | { readonly status: "deferred"; readonly query: string }
  | { readonly status: "pending"; readonly query: string }
  | {
      readonly status: "loaded";
      readonly model: TableModel;
      readonly strings: StringTable;
      readonly detail: BcdLoadDetail;
    }
  | { readonly status: "error"; readonly detail: BcdErrorDetail; readonly query: string | null };

const EMPTY: Outcome = { status: "empty" };

const sameArgs = (left: FetchArgs | null, right: FetchArgs | null): boolean =>
  left === right ||
  (left !== null && right !== null && left[0] === right[0] && left[1] === right[1]);

/**
 * Reads the `loading` attribute as `<img loading>` reads its own: `eager`, in any letter case, is
 * eager, and anything else, including no attribute, is the default, `lazy`.
 */
const parseLoading = (value: string | null): CompatTableLoading =>
  value?.toLowerCase() === "eager" ? "eager" : "lazy";

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
    query: { type: String },
    endpoint: { type: String },
    source: { type: String },
    loading: { converter: parseLoading },
    browsers: { type: String },
    locale: { type: String },
  };

  // Counts the elements created on this page, so each one gets a caption id of its own. A counter
  // is enough because an id only has to be unique within one document.
  static #instanceCount = 0;

  declare data: CompatTableData | null;
  declare query: string | null;
  declare endpoint: string | null;
  declare source: string | null;
  declare loading: CompatTableLoading;
  declare browsers: string | null;
  declare locale: string | null;

  readonly #captionId: string;
  #outcome: Outcome = EMPTY;
  // Whether the update in progress must dispatch an event once its markup is in the document.
  #announce = false;
  // The request. `autoRun` is off because `#syncRequest` decides when to run: only while `data`
  // is `null`, only once the lazy wait is over, and never while the element is out of the
  // document. `run` sets the `PENDING` status before its first `await`, so calling it from
  // `willUpdate` lets the same update render the pending state. A new run aborts the previous
  // run's signal, and `Task` drops the previous run's result, so an old answer never renders.
  readonly #task = new Task<FetchArgs, FeatureResult>(this, {
    task: ([query, endpoint], { signal }) => {
      const request: FeatureRequest =
        endpoint === null ? { query, signal } : { query, endpoint, signal };
      return getPageFeatureClient().requestFeature(request);
    },
    autoRun: false,
  });
  // The arguments of the run whose result the element shows, or `null` when no run counts: before
  // the first request, in data mode, and after the element aborted a run because it was removed.
  #runArgs: FetchArgs | null = null;
  // Whether the lazy wait is over: the element came near the viewport, or it has sent a request.
  // It never goes back, so switching `loading` to `lazy` does not unload a table, and a later
  // `query` requests at once.
  #nearViewport = false;
  // The arguments of the task's latest run, so a status is only read for the run it belongs to.
  #taskArgs: FetchArgs | null = null;
  // The latest successful answer and the arguments it answered. Restoring those arguments, after
  // `query` was cleared or `data` was set and cleared, shows the table again in the same update,
  // with no pending state and no request. It holds one payload that the page's request cache
  // holds anyway, so it costs O(1) extra space. Failures are not kept, so that a restored
  // `query` after a failure asks the request cache again and its 10-second window applies.
  #lastSuccess: { readonly args: FetchArgs; readonly result: FeatureSuccess } | null = null;
  // Whether the `aria-busy` attribute is the element's own, so it never removes an author's.
  #ownsBusy = false;
  #viewportObserver: IntersectionObserver | null = null;
  // The element's read of its `source` attribute, or `null` before the first read, while `data`
  // is set, and while `source` is absent. A settled read is kept until `source` changes, so the
  // script's text is parsed once, however often the element updates or moves.
  #sourceState: SourceState | null = null;
  // Cancels the wait for the parser. It exists only while `#sourceState` is `waiting`.
  #sourceWait: AbortController | null = null;
  // Puts the render container back when a script removes it. React does this when it changes a
  // single string child: it assigns `textContent`, which replaces every child (Issue #187,
  // section 3).
  readonly #containerGuard = new MutationObserver(() => {
    this.#guardContainer();
    // The loading and error sentences show only while the author has no fallback content, so a
    // child that arrives or leaves in those states calls for another render. Rendering changes
    // the container's children, not this element's, so it does not call the observer again.
    const { status } = this.#outcome;
    if (status === "error" || status === "pending" || status === "deferred") this.requestUpdate();
  });

  constructor() {
    super();
    this.data = null;
    this.query = null;
    this.endpoint = null;
    this.source = null;
    this.loading = "lazy";
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
    // The first read of `source` happens here, before the first update. It also makes the read
    // that the element could not make while it was out of the document, for a `source` set then.
    if (this.#syncSource()) this.requestUpdate();
    // An update that finished while the element was out of the document held its event back.
    // When an update is still pending instead, `updated` dispatches, now that it is connected.
    if (this.hasUpdated && !this.isUpdatePending) this.#dispatchPendingEvent();
    // Before the first update, `updated` starts the observer and `willUpdate` the request.
    if (!this.hasUpdated) return;
    this.#syncViewportObserver();
    // A request that `disconnectedCallback` aborted starts again in the next update. The request
    // cache answers it from the first request when that is still in flight or succeeded.
    if (!sameArgs(this.#fetchArgs(), this.#runArgs)) this.requestUpdate();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#containerGuard.disconnect();
    // A wait for the parser needs a document to watch. `connectedCallback` starts it again.
    this.#cancelSourceWait();
    this.#syncViewportObserver();
    // Stop waiting for the answer. The shared request carries on for other elements, and this
    // run's result is dropped, so no event can fire for it while the element is out of the
    // document.
    if (this.#task.status === TaskStatus.PENDING) {
      this.#task.abort();
      this.#runArgs = null;
    }
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

  /**
   * The query and endpoint the element is in fetch mode for, or `null` when it is not: `data` is
   * set, `source` is present, or `query` is absent. The checks read property values, which a
   * script or a framework binding can set without the attribute converter, so `undefined` counts
   * as absent, as it does for `data`. A `source` that is present, even one that failed, keeps the
   * element out of fetch mode, so a bad reference never turns into a request.
   */
  #fetchInputs(): FetchArgs | null {
    const { data, query, source } = this;
    if ((data !== null && data !== undefined) || (source !== null && source !== undefined)) {
      return null;
    }
    if (query === null || query === undefined) return null;
    return [query, this.endpoint ?? null];
  }

  /** Stops waiting for the parser, if the element is. */
  #cancelSourceWait(): void {
    this.#sourceWait?.abort();
    this.#sourceWait = null;
  }

  /**
   * Brings `#sourceState` in line with the `source` attribute, and returns whether it changed.
   * It reads the script only while the element is connected and `data` is unset, and it reads
   * each id once:
   *
   * - `source` is absent: forget any read. A later `source` is read afresh.
   * - The id is already read: nothing, so changing the script's text changes nothing.
   * - The element is out of the document: nothing, because there is no tree to look in. The next
   *   `connectedCallback` reads.
   * - `data` is set: nothing. `data` wins, so the script is not parsed for nothing, and a broken
   *   reference reports nothing. Clearing `data` reads it.
   * - The script is not there yet and the parser is still running: wait. When the element is
   *   defined before the parser reaches it, `connectedCallback` runs before the parser has read
   *   anything after the element's start tag, so a script written after the element does not
   *   exist yet (docs/planning/10-component-spikes.md, #187 section 1). The wait ends on the
   *   document's `readystatechange`, which fires when the parser has finished.
   * - Otherwise: read the script now.
   *
   * Every branch is O(1) apart from the read, which `readSource` states.
   */
  #syncSource(): boolean {
    const id = this.source ?? null;
    const held = this.#sourceState;
    if (id === null) {
      this.#cancelSourceWait();
      this.#sourceState = null;
      return held !== null;
    }
    if (this.data !== null && this.data !== undefined) {
      // `data` wins, so a wait for the parser is pointless: stop it, and forget that it began, so
      // that clearing `data` decides again whether to wait, read, or report.
      if (held?.status !== "waiting") return false;
      this.#cancelSourceWait();
      this.#sourceState = null;
      return true;
    }
    const waitingForId = held?.id === id && held.status === "waiting" && this.#sourceWait !== null;
    if ((held?.id === id && held.status === "read") || waitingForId) return false;
    if (!this.isConnected) return false;
    this.#cancelSourceWait();
    const scope = sourceScopeOf(this);
    const { ownerDocument } = this;
    if (ownerDocument.readyState === "loading" && !hasElementWithId(scope, id)) {
      const wait = new AbortController();
      this.#sourceWait = wait;
      this.#sourceState = { id, status: "waiting" };
      ownerDocument.addEventListener(
        "readystatechange",
        () => {
          if (ownerDocument.readyState === "loading") return;
          wait.abort();
          this.#sourceWait = null;
          // The parser is done, so the script is there or it never will be.
          this.#sourceState = { id, status: "read", result: readSource(scope, id) };
          this.requestUpdate();
        },
        { signal: wait.signal },
      );
      return true;
    }
    this.#sourceState = { id, status: "read", result: readSource(scope, id) };
    return true;
  }

  /**
   * Whether a request could go out for these inputs. A query that fails the key pattern, or an
   * endpoint that is not a base URL, never sends one, so there is nothing to hold back for it:
   * its error arrives at once, and no observer waits. O(q + e) for a query of q characters and an
   * endpoint of e.
   */
  static #canSend([query, endpoint]: FetchArgs): boolean {
    return FEATURE_KEY_PATTERN.test(query) && (endpoint === null || isValidEndpoint(endpoint));
  }

  /**
   * Whether the element holds its first request back until it nears the viewport. Any `loading`
   * value other than `eager` counts as `lazy`, as the attribute does.
   */
  #waitsForViewport(inputs: FetchArgs | null): boolean {
    return (
      inputs !== null &&
      this.loading !== "eager" &&
      !this.#nearViewport &&
      BcdCompatTable.#canSend(inputs)
    );
  }

  /**
   * The arguments the element should request with now, or `null` when it should not request:
   * it is not in fetch mode, or it is lazy and has not come near the viewport.
   */
  #fetchArgs(): FetchArgs | null {
    const inputs = this.#fetchInputs();
    return this.#waitsForViewport(inputs) ? null : inputs;
  }

  /**
   * Starts a run when the fetch arguments changed, and aborts the pending run when there should
   * be none. It never starts a run while the element is out of the document; `connectedCallback`
   * requests an update that starts it on return.
   */
  #syncRequest(): void {
    const args = this.#fetchArgs();
    if (sameArgs(args, this.#runArgs)) return;
    if (args === null) {
      // Aborting does nothing unless a run is pending.
      this.#task.abort();
      this.#runArgs = null;
      return;
    }
    if (!this.isConnected) return;
    this.#runArgs = args;
    if (BcdCompatTable.#canSend(args)) this.#nearViewport = true;
    const shown = this.#lastSuccess;
    if (shown !== null && sameArgs(args, shown.args)) {
      // The answer is already known, so `#buildOutcome` shows it. A run still pending for other
      // arguments is dropped.
      this.#task.abort();
      return;
    }
    this.#taskArgs = args;
    // `run` never rejects: `Task` catches the task's rejection and records it as the error.
    void this.#task.run(args);
  }

  /**
   * Observes the element while it waits for the viewport, and stops once it no longer waits:
   * when it has come near, when `data` is set or `query` is absent, when `loading` is `eager`,
   * when no request can be sent, or when it leaves the document. Each element owns one observer
   * with one target, so a call is O(1) apart from the O(q + e) check in `#canSend`.
   *
   * An observer reports only on an element that has a box. A host with `display: none` or
   * `display: contents` never intersects, so a lazy element there waits for good. And the
   * `rootMargin` applies to the viewport, not to a scrolling ancestor, so inside an
   * `overflow: auto` box the request starts only when the element is visible in that box.
   */
  #syncViewportObserver(): void {
    const waiting = this.isConnected && this.#waitsForViewport(this.#fetchInputs());
    if (waiting && this.#viewportObserver === null) {
      this.#viewportObserver = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          this.#nearViewport = true;
          this.#syncViewportObserver();
          this.requestUpdate();
        },
        { rootMargin: LAZY_ROOT_MARGIN },
      );
      this.#viewportObserver.observe(this);
    } else if (!waiting && this.#viewportObserver !== null) {
      this.#viewportObserver.disconnect();
      this.#viewportObserver = null;
    }
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    const previous = this.#outcome.status;
    // The first read is `connectedCallback`'s. This one covers a `source` that changed, or a
    // `data` that was cleared, after it. It never asks for another update: this one is running.
    this.#syncSource();
    this.#syncRequest();
    this.#outcome = this.#buildOutcome();
    // One event for each update in which `data` changed, and one for each change of state: a
    // request that settles, or a `browsers` or `locale` change that turns a rendered payload into
    // a rejected one or back. A pending or deferred state takes the flag and fires nothing, so a
    // request that settles after it fires exactly one event. Lit batches the assignments made in
    // one task into one update, so two payloads assigned one after the other render the second
    // and fire one event. Assigning the object that is already assigned changes nothing, so Lit
    // runs no update and nothing fires. A change that leaves a table rendered re-renders it
    // without a second `bcd-load`. An event that is still waiting for the element to be
    // connected stays due.
    this.#announce ||=
      changed.has("data") || changed.has("source") || this.#outcome.status !== previous;
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
    if (payload !== null && payload !== undefined) {
      return this.#buildTable(payload, { mode: "data", snapshot: null }, null);
    }
    const { source } = this;
    if (source !== null && source !== undefined) return this.#buildSourceOutcome(source);
    const { query } = this;
    if (query === null || query === undefined) return EMPTY;
    const args = this.#fetchArgs();
    // No run counts yet: the element waits for the viewport, or to be connected again.
    if (args === null || !sameArgs(args, this.#runArgs)) return { status: "deferred", query };
    const shown = this.#lastSuccess;
    if (shown !== null && sameArgs(args, shown.args)) {
      const detail: BcdLoadDetail = { mode: "fetch", snapshot: shown.result.snapshot };
      return this.#buildTable(shown.result.payload, detail, query);
    }
    // The task's status belongs to its latest run, which may be one the element dropped in favour
    // of a remembered success. Until a run for these arguments starts, nothing is pending.
    if (!sameArgs(args, this.#taskArgs)) return { status: "deferred", query };
    if (this.#task.status === TaskStatus.COMPLETE) {
      const result = this.#task.value;
      if (result !== undefined && result.ok) {
        this.#lastSuccess = { args, result };
        const detail: BcdLoadDetail = { mode: "fetch", snapshot: result.snapshot };
        return this.#buildTable(result.payload, detail, query);
      }
      if (result !== undefined) {
        const { reason, status, code } = result;
        return { status: "error", detail: { mode: "fetch", reason, status, code }, query };
      }
    }
    if (this.#task.status === TaskStatus.ERROR) {
      // The client never rejects, and the element aborts only runs it no longer counts, so this
      // is a failure nobody planned for. It reads as the contract's "temporarily unavailable".
      const detail: BcdErrorDetail = { mode: "fetch", reason: "network", status: null, code: null };
      return { status: "error", detail, query };
    }
    return { status: "pending", query };
  }

  /**
   * The outcome for a `source` attribute. Nothing shows while the element waits for the parser or
   * for a connection, and no event fires, because the state changes again when the read ends. A
   * failed read is the error in mode `source`, with no query in its sentence, as in data mode.
   * `id` is the attribute's current value; a read held for another id is not its answer.
   */
  #buildSourceOutcome(id: string): Outcome {
    const held = this.#sourceState;
    if (held === null || held.id !== id || held.status === "waiting") return EMPTY;
    const { result } = held;
    if (result.ok) {
      return this.#buildTable(result.payload, { mode: "source", snapshot: null }, null);
    }
    const { reason } = result;
    return {
      status: "error",
      detail: { mode: "source", reason, status: null, code: null },
      query: null,
    };
  }

  /**
   * Builds the table for a payload. A payload the model cannot read is the error
   * `invalid-payload`, in the mode the payload came from.
   */
  #buildTable(payload: unknown, detail: BcdLoadDetail, query: string | null): Outcome {
    const strings = selectStrings(this.locale);
    try {
      return {
        status: "loaded",
        model: buildTableModel(payload, { browsers: this.browsers, strings }),
        strings,
        detail,
      };
    } catch (error) {
      // The model throws a `TablePayloadError` for a payload it cannot read, and nothing else.
      if (!(error instanceof TablePayloadError)) throw error;
      return {
        status: "error",
        detail: { mode: detail.mode, reason: "invalid-payload", status: null, code: null },
        query,
      };
    }
  }

  protected override render(): TemplateResult | typeof nothing {
    const outcome = this.#outcome;
    if (outcome.status === "loaded") {
      return renderTable(outcome.model, outcome.strings, this.#captionId);
    }
    // The author's fallback is the message while the element loads and after an error. Without
    // one the element would be empty, for assistive technology too, so it renders one sentence.
    if (outcome.status === "empty" || this.#hasFallbackContent()) return nothing;
    const strings = selectStrings(this.locale);
    return outcome.status === "error"
      ? renderErrorMessage(strings, outcome.query)
      : renderLoadingMessage(strings, outcome.query, outcome.status === "pending");
  }

  protected override updated(): void {
    const { status } = this.#outcome;
    this.toggleAttribute(LOADED_ATTRIBUTE, status === "loaded");
    // `aria-busy` marks a request in flight, not the lazy wait before it, which may never end.
    // The element removes only the value it set, so an author's own `aria-busy` stays, and it
    // never overwrites one that is already there.
    if (status === "pending") {
      if (!this.hasAttribute("aria-busy")) {
        this.setAttribute("aria-busy", "true");
        this.#ownsBusy = true;
      }
    } else if (this.#ownsBusy) {
      this.removeAttribute("aria-busy");
      this.#ownsBusy = false;
    }
    this.#syncViewportObserver();
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
    const outcome = this.#outcome;
    if (outcome.status === "loaded") {
      this.dispatchEvent(new CustomEvent("bcd-load", { bubbles: true, detail: outcome.detail }));
    } else if (outcome.status === "error") {
      this.dispatchEvent(new CustomEvent("bcd-error", { bubbles: true, detail: outcome.detail }));
    }
  }
}
