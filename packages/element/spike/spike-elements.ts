// Spike for issue #187: the smallest Lit elements that exercise the behaviours Document 3 assumes.
// None of this code ships. The findings live in docs/planning/10-component-spikes.md.
import { html, LitElement } from "lit";
import type { PropertyValues } from "lit";

// What the element does with the author's fallback children once data arrives. "hide" is the
// Document 3 design; "remove" is the contrast the issue asks for.
type FallbackMode = "hide" | "remove";

// Renders into a <div> it appends to itself, so the author's children stay where the author put
// them and the template never replaces them.
class LightDomElement extends LitElement {
  // A plain (non-reactive) counter. It is not in `static properties`, so a class field is safe.
  createRenderRootCalls = 0;

  protected override createRenderRoot(): HTMLElement {
    this.createRenderRootCalls += 1;
    const container = document.createElement("div");
    container.dataset.renderContainer = "";
    this.append(container);
    return container;
  }
}

// The Document 3 pattern: reactive properties declared in `static properties`, typed with
// `declare` so no class field is emitted, and defaults assigned in the constructor.
export class SpikeTable extends LightDomElement {
  static override properties = {
    data: { attribute: false },
    label: { type: String },
    fallbackMode: { type: String, attribute: "fallback-mode" },
  };

  declare data: unknown;
  declare label: string;
  declare fallbackMode: FallbackMode;

  renderCount = 0;

  constructor() {
    super();
    this.data = undefined;
    this.label = "default label";
    this.fallbackMode = "hide";
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("data") && this.data !== undefined) {
      this.#retireFallback();
    }
  }

  // Hides (or removes) every author child. The render container is skipped because it is the
  // element's own output, not author content. `this.children` is live, so it is copied first:
  // removing a child while iterating the live collection would skip the next one.
  #retireFallback(): void {
    for (const child of Array.from(this.children)) {
      if (child === this.renderRoot || !(child instanceof HTMLElement)) {
        continue;
      }

      if (this.fallbackMode === "remove") {
        child.remove();
      } else {
        child.hidden = true;
      }
    }
  }

  protected override render() {
    this.renderCount += 1;
    return html`<p data-rendered-label>${this.label}</p>
      <p data-rendered-data-type>${typeof this.data}</p>`;
  }
}

// A <slot> in a light-DOM template, with fallback text of its own.
export class SpikeSlot extends LightDomElement {
  protected override render() {
    return html`<slot data-light-slot>slot fallback text</slot>`;
  }
}

// The contrast for the `declare` pattern: the same reactive property written as an ordinary
// class field with an initializer. Under `useDefineForClassFields` semantics, the field becomes
// an own property that hides Lit's prototype accessor.
export class SpikeFieldTable extends LightDomElement {
  static override properties = {
    label: { type: String },
  };

  label = "default label";

  protected override render() {
    return html`<p data-rendered-label>${this.label}</p>`;
  }
}

// Registered late on purpose by the React page, to show what React does with `data` before the
// element is defined. A subclass, because one constructor cannot be registered under two names.
export class SpikeLateTable extends SpikeTable {}

// Defined before the parser reaches it by early-parse.html, so the parser creates an already
// upgraded element and connects it before its children are parsed.
export class SpikeEarlyTable extends SpikeTable {}

export function defineSpikeEarlyTable(): void {
  customElements.define("bcd-spike-early-table", SpikeEarlyTable);
}

export function defineSpikeTable(): void {
  customElements.define("bcd-spike-table", SpikeTable);
}

export function defineSpikeSlot(): void {
  customElements.define("bcd-spike-slot", SpikeSlot);
}

export function defineSpikeFieldTable(): void {
  customElements.define("bcd-spike-field-table", SpikeFieldTable);
}

export function defineSpikeLateTable(): void {
  customElements.define("bcd-spike-late-table", SpikeLateTable);
}
