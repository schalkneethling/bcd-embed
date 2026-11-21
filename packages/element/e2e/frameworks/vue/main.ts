import { createApp } from "vue";

import {
  createRecord,
  defineElement,
  markReady,
  payload,
  readOptions,
  recordFirstRender,
} from "../shared.js";
import App from "./App.vue";

const options = readOptions(window.location.search);
const record = createRecord();

if (options.example === "docs") {
  // The documentation site's sample. A dynamic import, because the example imports the element,
  // and a static one would define it before every scenario's first render.
  const { default: CompatTable } = await import("../../../examples/vue/CompatTable.vue");
  createApp(CompatTable, { data: payload }).mount("#app");
  recordFirstRender(record);
} else {
  if (options.define === "before") await defineElement();
  // `mount` renders at once, so "after" really does define the element once Vue has rendered it.
  createApp(App).mount("#app");
  recordFirstRender(record);
  if (options.define === "after") await defineElement();
}
markReady();
