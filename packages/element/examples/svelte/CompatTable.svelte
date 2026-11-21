<script lang="ts">
  import "@bcd-embed/element";
  import type { BcdLoadDetail, CompatTableData } from "@bcd-embed/element";

  let { data }: { data: CompatTableData } = $props();

  const onLoad = (event: CustomEvent<BcdLoadDetail>) => {
    console.log("Table loaded:", event.detail.mode);
  };
</script>

<bcd-compat-table browsers="chrome firefox safari" {data} onbcd-load={onLoad}>
  <p>Browser compatibility for this feature is on MDN Web Docs.</p>
</bcd-compat-table>
