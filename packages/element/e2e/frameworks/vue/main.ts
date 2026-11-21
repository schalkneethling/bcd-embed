import { createApp } from "vue";

import { createRecord, defineElement, markReady, readOptions } from "../shared.js";
import App from "./App.vue";

const options = readOptions(window.location.search);
createRecord();

if (options.define === "before") await defineElement();
// `mount` renders at once, so "after" really does define the element once Vue has rendered it.
createApp(App).mount("#app");
if (options.define === "after") await defineElement();
markReady();
