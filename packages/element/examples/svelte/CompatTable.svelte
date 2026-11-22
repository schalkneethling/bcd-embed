<script lang="ts">
  import "@schalkneethling/bcd-embed";
  import type { BcdLoadDetail, CompatTableData } from "@schalkneethling/bcd-embed";

  let { data }: { data: CompatTableData } = $props();

  const onLoad = (event: CustomEvent<BcdLoadDetail>) => {
    console.log("Table loaded:", event.detail.mode);
  };
</script>

<bcd-compat-table browsers="chrome firefox safari" {data} onbcd-load={onLoad}>
  <p>Browser compatibility for this feature is on MDN Web Docs.</p>
</bcd-compat-table>
