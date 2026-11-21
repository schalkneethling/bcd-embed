<script setup lang="ts">
import "@bcd-embed/element";
import type { BcdLoadDetail, CompatTableData } from "@bcd-embed/element";

defineProps<{ data: CompatTableData }>();

const onLoad = (event: CustomEvent<BcdLoadDetail>) => {
  console.log("Table loaded:", event.detail.mode);
};
</script>

<template>
  <bcd-compat-table browsers="chrome firefox safari" :data.prop="data" @bcd-load="onLoad">
    <p>Browser compatibility for this feature is on MDN Web Docs.</p>
  </bcd-compat-table>
</template>
