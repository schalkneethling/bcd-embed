// React 19 as the parent of the spike element. The tests drive this page through
// `window.reactSpike`, so every render is synchronous (`flushSync`) and its result can be read
// straight after the call. `createElement` is used instead of JSX, so the page needs no JSX
// transform; JSX compiles to the same `createElement` calls.
import { createElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { defineSpikeLateTable, defineSpikeTable } from "./spike-elements.js";

type FallbackProps = {
  data: unknown;
  label: string;
  showLink: boolean;
  mode: "hide" | "remove";
};

type ReactSpike = {
  renderFallback: (props: FallbackProps) => void;
  renderData: (data: unknown) => void;
  renderLate: (data: unknown, viaRef: boolean) => void;
  defineLate: () => void;
};

declare global {
  // An interface, not a type alias, because adding a property to `Window` needs declaration
  // merging.
  interface Window {
    reactSpike: ReactSpike;
  }
}

defineSpikeTable();

function rootFor(id: string) {
  const container = document.getElementById(id);
  if (!container) {
    throw new Error(`Missing #${id}`);
  }
  return createRoot(container);
}

const fallbackRoot = rootFor("fallback-root");
const dataRoot = rootFor("data-root");
const lateRoot = rootFor("late-root");

// React renders the author's fallback children inside the element, so React believes it owns
// them. The element hides or removes them once `data` arrives.
function FallbackParent({ data, label, showLink, mode }: FallbackProps): ReactNode {
  return createElement(
    "bcd-spike-table",
    { id: "react-fallback", data, "fallback-mode": mode },
    createElement("p", { id: "react-child-text" }, label),
    showLink
      ? createElement(
          "a",
          { id: "react-child-link", href: "https://developer.mozilla.org/" },
          "MDN",
        )
      : null,
  );
}

window.reactSpike = {
  renderFallback(props) {
    flushSync(() => {
      fallbackRoot.render(createElement(FallbackParent, props));
    });
  },
  renderData(data) {
    flushSync(() => {
      dataRoot.render(createElement("bcd-spike-table", { id: "react-data", data }));
    });
  },
  renderLate(data, viaRef) {
    const props = viaRef
      ? {
          id: "react-late",
          // A ref callback assigns the property itself, whether or not the element is defined.
          ref: (element: HTMLElement | null) => {
            if (element) {
              Object.assign(element, { data });
            }
          },
        }
      : { id: "react-late", data };
    flushSync(() => {
      lateRoot.render(createElement("bcd-spike-late-table", props));
    });
  },
  defineLate() {
    defineSpikeLateTable();
  },
};
