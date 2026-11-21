<script lang="ts">
  // The Svelte page. An attribute named `on` plus the event name is Svelte 5's listener syntax, so
  // `onbcd-load` listens for `bcd-load` (the compiler's `visit_event_attribute` takes the name
  // after `on`). `window.bcdPage` is made by `main.ts` before this component is created.
  import type { BcdErrorDetail, BcdLoadDetail, CompatTableData } from "@bcd-embed/element";

  import { brokenPayload, browsersFor, fallbackFor, payload, readOptions } from "../shared.js";

  const options = readOptions(window.location.search);
  const record = window.bcdPage;

  let revision = $state(0);
  // `$state` makes an object deeply reactive, so reading it gives a Proxy of the payload, not the
  // payload. `$state.raw` keeps the object itself. The "deep" scenario shows what the element
  // receives from each. The runes cannot sit in a conditional, so the page holds both.
  let deepData = $state<CompatTableData>(payload);
  let rawData = $state.raw<CompatTableData>(payload);
  const data = $derived(options.state === "deep" ? deepData : rawData);

  const onLoad = (event: CustomEvent<BcdLoadDetail>): void => {
    record.loads.push(event.detail);
  };
  const onError = (event: CustomEvent<BcdErrorDetail>): void => {
    record.errors.push(event.detail);
  };
  const setData = (next: CompatTableData): void => {
    deepData = next;
    rawData = next;
  };
</script>

<main>
  <h1>Svelte fixture</h1>
  <p>
    <button type="button" id="rerender" onclick={() => (revision += 1)}>Re-render</button>
    <button type="button" id="break" onclick={() => setData(brokenPayload)}>Break data</button>
    <button type="button" id="restore" onclick={() => setData(payload)}>Restore data</button>
  </p>
  <!-- `data={data}` is Svelte's ordinary binding. For a custom element, `set_custom_element_data`
       sets the property when the element is defined and has a setter for it, and, while the
       element is not defined yet, when the value is an object. There is no separate "robust"
       form, so the `binding` option changes nothing on this page. -->
  <bcd-compat-table
    id="table"
    browsers={browsersFor(revision)}
    {data}
    onbcd-load={onLoad}
    onbcd-error={onError}
  >
    {#if options.fallback === "element"}
      <p>{fallbackFor(revision)}</p>
    {:else}
      {fallbackFor(revision)}
    {/if}
  </bcd-compat-table>
</main>
