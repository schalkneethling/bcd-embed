import { createApp } from "vue";

import {
  createRecord,
  defineElement,
  markReady,
  readOptions,
  recordFirstRender,
} from "../shared.js";
import App from "./App.vue";

const options = readOptions(window.location.search);
const record = createRecord();

if (options.define === "before") await defineElement();
// `mount` renders at once, so "after" really does define the element once Vue has rendered it.
createApp(App).mount("#app");
recordFirstRender(record);
if (options.define === "after") await defineElement();
markReady();
