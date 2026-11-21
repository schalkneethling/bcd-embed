// The React page. The query string selects a scenario (shared.ts), and the page records every
// event that React's own `onbcd-load` and `onbcd-error` props receive.
import type {
  BcdCompatTableElement,
  BcdErrorDetail,
  BcdLoadDetail,
  CompatTableData,
} from "@bcd-embed/element";
import { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import {
  brokenPayload,
  browsersFor,
  createRecord,
  defineElement,
  fallbackFor,
  markReady,
  payload,
  readOptions,
} from "../shared.js";

const options = readOptions(window.location.search);
const record = createRecord();

// Module-level functions, so React sees the same listener on every render and does not remove and
// add it again.
const onLoad = (event: CustomEvent<BcdLoadDetail>): void => {
  record.loads.push(event.detail);
};
const onError = (event: CustomEvent<BcdErrorDetail>): void => {
  record.errors.push(event.detail);
};

const App = () => {
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<CompatTableData>(payload);

  // "plain" is React 19's ordinary prop: it sets the property when the element already has a `data`
  // property, and the attribute `data="[object Object]"` otherwise. "robust" is a ref callback,
  // which assigns the property whatever the load order. An inline callback is a new function on
  // every render, so React calls it again and `data` follows the state.
  const binding =
    options.binding === "plain"
      ? { data }
      : {
          ref: (element: BcdCompatTableElement | null): void => {
            if (element !== null) element.data = data;
          },
        };

  return (
    <main>
      <h1>React fixture</h1>
      <p>
        <button type="button" id="rerender" onClick={() => setRevision((value) => value + 1)}>
          Re-render
        </button>
        <button type="button" id="break" onClick={() => setData(brokenPayload)}>
          Break data
        </button>
        <button type="button" id="restore" onClick={() => setData(payload)}>
          Restore data
        </button>
      </p>
      <bcd-compat-table
        id="table"
        browsers={browsersFor(revision)}
        onbcd-load={onLoad}
        onbcd-error={onError}
        {...binding}
      >
        {options.fallback === "element" ? <p>{fallbackFor(revision)}</p> : fallbackFor(revision)}
      </bcd-compat-table>
    </main>
  );
};

const container = document.getElementById("root");
if (container === null) throw new Error("The page has no #root.");
const root = createRoot(container);

if (options.define === "before") await defineElement();
// `flushSync` renders now, so "after" really does define the element once React has rendered it.
flushSync(() => root.render(<App />));
if (options.define === "after") await defineElement();
markReady();
