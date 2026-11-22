---
title: Frameworks
description: Use bcd-compat-table in React 19, Vue 3, and Svelte 5, and the load order each one needs.
---

`<bcd-compat-table>` works inside React 19, Vue 3, and Svelte 5 with no
wrapper. The project tests it in React 19.3.1, Vue 3.5.45, and Svelte 5.57.3,
in Chromium, Firefox, and WebKit. In every framework, two rules apply:

1. **Import `@schalkneethling/bcd-embed` before the framework renders the element,**
   as the first import of the module that mounts the app or of the component
   that uses it. The import is what defines the element.
2. **Write the fallback as an element, such as `<p>`, not as bare text.** A
   framework that changes a single text child assigns `textContent`, which
   removes every child, the element's render container included. The element
   puts the container back, but the form with an element child never needs
   that.

The events bubble but do not cross a shadow root, so a listener on the element
or on an ancestor in the same tree receives them.

## Why the load order matters

`data` is a property, not an attribute. React and Vue decide how to pass a
prop to a custom element when they apply it: they set a property when the
element already has one of that name, and an attribute otherwise. The element
has its `data` property only once it is defined. A framework that renders the
element before it is defined therefore writes the attribute
`data="[object Object]"`, which the element never reads, and the table does not
render until the framework passes a new value.

| Framework | Sets `data` in any load order | Listens for `bcd-load` | If the element is defined after the first render                                     |
| --------- | ----------------------------- | ---------------------- | ------------------------------------------------------------------------------------ |
| React 19  | A `ref` callback              | `onbcd-load={fn}`      | `data={x}` loses the data; a `ref` callback keeps it                                 |
| Vue 3     | `:data.prop="x"`              | `@bcd-load="fn"`       | `:data="x"` loses the data; `:data.prop="x"` keeps it                                |
| Svelte 5  | `data={x}`                    | `onbcd-load={fn}`      | `data={x}` keeps the data, except in WebKit when nothing read `customElements` first |

## React

React 19 sets a prop on a custom element as a property when `prop in element`
is true at the moment React applies it, and as an attribute otherwise. So
`data={x}` works only when the element is defined before React renders it. A
`ref` callback assigns the property in every load order. React reads a prop
that begins with `on` as a listener for the event named by the rest of the
prop, so `onbcd-load` listens for `bcd-load`.

<!-- sample: packages/element/examples/react/CompatTable.tsx -->

```tsx
import "@schalkneethling/bcd-embed";
import type {
  BcdCompatTableElement,
  BcdLoadDetail,
  CompatTableData,
} from "@schalkneethling/bcd-embed";

export const CompatTable = ({ data }: { data: CompatTableData }) => (
  <bcd-compat-table
    browsers="chrome firefox safari"
    ref={(element: BcdCompatTableElement | null) => {
      if (element !== null) element.data = data;
    }}
    onbcd-load={(event: CustomEvent<BcdLoadDetail>) => {
      console.log("Table loaded:", event.detail.mode);
    }}
  >
    <p>Browser compatibility for this feature is on MDN Web Docs.</p>
  </bcd-compat-table>
);
```

The callback is written inline, so it is a new function on every render, and
React calls it again with the current `data`. A memoised callback runs once,
and later changes to `data` would not reach the element.

React's release notes for version 19 say that server-side rendering writes
primitive props as attributes and leaves out object props, so `data` never
reaches server-rendered HyperText Markup Language (HTML). A server-rendered
page passes the data through `source`, or assigns `data` on the client. The
project has tested client rendering only, and it does not promise support for
React versions before 19.

TypeScript needs the tag declared for JSX (JavaScript XML, the syntax of the
markup above). The package ships no React typings; the project's test page
declares the props it uses in `packages/element/e2e/frameworks/react/custom-element.d.ts`.

## Vue

Tell Vue's template compiler that the tag is a custom element, or Vue warns
that it cannot resolve a component. With `@vitejs/plugin-vue`:

<!-- sample: packages/element/e2e/frameworks/vite.config.ts -->

```ts
vue({
  template: { compilerOptions: { isCustomElement: (tag) => tag === "bcd-compat-table" } },
}),
```

Then bind `data` with the `.prop` modifier, which always sets the property:

<!-- sample: packages/element/examples/vue/CompatTable.vue -->

```vue
<script setup lang="ts">
import "@schalkneethling/bcd-embed";
import type { BcdLoadDetail, CompatTableData } from "@schalkneethling/bcd-embed";

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
```

Without `.prop`, Vue sets a property only when `key in el` is true, which has
the same load-order limit as React. Keep the data in `shallowRef` or
`markRaw` in the component that owns it. `ref` makes the object deeply
reactive, so the element receives a `Proxy` of the data: the table still
renders, but `element.data` is then not the object you passed.

## Svelte

Svelte's ordinary binding works. While the element is not defined yet, Svelte
sets an object as a property, and the element keeps a property that was set
before it was defined. An attribute named `on` followed by the event name is
Svelte 5's listener syntax, so `onbcd-load` listens for `bcd-load`.

<!-- sample: packages/element/examples/svelte/CompatTable.svelte -->

```svelte
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
```

Keep the data in `$state.raw`, not `$state`, in the component that owns it,
because `$state` makes an object deeply reactive and the element receives a
proxy.

WebKit 27.2 has a bug that affects a Svelte page that defines the element
after it first renders. Svelte builds its markup with `document.importNode`,
and WebKit never upgrades an element that `importNode` created before anything
read `window.customElements`. The page then shows the fallback forever.
Importing the element first, as in the example above, avoids the bug, because
defining the element reads `customElements` before the markup exists.
