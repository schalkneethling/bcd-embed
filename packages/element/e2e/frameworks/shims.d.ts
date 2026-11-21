// `tsc` reads neither Vue single-file components nor Svelte components, so the two entry modules
// import a component through these declarations. The components themselves are compiled and run
// by the page tests, not type-checked.
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent;
  export default component;
}

declare module "*.svelte" {
  import type { Component } from "svelte";
  const component: Component;
  export default component;
}
