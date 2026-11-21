import { flushSync, mount } from "svelte";

import {
  createRecord,
  defineElement,
  markReady,
  readOptions,
  recordFirstRender,
} from "../shared.js";
import App from "./App.svelte";

const options = readOptions(window.location.search);
const record = createRecord();

const target = document.getElementById("app");
if (target === null) throw new Error("The page has no #app.");

if (options.define === "before") await defineElement();
// `flushSync` runs the pending effects, so "after" really does define the element once Svelte has
// rendered it.
mount(App, { target });
flushSync();
recordFirstRender(record);
if (options.define === "after") await defineElement();
markReady();
