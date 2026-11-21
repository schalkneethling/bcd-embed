<script setup lang="ts">
// The Vue page. `@bcd-load` and `@bcd-error` are Vue's own listener syntax: the compiler turns
// `@bcd-load` into the prop `onBcdLoad`, and the runtime turns that back into the event name
// `bcd-load` (runtime-dom `parseName`, which hyphenates). `window.bcdPage` is made by `main.ts`
// before this component is created.
import type { BcdErrorDetail, BcdLoadDetail, CompatTableData } from "@bcd-embed/element";
import { ref, shallowRef } from "vue";

import { brokenPayload, browsersFor, fallbackFor, payload, readOptions } from "../shared.js";

const options = readOptions(window.location.search);
const plain = options.binding === "plain";
const elementFallback = options.fallback === "element";
const record = window.bcdPage;

const revision = ref(0);
// `ref` makes an object deeply reactive, so a component that reads it gets a Proxy of the payload,
// not the payload. `shallowRef` keeps the object itself. The "deep" scenario shows what the
// element receives from each.
const data = options.state === "deep" ? ref<CompatTableData>(payload) : shallowRef(payload);

const onLoad = (event: CustomEvent<BcdLoadDetail>): void => {
  record.loads.push(event.detail);
};
const onError = (event: CustomEvent<BcdErrorDetail>): void => {
  record.errors.push(event.detail);
};
const breakData = (): void => {
  data.value = brokenPayload;
};
const restoreData = (): void => {
  data.value = payload;
};
</script>

<template>
  <main>
    <h1>Vue fixture</h1>
    <p>
      <button type="button" id="rerender" @click="revision += 1">Re-render</button>
      <button type="button" id="break" @click="breakData">Break data</button>
      <button type="button" id="restore" @click="restoreData">Restore data</button>
    </p>
    <!-- Four copies of one element, because Vue picks how to update the children from the
         template's shape. A single text child, as in the last two, is updated with
         `el.textContent = text` (runtime-dom `setElementText`), which removes every child the
         element has, the render container included. A `<p>` child, as in the first two, is
         patched in place.
         "plain": `:data` sets the property when the element already has a `data` property, and
         the attribute `data="[object Object]"` otherwise (runtime-dom `shouldSetAsProp`, which
         tests `key in el`). "robust": `:data.prop` always sets the property. -->
    <bcd-compat-table
      v-if="plain && elementFallback"
      id="table"
      :browsers="browsersFor(revision)"
      :data="data"
      @bcd-load="onLoad"
      @bcd-error="onError"
    >
      <p>{{ fallbackFor(revision) }}</p>
    </bcd-compat-table>
    <bcd-compat-table
      v-else-if="!plain && elementFallback"
      id="table"
      :browsers="browsersFor(revision)"
      :data.prop="data"
      @bcd-load="onLoad"
      @bcd-error="onError"
    >
      <p>{{ fallbackFor(revision) }}</p>
    </bcd-compat-table>
    <bcd-compat-table
      v-else-if="plain"
      id="table"
      :browsers="browsersFor(revision)"
      :data="data"
      @bcd-load="onLoad"
      @bcd-error="onError"
      >{{ fallbackFor(revision) }}</bcd-compat-table
    >
    <bcd-compat-table
      v-else
      id="table"
      :browsers="browsersFor(revision)"
      :data.prop="data"
      @bcd-load="onLoad"
      @bcd-error="onError"
      >{{ fallbackFor(revision) }}</bcd-compat-table
    >
  </main>
</template>
