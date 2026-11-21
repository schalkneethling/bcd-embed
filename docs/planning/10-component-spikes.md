# Document 10 — Component spikes

This document records the results of the time-boxed spikes that test the assumptions behind
Document 3 (`03-web-component-architecture.md`) before Phase 2 of the component starts. Each
spike has its own section, titled with its issue number and subject. A section states the
versions it tested, how it tested them, and whether each assumption was confirmed. Findings that
contradict Document 3 are listed at the end of each section, so the Document 3 amendment (issue
#192) can pick them up.

## Issue #187 — Lit behaviours the light-DOM design depends on

Status: done on 18 November 2026. Every criterion in the issue is answered below. Each answer
comes from running tests in three browser engines, except the `@lit/task` options, which come
from the installed type definitions. One further note, on `static styles`, comes from reading
the installed source only. Two findings contradict text in
Document 3 (§8 on React, and §7 on where the `source` script may sit), and five add rules
Document 3 does not have yet. The full list is under "Findings for the Document 3 amendment".

**Where the evidence lives.** The spike code is not on `main`. It is on the
`issue-187-lit-spike` branch at commit `6576ed1dae2afb204bf27716f61b7c10cfe557aa`. Every file
path in this section that starts with `spike/` or names `playwright.spike.config.ts` is relative
to `packages/element` at that commit. Paths into `node_modules` are relative to
`packages/element` after `pnpm install` at that commit. Paths that start with `lit-element/` or
`@lit/reactive-element/` are inside those packages as `lit` 3.3.3 installs them; pnpm places them
under `node_modules/.pnpm/` at the repository root.

### Answers to the issue's criteria

| Criterion, as the issue words it                                                         | Answer                                        |
| ---------------------------------------------------------------------------------------- | --------------------------------------------- |
| `createRenderRoot()` appends a `<div>`: template inside it, author's children untouched   | Confirmed in all three engines (section 1)    |
| A `<slot>` in a light-DOM template projects nothing                                       | Confirmed, with a caveat (section 2)          |
| React 19.3.1 re-renders after the element toggled `hidden`: no error, children in place   | Confirmed, with two caveats (section 3)       |
| The same with the children removed (contrast)                                             | Recorded: React throws and unmounts (section 3) |
| A `declare` property with a constructor default renders again under TypeScript 7, Vite 8  | Confirmed (section 4)                         |
| React 19.3.1, accessor on the prototype: `data` is set as a property, not an attribute    | Confirmed (section 5)                         |
| `@lit/task` 1.0.3 constructor options listed from the type definitions                    | Listed (section 6)                            |
| Whether the parser moves `<bcd-compat-table>` out of a `<table>`                          | It does, in all three engines (section 7)     |
| Whether a second `connectedCallback` creates a second render container                    | It does not (section 8)                       |

Two cases the issue did not list were added after review, because they change how sections 1
and 3 apply: an element defined before the parser reaches it (section 1), and React changing a
single string child (section 3).

### What was tested, and how

At the commit above, `packages/element/spike/` holds five small Lit elements
(`spike/spike-elements.ts`), five test pages, and five Playwright test files in `spike/tests/`.
Every test runs six times: in Chromium, Firefox, and WebKit, and in each engine once against the
Vite dev server and once against a production build served by `vite preview`. The two servers
matter because Lit and React ship different development and production builds, and one finding
(class fields) behaves differently between them.

```
                    ┌── Vite dev server ──────── Lit and React development builds
spike/*.html ──────┤
                    └── vite build + preview ─── Lit and React production builds
                              │
            each served page runs in Chromium, Firefox, and WebKit
```

To reproduce the results, check out commit `6576ed1dae2afb204bf27716f61b7c10cfe557aa`, then
run, from the repository root:

```sh
pnpm install
pnpm --filter @bcd-embed/element exec playwright install chromium firefox webkit
pnpm --filter @bcd-embed/element test:spike
```

The last command was run on 18 November 2026 at that commit and reported `78 passed`.

#### Versions

| Package or engine       | Version                               |
| ----------------------- | ------------------------------------- |
| `lit`                   | 3.3.3                                 |
| `lit-element`           | 4.2.2 (installed by `lit` 3.3.3)      |
| `@lit/reactive-element` | 2.1.2 (installed by `lit` 3.3.3)      |
| `lit-html`              | 3.3.3 (installed by `lit` 3.3.3)      |
| `@lit/task`             | 1.0.3                                 |
| `react`, `react-dom`    | 19.3.1                                |
| `typescript`            | 7.0.2 (root `package.json`)           |
| `vite`                  | 8.3.8                                 |
| `@playwright/test`      | 1.65.0                                |
| Chromium                | 158.0.8127.18 (Playwright build 1254) |
| Firefox                 | 159.0 (Playwright build 1572)         |
| WebKit                  | 27.2 (Playwright build 2388)          |

Playwright's WebKit is not Safari, so every "WebKit" result below is evidence about the engine,
not a guarantee about a shipping Safari release.

### 1. `createRenderRoot()` returning an appended `<div>`

**Confirmed** in Chromium, Firefox, and WebKit, in development and production builds.

The spike element overrides `createRenderRoot()` to create a `<div data-render-container>`,
append it to itself, and return it. The page gives the element two author children, a `<p>` and
an `<a>`.

```ts
protected override createRenderRoot(): HTMLElement {
  const container = document.createElement("div");
  container.dataset.renderContainer = "";
  this.append(container); // after whatever children exist at this moment
  return container;       // Lit renders the template into this, and only this
}
```

After the first render, the element has no shadow root, the template output is inside the
`<div>` only, and the `outerHTML` of both author children is byte-for-byte what the page
contained. Test: `spike/tests/light-dom.spike.ts`, "renders the template inside the appended
`<div>`…".

Why it works, from the installed source: `LitElement.update()` calls
`render(value, this.renderRoot, this.renderOptions)`
(`lit-element/development/lit-element.js`, line 129), and `renderRoot` is whatever `createRenderRoot()` returned. The override does not call
`super.createRenderRoot()`, so no shadow root is attached
(`@lit/reactive-element/development/reactive-element.js`, lines 564–568).

#### Where the container lands depends on when the element is defined

The position of the container relative to the author's children is not fixed. It depends on
whether the element is defined before or after the HTML parser reaches it, because
`createRenderRoot()` runs on the first connection and appends after whatever children exist then.

| When the element is defined                          | Child order after the first render       |
| ---------------------------------------------------- | ---------------------------------------- |
| After parsing (a module script, `light-dom.html`)    | `p`, `a`, render container               |
| Before the parser reaches it (`early-parse.html`)    | render container, `p`, `a`               |

In the second case the parser creates an already-upgraded element and inserts it into the
document, so `connectedCallback()` runs, and the container is appended, before the parser has
read the element's children. The children are then parsed in after the container. The page
defines the element with a classic, parser-blocking `<script>` in `<head>`; an inline script
just before the element records that the definition already existed, and the test fails if it
did not. The result is the same in all three engines and both builds. Test:
`spike/tests/early-parse.spike.ts`. The classic script is built from `spike/early-define.ts` by
`spike/vite.early.config.ts` as one bundle, so this page uses Lit's production build even
against the dev server.

So `connectedCallback()` cannot assume the author's children exist yet. Section 3 and finding 2
below depend on this.

#### `static styles` (source-read only)

`ReactiveElement.createRenderRoot()` is also where Lit adopts `static styles`
(`adoptStyles(renderRoot, …)`, `reactive-element.js` line 567). An override that skips `super`
therefore never applies `static styles`. This was read from the source, not run. It is
consistent with Document 3 §3, which delivers base styles as an ordinary stylesheet in a cascade
layer, but Phase 2 must not reach for `static styles`.

### 2. A `<slot>` in a light-DOM template

**Confirmed, with a caveat**, in all three engines and both builds.

The spike element renders `<slot>slot fallback text</slot>` into its render container, and the
author gives it one child, `p#slot-author`. The slot projects nothing: `assignedNodes()` and
`assignedNodes({ flatten: true })` both return an empty list, the author's child has
`assignedSlot === null`, and it stays a direct child of the host. Test:
`spike/tests/light-dom.spike.ts`, "a `<slot>` in a light-DOM template projects nothing".

The caveat is that the slot still renders its own content. Outside a shadow tree the slot has
`display: contents` (measured with `getComputedStyle`), so its fallback text appears on the page
next to the author's child, which also still renders where it was.

```
<bcd-spike-slot>
  <p id="slot-author">Author child</p>   ← renders, not projected
  <div data-render-container>
    <slot>slot fallback text</slot>      ← also renders, as display: contents
  </div>
</bcd-spike-slot>
```

So a `<slot>` in the template is never useful in this component and would show stray text. This
matches Document 3 §4 ("Slots"), which already describes fallback content as children the
element leaves in place rather than slots.

### 3. React as the parent of the author's children

The test page uses `createElement` rather than JSX, so it needs no JSX transform. Modern JSX
compiles to `jsx()` calls from `react/jsx-runtime` rather than to `createElement`, but both
produce the same element and props, and React DOM applies props the same way, so the results
carry over.

#### Element children: hiding with `hidden`

React rendered the author's element children, then the element hid them when `data` arrived,
then React re-rendered with changed props. Each step runs inside `flushSync`, so its effect is in
the DOM before the next one starts.

1. React renders `<bcd-spike-table>` with a `<p>` and an `<a>` as children, and no `data`.
2. React renders again with `data`. The element's `updated()` sets `hidden` on every element
   child except its render container.
3. React renders again with new `<p>` text and without the `<a>`.
4. React renders again with the `<a>` back.

**Confirmed, with a caveat**, in all three engines and both builds. No console error and no
uncaught error appear in any step. In step 3, React updates the text of the hidden `<p>` in
place (it stays hidden and stays a child of the element) and removes the `<a>`. Test:
`spike/tests/react.spike.ts`, "React re-renders after the element hid its children".

The caveat appears in step 4. React inserts the returning `<a>` as a new node, and in all three
engines it lands after the render container, as the last child of the element. (The spike
observed this position; it did not trace which React code path chooses it.) The `<a>` is also
visible, because the element hid only the children that existed when `data` changed.

```
after step 2:  p[hidden]  a[hidden]  div[data-render-container]
after step 3:  p[hidden]             div[data-render-container]
after step 4:  p[hidden]             div[data-render-container]  a     ← visible, after the table
```

#### Element children: removing them (the contrast)

**React throws and unmounts**, in all three engines and both builds. In step 3, React calls
`removeChild` to drop the `<a>`, which the element already removed, and the browser throws. The
error does not reach the code that called `flushSync`; it surfaces as an uncaught page error,
and React then unmounts the whole root, so the element itself disappears from the page. The next
render mounts a brand-new element from scratch. Test: `spike/tests/react.spike.ts`, "React
re-renders after the element removed its children".

The tests recorded the error message, not its name. The messages were:

| Engine   | Recorded message                                                                 |
| -------- | -------------------------------------------------------------------------------- |
| Chromium | "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node." |
| Firefox  | "Node.removeChild: The node to be removed is not a child of this node"           |
| WebKit   | "The object can not be found here."                                              |

So, in this test, removing children React rendered broke React's next update, and hiding them
did not.

#### A single string child

**The render container is destroyed**, in all three engines and both builds. React treats a
single string child of a custom element as the element's text content. When the string changes,
React's `setTextContent` updates the existing text node only if it is the element's only child;
otherwise it assigns `textContent`, which replaces every child
(`node_modules/react-dom/cjs/react-dom-client.development.js`, lines 2834–2847).

The test renders `<bcd-spike-table>` with the string `Loading…` as its only child, then gives it
`data`, then changes the string to `Loaded`, then sets `data` again from script. Test:
`spike/tests/react.spike.ts`, "React changing a string child of the element".

```
step 1  "Loading…"  div[data-render-container]      ← two child nodes
step 2  "Loading…"  div[data-render-container]      ← data arrives; text can't be hidden, stays visible
step 3  "Loaded"                                    ← textContent replaced everything, container gone
step 4  "Loaded"                                    ← Lit renders into the detached container; nothing shows
```

There is no error at any step. Lit keeps its reference to the detached container and renders
into it, so the table silently stops appearing. Step 2 shows a second problem: a text node
cannot carry `hidden`, so a text-only fallback stays visible next to the table.

### 4. `declare` properties in `static properties`, under TypeScript 7 and Vite 8

**Confirmed** in all three engines and both builds.

The element declares `data`, `label`, and `fallbackMode` in `static properties`, types them with
`declare`, and assigns defaults in the constructor. The element has no own `label` property, and
setting `label` triggers exactly one more render with the new value. Test:
`spike/tests/light-dom.spike.ts`, "a `declare` property with a constructor default renders again
when it is set". TypeScript 7.0.2 type-checks the pattern: at the commit above,
`pnpm --filter @bcd-embed/element typecheck` passes, and `packages/element/tsconfig.json` extends
the root `tsconfig.json` and includes `spike/**/*.ts`.

The contrast shows what `declare` protects against. A second element writes the same property as
an ordinary field, `label = "default label"`. Vite 8.3.8's Oxc transform kept that field as a
native class field: the module the dev server served contained `label = "default label";` inside
the class body, while the `declare` fields produced no output at all. This was observed with the
root `tsconfig.json` in effect, which sets `target: "ESNext"` and does not set
`useDefineForClassFields`; the spike did not change those settings to show that they cause the
result. The native field becomes an own property that hides Lit's accessor on the prototype.

| Build       | What happens with the plain field                                                      |
| ----------- | -------------------------------------------------------------------------------------- |
| Development | Lit throws on the first update ("…set using class fields: label…") and renders nothing |
| Production  | Lit renders the default once, then ignores every later change, with no error           |

Test: `spike/tests/class-fields.spike.ts`. The development-build error comes from
`@lit/reactive-element/development/reactive-element.js`, lines 843–855. The production build has
no such check, which is why the failure there is silent.

### 5. React 19 setting `data` on the element

**Confirmed as the issue words it.** When the element is defined before React renders it, so the
`data` accessor is on the prototype, React 19.3.1 sets `data` as a property: `el.data` is the
same object React was given, and there is no `data` attribute. Test: `spike/tests/react.spike.ts`,
"React 19 sets `data` as a property when the element is defined before React renders".

**Document 3 §8's wording is still wrong.** It says React 19 passes "non-primitive values as
properties, primitives as attributes". For custom elements, React 19.3.1 makes the
property-or-attribute choice without looking at the value's type: it sets a property when the
key already exists on the element (`key in domElement`) at the moment React applies the prop,
and an attribute otherwise (`react-dom-client.development.js`, line 22174; the production build
has the same check at line 14793). The type matters only after that choice, on the attribute
path: `setValueForAttribute` removes the attribute for `undefined`, functions, and symbols, and
for booleans unless the name starts with `data-` or `aria-`, and otherwise stringifies the value
(lines 1665–1685). It follows from the same check that a primitive becomes a property too when
the accessor exists; the spike did not test a primitive prop.

The choice therefore depends on whether the element is defined before React renders it. The test
page renders `createElement("bcd-spike-table", { data })`, the equivalent of
`<bcd-compat-table data={obj}>`.

| When the element is defined           | What React does with `data`                                                             |
| ------------------------------------- | --------------------------------------------------------------------------------------- |
| Before React renders it               | Sets the property; `el.data` is the same object                                         |
| After React renders it                | Sets the attribute `data="[object Object]"`; after the upgrade `el.data` is `undefined` |
| After, then React renders a new value | Sets the property, because the accessor now exists                                      |
| After, with a `ref` callback          | The callback sets the property; Lit keeps it through the upgrade                        |

The second row loses the data, because `data` is declared with `attribute: false`, so Lit never
reads the attribute. The fourth row works because Lit saves own properties that were set before
the upgrade and applies them again (`__saveInstanceProperties`,
`@lit/reactive-element/development/reactive-element.js`, lines 541–554). Tests:
`spike/tests/react.spike.ts`, "React 19 sets `data` as an attribute when the element is defined
after React renders" and "a ref callback sets `data` as a property even when the element is
defined late".

The `ref` callback test assigned `data` once. Whether a `ref` callback runs again depends on its
identity: React flags a ref to be attached again only when it is not the same function as on the
previous render (`markRef`, `react-dom-client.development.js`, lines 10518–10532). An inline
callback is a new function on every render, so it runs on every render; a memoised callback runs
once, so later changes to `data` need another path, such as the `data` prop once the element is
defined. The spike did not test repeated assignment.

### 6. `@lit/task` 1.0.3 constructor options

Read from `node_modules/@lit/task/task.d.ts` (relative to `packages/element`) in the installed
`@lit/task` 1.0.3. No `Task` was run. The class has two constructor overloads (lines 164–165):

```ts
constructor(host: ReactiveControllerHost, task: TaskConfig<T, R>);
constructor(host: ReactiveControllerHost, task: TaskFunction<T, R>, args?: ArgsFunction<T>);
```

The `TaskConfig<T, R>` options (lines 29–73):

| Option         | Type                                                                    | Line |
| -------------- | ----------------------------------------------------------------------- | ---- |
| `task`         | `TaskFunction<T, R>` (required)                                         | 30   |
| `args`         | `ArgsFunction<T>`                                                       | 31   |
| `autoRun`      | `boolean \| 'afterUpdate'`; defaults to `true`                          | 53   |
| `argsEqual`    | `(oldArgs: T, newArgs: T) => boolean`; defaults to `shallowArrayEquals` | 61   |
| `initialValue` | `R`; starts the task in the `COMPLETE` status                           | 70   |
| `onComplete`   | `(value: R) => unknown`                                                 | 71   |
| `onError`      | `(error: unknown) => unknown`                                           | 72   |

The task function receives `(args, { signal })`, where `signal` is an `AbortSignal`
(`TaskFunctionOptions`, lines 2–4), and may return `initialState` to reset the task to
`INITIAL`.

### 7. `<bcd-compat-table>` written directly inside a `<table>`

**The parser moves the element out of the table** in Chromium, Firefox, and WebKit. The page has
no script, so this is the HTML parser alone, and the result does not depend on whether the
element is defined.

```html
<div id="direct-wrapper">
  <table id="direct-table">
    <bcd-compat-table id="direct"><p>Fallback</p></bcd-compat-table>
    <tr><td>Cell</td></tr>
  </table>
</div>
```

After parsing, `bcd-compat-table#direct` is a child of `#direct-wrapper`, directly before the
`<table>`. Its own `<p>` child moves with it, and the `<tr>` stays in the table. The control case,
the element inside a `<td>`, stays in the cell. Test: `spike/tests/table-parse.spike.ts`.

The spike tested only a direct child of `<table>`. The same applies inside `<tbody>`, `<thead>`,
`<tfoot>`, and `<tr>` because of the HTML Standard's parsing rules, not because the spike showed
it: the "in table body" and "in row" insertion modes (§13.2.6.4.13 and §13.2.6.4.14) process any
other start tag "using the rules for the 'in table' insertion mode", and that mode (§13.2.6.4.9)
handles it with foster parenting enabled. These are parsing rules. They apply to HTML the parser
reads, including `innerHTML`, but not to DOM insertion: a script that calls `appendChild` to put
the element inside a `<table>` is not moved. The spike did not test either of those last two
cases.

### 8. Removing the element and adding it again

**No second render container is created** in any engine or build. After `remove()` and
`append()`, the element still has exactly one `div[data-render-container]`, `createRenderRoot()`
has run once, and a property change after reconnection renders into that same container. Test:
`spike/tests/light-dom.spike.ts`, "removing and re-adding the element…".

The reason is in `ReactiveElement.connectedCallback()`:
`this.renderRoot ??= this.createRenderRoot()`
(`@lit/reactive-element/development/reactive-element.js`, lines 575–578). The render root is
created only when none exists yet. Phase 2 keeps this property only if the container is created
in `createRenderRoot()`; creating it in `connectedCallback()` instead would add a new one on every
reconnection.

### Not verified

- Recovery when something other than Lit removes the render container. Section 3 shows that
  React can do this, and that Lit then renders into the detached container; the spike did not
  try any way of recovering.
- Whether fallback children parsed after the first update are hidden when the element is defined
  before parsing and already has data at that point (for example from `source`). Section 1 shows
  the children arrive after `connectedCallback()`; the spike did not combine this with data.
- `static styles` not being applied with the overridden `createRenderRoot()` comes from reading
  the source (section 1), not from a running test.
- A primitive React prop, and repeated `ref` callback assignment (section 5).
- `<tbody>`, `<tr>`, `innerHTML`, and `appendChild` placement (section 7).
- Real Safari and Chrome releases. The results are from Playwright's engine builds listed above.
- React's server rendering and hydration of the element. The spike tested client rendering only.

### Findings for the Document 3 amendment (#192)

The first two contradict text in Document 3. The rest add rules it does not state yet.

1. **§8 misstates React 19's rule (contradiction).** React 19.3.1 sets a property when the key
   already exists on the element, whatever the value's type. If the element is not defined before
   React renders it, `data` becomes the attribute `"[object Object]"` and the payload is lost.
   Document 3 should say that the element's module must run before React renders it, or
   recommend a `ref` callback, which works in every load order, with the identity caveat in
   section 5.
2. **§7 lets the `source` script sit "anywhere in the document" (contradiction, inferred).**
   Section 1 shows that when the element is defined before parsing, `connectedCallback()` runs
   before the parser has read anything after the element's start tag. A `source` script that
   comes later in the document would then not exist yet when the element reads it "once in
   `connectedCallback`, synchronously" (§4). The spike did not test `source` itself; this follows
   from the observed order.
3. **Retiring fallback content needs a mechanism that also covers later children.** Toggling
   `hidden` per child works with React (no errors, children stay in place), but it is a one-time
   snapshot: a child React adds later is visible and lands after the table (section 3), and a
   text-only fallback cannot be hidden at all (section 3). Children parsed after the first render
   raise the same question (section 1). Document 3 should choose a mechanism that covers all of
   these, for example a state attribute on the host with a base-style rule that hides its
   non-container children, and should state that the element never removes author children,
   because removal made React throw and unmount in the test.
4. **React string children destroy the render container.** A single string child that React
   later changes wipes the container, and the table silently stops rendering (section 3).
   Document 3 should either require element (not bare text) fallback children under frameworks,
   or have the element detect a detached container and restore it.
5. **The container's position depends on load order.** It comes after the author's children
   when the element is upgraded after parsing, and before them when it is defined first
   (section 1). Any base style or test that assumes one order must allow for both.
6. **The light-DOM render root rules out `static styles`, and `declare` is required.**
   Overriding `createRenderRoot()` without calling `super` skips Lit's style adoption (source
   read only), so base styles stay an ordinary stylesheet, as §3 already plans. Every reactive
   property must be a `declare` field with its default in the constructor, because a plain field
   broke updates silently in the production build (section 4).
7. **Placement inside a table.** The author documentation should say the element cannot be
   written directly inside `<table>`, `<tbody>`, or `<tr>` in HTML; the parser moves it before
   the table. Inside a cell it is fine (section 7).

The light-DOM and `static properties` assumptions themselves held: none of the tests found a
reason to give them up. The `hidden` assumption held for element children, with the gaps in
findings 3 and 4.

## Issue #188 — Test, build, size, and stylelint tooling

Status: measured locally on 18 November 2026. The numbers that only a GitHub Actions runner can give are
listed under "To measure in CI" with exact commands, because this spike ran without permission to push a
branch or start a workflow.

### Summary

- A Chromium Vitest project can sit beside the Node tests in the root config without changing which Node
  tests run, but only if the Node project excludes the browser test files. Without the exclusion, the Node
  project also collects the browser file.
- Installing only Chromium's headless shell (`playwright install --only-shell chromium`) took 17.6 s cold
  against 44.9 s for `playwright install chromium`, both with Playwright 1.65.1, a saving of about 27 s. The
  disk use with Playwright 1.65.0 was 222 MB against 584 MB. Vitest's headless Chromium uses the headless
  shell, so the smaller install is enough for the Vitest project.
- `size-limit` with `@size-limit/preset-small-lib` exits 1 over the limit and 0 under it. It counts an
  external `lit` import in the total unless the entry sets `ignore: ["lit"]`.
- Vite library mode emits a second chunk for a dynamic `import()`.
- Flattening `@import ... layer()` works with Vite's default CSS pipeline, with `lightningcss`, and with
  `postcss-import`. In all three the `@property` rule ends up inside its `@layer` block, not at the top
  level. Chromium, Firefox, and WebKit still register it there. None of them currently registers an
  `@property` rule that sits in a shadow root, whether in a `<style>` element, inside `@layer`, or in an
  adopted stylesheet. The CSS specification draft says they should (section 6).
- At an `available` floor of `2025`, the Baseline linter flags exactly one construct from the test
  stylesheet: the `@supports selector(:has(*))` block. No documented option silences it, so the block must
  be removed.
- The current `check` job on `main` leaves at least 253 s of headroom under its 600 s limit.

### Measurement environment

Local numbers come from one machine, so treat them as upper-bound shapes, not CI predictions.

| Item                  | Value                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| Machine               | macOS (Darwin 27.2.0), Apple silicon                                                                         |
| Load during the runs  | Load average between 18 and 37, because other agents ran builds in parallel. This inflates every duration.  |
| Node.js               | v26.13.1                                                                                                     |
| Repository pnpm       | 11.24.0 (from `packageManager`)                                                                              |
| Lab project pnpm      | 12.9.1 (a scratch project outside the repository has no `packageManager` field)                              |
| Vitest                | 5.1.0, with `@vitest/browser-playwright` 5.1.0                                                               |
| Playwright            | 1.65.0 in the repository (`@playwright/test`), 1.65.1 in the scratch project                                 |
| Chromium / Firefox / WebKit | Chrome for Testing 158.0.8127.18 (Playwright 1.65.0) and 159.0.8154.6 (1.65.1) / Firefox 159.0 / WebKit 27.2 |
| Vite                  | 8.3.8                                                                                                        |
| size-limit            | 14.3.0, with `@size-limit/preset-small-lib` 14.3.0, which bundles with rolldown                              |
| Lit                   | 3.3.3                                                                                                        |
| Custom Elements Manifest analyzer | `@custom-elements-manifest/analyzer` 0.11.0                                                      |
| CSS bundlers          | `lightningcss` 1.33.0, `postcss` 8.5.33, `postcss-import` 17.0.1                                             |
| Stylelint             | 17.16.0, with `stylelint-plugin-use-baseline` 1.4.8                                                          |

Repository measurements ran in the repository worktree. Everything else ran in a scratch project outside the
repository, so nothing here changes `package.json`, the lockfile, or the shared configuration. The one
repository experiment (the second Vitest project) was reverted; `git status` was clean afterwards.

### 1. Browser downloads

`playwright install` puts browsers in a per-user cache directory. On Linux this is `~/.cache/ms-playwright`
unless `PLAYWRIGHT_BROWSERS_PATH` or `XDG_CACHE_HOME` overrides it (from `defaultCacheDirectory()` in
`playwright-core`; this spike ran on macOS and did not confirm the Linux path, so run `playwright install
--list` in CI to see it). "Cold" means an empty directory, set with `PLAYWRIGHT_BROWSERS_PATH`.
"Warm" means the same command run again on a filled directory; it downloads nothing, so it measures process
start-up. Times are wall-clock (`time`) and include pnpm's own start-up.

| Command                                                                      | Playwright | Cold    | Warm   | Disk   |
| ---------------------------------------------------------------------------- | ---------- | ------- | ------ | ------ |
| `playwright install chromium`                                                | 1.65.1     | 44.9 s  | 4.3 s  | 604 MB |
| `playwright install chromium`                                                | 1.65.0     | 93.7 s  | 6.0 s  | 584 MB |
| `playwright install chromium firefox webkit`                                 | 1.65.1     | 50.2 s  | 0.5 s  | 1.2 GB |
| `playwright install --only-shell chromium`                                   | 1.65.0     | 13.8 s  | not run | 222 MB |
| `playwright install --only-shell chromium`                                   | 1.65.1     | 17.6 s  | not run | not measured |

What the numbers show:

- `playwright install chromium` installs three things: Chrome for Testing, the headless shell, and FFmpeg.
  The headless shell is the part that headless Vitest runs use. `--only-shell` (listed in
  `playwright install --help`) skips the full browser.
- The two cold Chromium rows differ by a factor of two for the same download size, which is network and
  machine noise. A single cold run says little. CI numbers need several runs.
- The pinned Playwright version matters. The browser build is tied to the Playwright version: running Vitest
  against an installed 1.65.1 browser (`chromium_headless_shell-1255`) from the repository's 1.65.0 fails
  with `browserType.launch: Executable doesn't exist at ...chromium_headless_shell-1254/...`. Always
  install with the workspace's own Playwright: `pnpm --filter @bcd-embed/element exec playwright install ...`.
  The existing Screen readers workflow already does this (`.github/workflows/screen-readers.yml`, line 122).

### 2. Browser test runs

Both projects test the same 20-test probe: it mounts a Lit element, then reads its shadow DOM and a computed
style. The durations below are the tool's own report, followed by wall-clock time in parentheses.

| Run                                                                             | Run 1          | Run 2          | Run 3          |
| ------------------------------------------------------------------------------- | -------------- | -------------- | -------------- |
| Vitest browser project, Chromium, 20 tests (scratch project, Vitest 5.1.0)      | 3.21 s (4.5 s) | 0.53 s (1.1 s) | 0.60 s (1.2 s) |
| Same project inside the repository root config, `vitest run --project browser`  | 3.71 s (6.5 s) | 1.41 s (3.8 s) | 1.15 s (3.5 s) |
| Playwright Test, 20 tests in three engines (60 test runs), `playwright test`    | 36.6 s (37.7 s) | 38.8 s (42.4 s) | 12.7 s (13.2 s) |

One Playwright Test run per engine, taken straight after those three: Chromium 2.5 s, Firefox 8.2 s,
WebKit 3.8 s. The spread between the three-engine runs (12.7 s to 38.8 s) comes from the load on the machine.
The first Vitest run is slower because Vite optimizes dependencies once.

Playwright Test needed a web server for the page, so its config starts `vite --port 5199 --strictPort`
through `webServer` and sets `use.baseURL`. Vitest browser mode serves the test files itself.

Both tools fail when a test fails. A deliberately failing test exits 1 in each (`vitest run` with the
browser config, and `playwright test --project=chromium`).

Vitest config keys used, each checked in `vitest/dist/chunks/plugin.d.LRFSN46m.d.ts` (and the provider in
`@vitest/browser-playwright/dist/index.d.ts`): `test.projects`, a project's `extends`, `test.browser.enabled`,
`browser.headless`, `browser.provider` set to `playwright()`, and `browser.instances: [{ browser: "chromium" }]`.
Playwright config keys used, checked in `playwright/types/test.d.ts`: `testDir`, `fullyParallel`, `reporter`,
`use.baseURL`, `projects`, and `webServer` with `command`, `url`, and `reuseExistingServer`.

### 3. A browser project beside the Node tests

The experiment added `@vitest/browser-playwright@5.1.0` to the root `package.json`, turned the root
`vitest.config.ts` into two projects (`node` and `browser`, both `extends: true`), and added one browser test
file, `packages/element/browser-probe/probe.browser.test.ts`. Playwright 1.65.0 already resolved as the peer
dependency, so no second Playwright copy appeared in the lockfile. The experiment was then reverted.

The two lists are the output of `pnpm exec vitest list --json`, which counts test definitions statically. A
test defined in a `for` loop counts once. The compared key is the file path plus the full test name.

| Configuration                                                              | Collected tests | Notes                                                                    |
| -------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------ |
| Before: the existing root config                                           | 319             |                                                                          |
| After, no `exclude` on the Node project                                    | 320 in `node`   | The browser file leaks into `node` (one extra entry). It is not identical. |
| After, `exclude: [...defaultExclude, ".claude/worktrees/**", "**/*.browser.test.ts"]` on `node` | 319 in `node`, 1 in `browser` | The Node list is identical to the "before" list. |

Executed tests, from `vitest run --project node` and a full `vitest run` with Chromium installed: the Node
project ran 482 tests, and the full run reported 502 passed, which is 482 plus the 20 browser tests. Some Node
tests timed out in other runs made while the load average was 18 to 37 (`packages/core/tests/dataset.test.ts`
in one run; `packages/generator/tests/diff.test.ts` and `apps/worker/tests/worker.test.ts` in another). I infer
that the machine load caused those timeouts; I did not measure it. Two facts support the inference: the same
tests passed in the run with both projects, and the original, unmodified config's `pnpm check` also passed
all 482 Node tests. A repeat run on a quiet machine would confirm it.

Two practical findings:

1. The experiment repeated `.claude/worktrees/**` in the Node project's own `exclude`, because Vitest merges a
   project's options with the root's and this spike did not test whether the two `exclude` lists combine.
   Repeat the pattern, or other worktrees' tests may run again.
2. Naming browser tests `*.browser.test.ts` gives the Node project one pattern to exclude. A browser project
   that only lists an `include` does not stop the Node project from collecting those files.

### 4. size-limit

Configuration lives in `.size-limit.json`. Each entry's keys (`path`, `limit`, `ignore`, `entry`) are listed in
`size-limit/index.d.ts` and `size-limit/get-config.js`. `@size-limit/preset-small-lib` 14.3.0 is
`[...rolldown, ...file]`, so it bundles with rolldown, minifies, and measures with Brotli.

| Case                                                       | Result                                                                 | Exit code |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- | --------- |
| Probe element, `limit: "100 B"`                            | 5.34 kB, "Package size limit has exceeded by 5.24 kB"                  | 1         |
| Probe element, `limit: "50 kB"`                            | 5.34 kB, passes                                                        | 0         |

Command: `node node_modules/size-limit/bin.js` run in a directory with the `.size-limit.json` shown above.

**Is an external dependency counted?** Yes, by default. The probe imports from `lit`:

| Entry                                              | Size (Brotli) | Meaning                                       |
| -------------------------------------------------- | ------------- | --------------------------------------------- |
| `src/probe-element.js`, no `ignore`                | 5,341 B       | `lit` is bundled and counted                  |
| `src/probe-element.js`, `"ignore": ["lit"]`        | 184 B         | `lit` is excluded; only the component counts  |

The same holds for a file that Vite built with `lit` externalized. The built `dist/main.js` still contains
`import { LitElement as e, html as t } from "lit"`, and size-limit resolves that import and counts it:

| Entry                                                 | Size (Brotli) |
| ----------------------------------------------------- | ------------- |
| `dist/main.js`, no `ignore`                           | 5.29 kB       |
| `dist/main.js`, `"ignore": ["lit"]`                   | 246 B         |
| `dist/main.js`, `"ignore": ["lit"]`, `"entry": ["main"]` | 199 B      |

The last row shows a second effect. By default size-limit adds every chunk the entry produces, so the
dynamically imported chunk (section 5) is in the 246 B. `entry: ["main"]` limits the total to the main chunk
and the chunks it imports statically; the dynamic chunk then drops out (47 B difference).
Recommendation: budget the component with `"ignore": ["lit"]` and decide separately whether `lit` has its own
budget.

### 5. Vite library mode and dynamic `import()`

Config (`build.lib` is documented in `vite/dist/node/index.d.ts`, `LibraryOptions`; Vite 8 names the bundler
option `rolldownOptions`, and `rollupOptions` is a deprecated alias):

```js
build: {
  lib: { entry: "src/main.js", formats: ["es"], fileName: "main" },
  rolldownOptions: { external: ["lit", /^lit\//] },
}
```

Command: `pnpm exec vite build <dir>`. Output:

```text
dist/lazy-BmytB9oe.js  0.07 kB │ gzip: 0.09 kB
dist/main.js           0.39 kB │ gzip: 0.28 kB
```

**Library mode emits a second chunk for a dynamic `import()`**, with a content hash in its name. The entry
refers to it as `import("./lazy-BmytB9oe.js")`. A consumer that copies only `main.js` loses the lazy code.
If the component must ship as a single file, the dynamic import has to become a static one.

### 6. Flattening `@import ... layer()` into one `base.css`

Input (`base.css`, with `tokens.css` holding an `@property` rule and `:host`, and `table.css` holding a rule
for `table`):

```css
@layer tokens, components;

@import "./tokens.css" layer(tokens);
@import "./table.css" layer(components);
```

Three tools produce a single flattened file. All three keep the layers and nest the `@property` rule inside
`@layer tokens`:

| Tool and exact invocation                                                                     | One file? | `@property` at top level? | Notes                                                                                       |
| --------------------------------------------------------------------------------------------- | --------- | ------------------------- | ------------------------------------------------------------------------------------------- |
| Vite 8.3.8 library mode, default CSS pipeline: `build.lib.cssFileName: "base"`, `build.cssMinify: false`, entry is a JS file that does `import "./base.css"` | Yes, `dist/base.css` | No, inside `@layer tokens` | Keeps `@layer tokens, components;`. Appends a `/*$vite$:1*/` comment. Also emits an empty `entry.js`. |
| Vite with `css: { transformer: "lightningcss" }`, same other options                          | Yes       | No, inside `@layer tokens` | Drops the `@layer tokens, components;` statement (the block order sets the layer order). Adds `--lightningcss-light` and `--lightningcss-dark` custom properties and a `prefers-color-scheme` media rule around `color-scheme: light dark`. |
| `lightningcss` 1.33.0, `bundle({ filename })` from `lightningcss`                             | Yes       | No, inside `@layer tokens` | Rewrites `rebeccapurple` as `#639`. Drops the `@layer` order statement.                      |
| `postcss` 8.5.33 with `postcss-import` 17.0.1, `postcss([postcssImport()]).process(css, { from })` | Yes  | No, inside `@layer tokens` | Keeps `@layer tokens, components;`. Leaves values unchanged.                                |

The recommended tool is Vite's own CSS pipeline with `build.cssMinify: false` set explicitly. It adds no
dependency, keeps the layer order statement, and leaves values alone. The option matters: in Vite 8.3.8 the
default of `build.cssMinify` is `'lightningcss'` (`vite/dist/node/index.d.ts`, line 2798, which types it as
`boolean | "lightningcss" | "esbuild"`). The rows above show what lightningcss does to this input: it drops the
`@layer` order statement and rewrites values. This spike did not run a build with the default minifier, so the
exact output of the default is untested; the first row ran with `cssMinify: false`. If minified CSS is wanted
for the published file, minify it as a separate, measured step. The `lightningcss` transformer also changes
`color-scheme` handling, which the component may not want.

**Keeping `@property` at the top level.** Import the file that holds the `@property` rules without
`layer()`. With `@import "./properties.css";` ahead of `@import "./table.css" layer(components);`, both
`lightningcss` `bundle` and `postcss-import` emit the `@property` rule at the top level and wrap only the table
rules in `@layer components`.

**Does a browser register an `@property` rule inside `@layer`?** Yes. A page-level check in real browsers
(`property-probe.mjs`, a `<style>` element, then `getComputedStyle(...).getPropertyValue("--probe")`; a
registered property reports its `initial-value`, an unregistered one reports an empty string):

| Case                                   | Chromium 159.0.8154.6 | Firefox 159.0 | WebKit 27.2 |
| -------------------------------------- | --------------------- | ------------- | ----------- |
| Top level, document stylesheet         | registered            | registered    | registered  |
| Inside `@layer`, document stylesheet   | registered            | registered    | registered  |
| Top level, shadow-root `<style>` element | not registered      | not registered | not registered |
| Inside `@layer`, shadow-root `<style>` element | not registered | not registered | not registered |
| Top level, shadow-root adopted stylesheet (`new CSSStyleSheet()`, `replaceSync`, `adoptedStyleSheets`) | not registered | not registered | not registered |

All five cases ran in a fresh page each, in `property-probe.mjs`. The adopted-stylesheet case is the mechanism
Lit's `static styles` uses in browsers that support it, so the last three rows cover how a Lit component would
ship the rule. This spike did not run Lit itself for this check; the adopted-stylesheet case stands in for it.

**This is current browser behavior, and it contradicts the specification draft.** The CSS Properties and
Values API editor's draft (https://drafts.css-houdini.org/css-properties-values-api/), section 2.8 "Shadow
DOM", says registrations "are not scoped to a tree scope", and that registrations in the document or within a
shadow tree share one global registration map. Its changelog says "Allowed @property in shadow trees". Chromium
159.0.8154.6, Firefox 159.0, and WebKit 27.2 all ignore the rule in a shadow root today. The advice therefore
holds only until the engines implement the draft: register `@property` from a document-level stylesheet that
the component's consumer loads, or call `CSS.registerProperty()` in script, and re-run `property-probe.mjs`
when upgrading Playwright's browsers.

### 7. Custom Elements Manifest

The invocation that produces a manifest for a class with `static properties`:

```text
cem analyze --litelement --globs "src/**/*.js" --outdir dist
```

Run with `@custom-elements-manifest/analyzer` 0.11.0 (`node_modules/.bin/cem`). The flags are listed in
`src/utils/cli-helpers.js`. The output is `dist/custom-elements.json`.

- With `--litelement`, the manifest lists each `static properties` entry as a field and as an attribute
  (`label` and `open`), with its type, default, and `reflects: true` where set.
- Without `--litelement`, the manifest lists `properties` and `styles` themselves as members, only the
  attribute named in an `@attr` JSDoc tag appears, and `open` is missing.
- **It rewrites `package.json` by default.** `packagejson` defaults to `true`. The command above added
  `"customElements": "dist/custom-elements.json"` to the `package.json` in the working directory.
- To stop that, set `packagejson: false` in `custom-elements-manifest.config.mjs`. A bare `cem analyze` reads
  that default config file, so the config above (`globs`, `outdir`, `litelement: true`, `packagejson: false`)
  produces the manifest and leaves `package.json` unchanged. The `--packagejson` flag is a plain boolean and
  cannot be negated on the command line.

### 8. Baseline linter

Test stylesheet: an `@property` rule, `color: light-dark(black, white)` inside `:host`, a `.row:has(.cell)`
rule, an `@container (min-width: 20rem)` rule, and an `@supports selector(:has(*))` block around a `:has()`
rule. The options come from `node_modules/stylelint-plugin-use-baseline/README.md`. Each run:
`pnpm exec stylelint --config <config> --config-basedir <repo> test.css`, with
`stylelint-config-standard` plus the plugin rule `[true, { ... }]`. Results are from 18 November 2026 and
depend on the Baseline data inside the plugin at that date.

| Construct                              | `available: "widely"` (the repository's current setting) | `available: "newly"` | `available: 2025` |
| -------------------------------------- | -------------------------------------------------------- | -------------------- | ----------------- |
| `@property`                            | flagged                                                  | passes               | passes            |
| `light-dark()`                         | flagged                                                  | passes               | passes            |
| `:has()`                               | passes                                                   | passes               | passes            |
| `@container`                           | passes                                                   | passes               | passes            |
| `@supports selector(:has(*))` block    | flagged as unnecessary                                   | flagged as unnecessary | flagged as unnecessary |

Messages, in the same order: `At-rule "@property" is not a widely available baseline feature.`,
`Function "light-dark" is not a widely available baseline feature.`, and
`@supports selector(:has(*)) is unnecessary as the feature meets the <level> availability requirement.`
Exit code was 2 whenever anything was flagged, 0 otherwise.

**At the `2025` floor the only flagged construct is the `@supports` block.** What would silence each flagged
construct:

| Flagged construct                        | Documented option that silences it (README heading)                                     | Verified |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- | -------- |
| `@property` at `widely`                  | `ignoreAtRules: ["property"]` (`### ignoreAtRules`), or raise `available` to `"newly"` or `2025` (`### available`) | yes      |
| `light-dark()` at `widely`               | `ignoreFunctions: ["light-dark"]` (`### ignoreFunctions`), or raise `available`          | yes      |
| `@supports selector(:has(*))`, any floor | None. The README lists the rule under `## Rule Details` ("Unnecessary `@supports` blocks when all checked features are already available at the configured baseline level") and shows it as a problem under `### true`, but no option turns it off. `ignoreAtRules: ["supports"]`, `ignoreSelectors: ["has"]`, and `ignoreSelectors: ["/^has/"]` were each tried at `2025` and none silenced it. | yes, by trying |

So the `@supports selector(:has(*))` construct **must be avoided**: remove the block and use `:has()` directly,
because `:has()` meets the floor. If a fallback block is ever required, a Stylelint inline comment,
`/* stylelint-disable-next-line plugin/use-baseline */`, silenced the error in a test run. That comes from
Stylelint itself, not from the plugin's options, and it would need a decision from the owner.

`ignoreUnits` was not needed for this stylesheet. A separate check showed `cqw` and `svh` pass at both
`"widely"` and `2025`; at `available: 2022` the `cqw` unit is flagged and `ignoreUnits: ["cqw", "svh"]`
silences it.

Policy note: `.stylelintrc.json` is managed by Calavera. Changing `available` or adding `ignoreAtRules` and
`ignoreFunctions` is a shared-policy change, so it belongs in the Calavera recipe (`calavera.config.json`) and
not in a hand edit. This spike changed none of the managed files.

### 9. Headroom in the `check` job

Durations of the `check` job (job `started_at` to `completed_at`, read with `gh api
repos/schalkneethling/bcd-embed/actions/runs/<id>/jobs`) for the three most recent CI runs on `main`. The job's
limit is `timeout-minutes: 10`, which is 600 s.

| Run (push to `main`)                                                                          | Commit    | Job duration | Headroom |
| --------------------------------------------------------------------------------------------- | --------- | ------------ | -------- |
| [44178910043](https://github.com/schalkneethling/bcd-embed/actions/runs/44178910043)          | `33eed21` | 347 s        | 253 s    |
| [44176076635](https://github.com/schalkneethling/bcd-embed/actions/runs/44176076635)          | `fce9231` | 309 s        | 291 s    |
| [44166238446](https://github.com/schalkneethling/bcd-embed/actions/runs/44166238446)          | `40ed3ec` | 228 s        | 372 s    |

The smallest headroom is 253 s, about 4 minutes 13 seconds. The time goes mostly to three steps, in the
slowest run: the core mutation gate 137 s, "Validate generated artifacts at full BCD volume" 95 s, and
`pnpm check` 81 s. Install steps total roughly 30 s. The three runs span 228 s to 347 s and were started
within about 72 minutes of each other (20:09 to 21:21 UTC on 17 November 2026). Three samples show a range, not a trend.

### 10. Recommendation: does the Chromium Vitest project join `pnpm check`?

**Yes, provisional until the CI numbers exist.** A browser test is the only way to check shadow DOM and custom
element behavior that Node cannot run, and the local numbers are small next to the 253 s of headroom. But the
arithmetic below lacks the costs that only an `ubuntu-latest` runner shows, so the owner should confirm the
recommendation once the "To measure in CI" table is filled in.

What the local measurements say, to add to the 253 s of headroom (the smallest of the three runs):

- Browser install: `--only-shell` took 17.6 s cold and `playwright install chromium` took 44.9 s cold, both
  with Playwright 1.65.1 on the same machine, so the shell-only install saves about 27 s. The other pair
  (13.8 s and 93.7 s, Playwright 1.65.0) differs by far more than the first, and the 93.7 s run is the noisiest
  of the set, so this document does not use it for the saving. A repeat install into a filled directory took
  4 to 6 s, which is mostly process start-up.
- The 20-test Vitest browser run: 0.5 s to 3.7 s as Vitest reports it, 1.1 s to 6.5 s wall-clock. A real suite
  will be larger, and the time scales with test count and page weight, not with the install.
- Added together, a cold shell-only install and the slowest 20-test run came to about 25 s locally. That is
  small against 253 s, but it is a local number from a loaded machine.

Costs not yet in this arithmetic, all specific to the `ubuntu-latest` runner:

- The system packages that `playwright install --with-deps` installs. The flag is in `playwright install
  --help`; the packages it installs are not listed there, and the Screen readers workflow already passes it.
- Restoring and saving an `actions/cache` entry for the browser directory, which costs time on both a hit and a
  miss.
- The start-up of the browser project inside `vitest run`: launching the browser and Vite's dependency
  optimization. The first local run was 3.7 s against 1.2 s for later runs.

The conditions:

1. Install only the headless shell. With the pinning in condition 4, the command is `pnpm exec playwright
   install --only-shell chromium` from the repository root. This spike measured `--only-shell` only through
   `pnpm --filter @bcd-embed/element exec playwright install --only-shell chromium` (the workspace that owns
   Playwright today), so run the root form once before relying on it. It also saves about 360 MB of disk
   (584 MB against 222 MB, Playwright 1.65.0).
2. Install it before `pnpm check` in the CI workflow, and in the setup steps of `AGENTS.md`, because
   `pnpm check` runs `vitest run` and the browser project fails without the browser. A contributor without it
   gets a launch error, so the error message must lead to that command.
3. Keep the Node project's `exclude` for `**/*.browser.test.ts` (section 3), and keep the browser file naming
   rule, so the Node test list stays identical.
4. Own the Playwright version explicitly. `@vitest/browser-playwright` declares `playwright` as a peer
   dependency (`playwright: '*'` in `pnpm-lock.yaml` after the experiment), and `pnpm-workspace.yaml` sets
   `strictPeerDependencies: true`. In the experiment the peer resolved to the `playwright` 1.65.0 that
   `@playwright/test` in `packages/element` already pulls in, so it worked by accident of the existing tree.
   Recommended: the root `package.json` owns the browser project, because the root `vitest.config.ts`
   declares it, so add `@vitest/browser-playwright` and `playwright` there, with `playwright` pinned to the
   same exact version as `@playwright/test` in `packages/element` (1.65.0 today). Update the three together,
   because a browser build is tied to the Playwright version (section 1). With that in place, the install
   command needs no `--filter`, because the root owns the `playwright` binary. If the owner would rather keep
   the browser project in `packages/element`, put both packages there and keep
   `--filter @bcd-embed/element`. This spike did not test either arrangement end to end.

Firefox and WebKit should not join `pnpm check`. Three engines took 12.7 s to 38.8 s for 20 tests locally and
a 1.2 GB install. Run them in a separate advisory workflow, as the Screen readers workflow does, and revisit
once CI numbers exist.

### To measure in CI

These values need an `ubuntu-latest` runner, and the issue asks for each to cite its workflow run. Run them in
a throwaway workflow on the spike branch, three runs each, and record the run URLs here. None of these was
run in CI by this spike.

| What                                          | Exact command (from the repository root, after `pnpm install --frozen-lockfile`)                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Chromium alone, no cache                      | `time pnpm --filter @bcd-embed/element exec playwright install chromium`                                  |
| Headless shell alone, no cache                | `time pnpm --filter @bcd-embed/element exec playwright install --only-shell chromium`                     |
| Chromium, Firefox, WebKit, no cache           | `time pnpm --filter @bcd-embed/element exec playwright install chromium firefox webkit`                   |
| Each of the above with a cache                | Cache the directory that `playwright install --list` prints, keyed on the Playwright version, then rerun the same command. Record the time of a cache hit and of the install step that follows it. |
| 20-test Vitest browser project in Chromium    | `time pnpm exec vitest run --project browser`                                                             |
| 20-test Playwright Test run in three engines  | `time pnpm --filter @bcd-embed/element exec playwright test` with a config that lists the three projects |
| Full `pnpm check` with the browser project    | `time pnpm check`                                                                                         |

On Linux, `playwright install --with-deps` also installs system dependencies for the browsers (`playwright
install --help` says "install system dependencies for browsers" and does not list the packages). The Screen
readers workflow already uses it, so include it in one variant, record the extra time, and read the installed
packages from the job log.

Also record, in the same throwaway workflow, an `actions/cache` restore on a hit and a save on a miss for the
browser directory, and the first and later `vitest run --project browser` times, because those are the costs
the section 10 arithmetic is missing.

#### Added by issue #197 (the browser harness)

Issue #197 put the Chromium Vitest project into the root `vitest.config.ts`, so `pnpm check` now runs
it, and added the Element browser workflow. The root `package.json` owns `playwright` and
`@vitest/browser-playwright`, both pinned (1.65.1 and 5.1.0), and `ci.yml` and `freshness-backstop.yml`
run `pnpm exec playwright install --with-deps --only-shell chromium` before `pnpm check`. The root form
of the `--only-shell` install, which condition 1 asked someone to run once, worked on macOS.

Local numbers, one run each on the machine described above, on a quiet system: the new Node project
lists the same 341 tests as the old root config, the browser project lists the 1 smoke test,
`pnpm check` took 66 s end to end, and the three-engine Playwright Test run took 4.2 s for 3 tests.

Measured in CI on pull request #228 (the `check` job is run 44728957761, the Element browser workflow is run
44728957783). The Firefox rows show the failure and the fix.

| What the spike asked CI to measure | Value |
| ---------------------------------- | ----- |
| `check` job duration, against the 228 s to 347 s of the three earlier `main` runs and the 600 s limit | 261 s (11:36:20Z to 11:40:41Z), run [44728957761](https://github.com/schalkneethling/bcd-embed/actions/runs/44728957761). Headroom 339 s. |
| `Install Chromium for the Vitest browser project` step (`--with-deps --only-shell chromium`) | 11 s, same run. |
| `Check repository` step (`pnpm check`, including the Chromium Vitest project) | 56 s, same run. |
| Element browser, Chromium job | 55 s: install 26 s (`--with-deps --only-shell`), tests 3 s, run [44728957783](https://github.com/schalkneethling/bcd-embed/actions/runs/44728957783). |
| Element browser, WebKit job | 72 s: install 49 s (`--with-deps`), tests 3 s, same run. |
| Element browser, Firefox job, `--with-deps` | Hit the 15 minute timeout inside the install, same run, both attempts. `libavcodec62` and the 12 font packages in Playwright's Firefox list on Ubuntu 26.04 made `apt-get` fetch 39 packages (54 MB) from a mirror that served about one a minute. |
| Element browser, Firefox job, without `--with-deps` | 26 s: install 5 s, tests 4 s, run [44733739093](https://github.com/schalkneethling/bcd-embed/actions/runs/44733739093). The dry run still lists the 39 packages as missing (the `libavcodec62` chain and fonts), and Firefox launched and passed without them. In the same run Chromium took 49 s and WebKit 53 s. |

The recommendation in section 10 holds: Chromium joins `pnpm check`, which finished 339 s under its limit.

### Open items for the owner

- The CI numbers above.
- Whether to change the Baseline `available` floor or add `ignoreAtRules` and `ignoreFunctions`. That is a
  Calavera recipe change.
- Whether size-limit budgets the component with or without `lit` (section 4).
- Whether the component ships as one file, which rules out the dynamic `import()` (section 5).

## Issue #215 — NVDA with Firefox in the screen reader CI on a Windows runner

**Question.** Can NVDA with Firefox run the screen reader walks on a GitHub-hosted Windows runner
reliably enough to be part of the required `screen-readers` check, and how many of Document 7's
manual steps can it automate?

**Status.** NVDA runs on `windows-2025`. Four manual runs on 18 November 2026 completed, and in
all four NVDA performed every step and gave the same transcript, word for word, on every attempt.
All four failed, and only on soft checks written in the markup's spelling rather than NVDA's
("Node.js" where NVDA says "Node dot js"). The checks are now written from NVDA's real wording. On that change (commit `b623cf1`), five
consecutive manual runs passed on 18 November 2026 with no retry, which meets the issue's
condition for NVDA joining the required `screen-readers` check.

### What the change does

The workflow `.github/workflows/screen-readers.yml` gains a third matrix entry: NVDA on
`windows-2025` with Playwright's Firefox. Its result feeds the same `screen-readers` job as
VoiceOver and Orca, so an NVDA failure fails the required check. The job's steps now run in Bash
on every runner, which on Windows is the Bash that comes with Git for Windows. That keeps one set
of steps for all three runners, including the empty `run` prefix that NVDA shares with
VoiceOver. The job's time limit rises from 30 to 45 minutes, because each NVDA test may take up
to ten minutes and is retried once.

`packages/element` gains `playwright.nvda.config.ts`, the `test:nvda` script, and
`screen-reader/table.nvda.ts`. The test uses `nvdaTest` from `@guidepup/playwright`, whose
`navigateToWebContent` already works around a Firefox focus problem under NVDA
(`lib/navigateNVDAtoWebContent.js`, which cites nvaccess/nvda#5758).

The walk shared with VoiceOver and Orca (`screen-reader/walk-table.ts`) gains an optional list of
extra steps that one reader performs after the shared moves, recorded into the same transcript.
NVDA uses it for Document 7's steps 2 and 8 to 14. Every check in an extra step is soft, so a
mismatch fails the test but the walk still runs to its end and every step reaches the transcript.
The walk refuses extra steps whose names repeat, because the soft checks look a step up by name.
The walk also takes `sharedWording`, which replaces the shared checks for a reader whose real
wording differs from the markup's text, as NVDA's does. Document 7's section "NVDA in CI" lists,
step by step, which are asserted, which are performed for transcript review, and which stay
manual.

Two fixes to the shared walk came out of the issue's requirement that the artifact hold a
transcript for every performed step, on a pass and on a failure. Both also apply to VoiceOver and
Orca:

1. The transcript was attached as a `body`, which Playwright does not write to `test-results/` as
   a file. After a pass it reaches only the reporters, so the uploaded artifact held no
   transcript. After a failure it is inside `trace.zip`, because the configs keep the trace on
   failure and tracing includes attachments, so reading it meant opening the trace. The walk now
   writes `transcript.json` into the test's output directory and attaches that file.
2. Each step was recorded after its page check, so a failed check dropped that step's output from
   the transcript. Each step is now recorded first.

### How many manual steps NVDA performs

Guidepup's NVDA class exposes every NVDA keyboard command, including table navigation
(Control+Alt+arrows), next table (`T`), next list item (`I`) and the default action (Enter). That
is enough to perform every step from 8 to 14, and step 2. Step 7, a full Tab traversal, is left
manual because it tests the page's tab order more than NVDA, and Document 3 §9 already asks for
it as a scripted keyboard test of the component.

| Document 7 state                      | Steps                       |
| ------------------------------------- | --------------------------- |
| Asserted in CI                        | 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14 |
| Manual                                | 7                                       |

Steps 10, 13 and 14 also ask for a person's judgment ("clearly different", "helps or is noise",
"any difference"), which the transcript informs but no check can give.

### How the checks were chosen

Guidepup documents NVDA's API, not NVDA's wording, so the first version checked only text the
markup defines and left NVDA's own wording unchecked until a run recorded it. The first four runs
recorded it, and every NVDA step now checks the phrase NVDA actually spoke there, copied from the
transcripts of run 44354307768 and confirmed against run 44345867416. That includes NVDA's role
and state words ("button, collapsed", "expanded", "list, with 2 items, bullet"), the table size,
and the header announcements.

The checks keep NVDA's spelling of what it speaks, such as "Node dot js", rather than normalising
punctuation in the test. A user hears that wording, so a change in it should fail the test. Each
check is a phrase the transcript must contain, so the parts NVDA reads before or after it are not
checked: on Tab to the region, for example, only the region and table announcement is checked,
not the reading of every cell that follows.

### What the first runs showed

The transcripts were identical in all four runs and on every retry, so the failures were not
flaky. Three soft checks failed in every run, because they were written in the markup's spelling:

| Check                              | Expected                              | NVDA said                                                      |
| ---------------------------------- | ------------------------------------- | -------------------------------------------------------------- |
| "move right to Node.js", A and B   | "No data for Node.js"                 | "Node dot js Server, column 4, No data for Node dot js" (A)    |
| Step 10, `unknown_runtime`         | "Support unknown in Node.js"          | "Node dot js Server, column 4, Support unknown in Node dot js" |
| Step 12, `async_iterable` header   | `async_iterable.*\(part of Array\.from\)` | "row 16, async iterable, (part of Array dot from)"         |

The cause is NVDA's default punctuation level. It speaks "." inside a word as "dot", reads an
underscore as a pause, and splits a camel-case identifier into words: "missing_target" is "missing
target", "AudioTrackList" is "Audio Track List", and "localName" is "local Name". That is what an
NVDA user hears, so the expectations follow it.

Every move landed on the cell the walk intended, and every disclosure opened. The other findings,
which Document 7 records step by step:

- **Column headers.** NVDA announces the column header on every column change, unlike Orca, and
  includes the platform: "Node dot js Server, column 4" in variant A and "Server Node dot js,
  column 4" in variant B.
- **Row headers.** NVDA announces the row header on every row change. In variant B it announces
  every ancestor row header too: "Array from async iterable, row 8" (step 13).
- **The region reads the whole table.** On Tab to the region, NVDA announces the region and the
  table, then reads every header and cell of the table, all 16 rows in variant A, before it
  stops. That is a long announcement for one tab stop, and a question for the owner rather than
  a test failure.
- **A stray "dot".** The flag preference item ends "to, enabled, dot", because the full stop sits
  after the closing `code` element and NVDA reads it as a separate symbol.
- **Variant A's row header runs together on a row change.** Moving down to `from` gives
  "from(part of Array), row 15", without the pause NVDA gives it on a column change ("from, (part
  of Array)").

### Still unverified

- **Reliability with the corrected checks.** The four runs say NVDA is deterministic, but no run
  has yet passed, so none has shown a pass without a retry.
- **Reliability over time.** Guidepup's own NVDA Firefox example config sets `retries: 5`, which
  suggests NVDA with Firefox flakes on hosted runners, though these four runs did not. This
  repository keeps `retries: 1`, as for the other readers. A test that passes on its retry is
  reported as flaky in the list reporter's summary, and the issue counts that as a failed run.
- **Wording across NVDA releases.** The checks pin NVDA's exact wording, so a new NVDA release
  installed by `@guidepup/setup` may change it. The transcript then shows the new wording.

Settled by the first runs: the runner setup (`@guidepup/setup@0.29.3 setup --ci` and `install
nvda`), pnpm under Git Bash on Windows, NVDA's starting position, Enter toggling a summary in
browse mode, table navigation from inside an open disclosure's list, and `I` reading a history
item whole. The time limits were generous: the NVDA job took about five minutes.

### Decision rule

If any of the five manual runs fails or passes only on a retry, the spike names the flaky step
and its failure rate, and NVDA leaves the required check until that is fixed: either by removing
the matrix entry or by making the NVDA job advisory. If NVDA cannot run reliably within the
two-day time box, the spike stops here and the owner chooses again. The owner passes in #186 and
#212 then fall back to a tester or a virtual machine.

### Results of the manual runs

The first four runs used the checks written before NVDA had run, so they count as the spike's
first evidence, not as the five consecutive runs. Each test took 40 seconds to a minute on each
attempt.

| Run | Run ID      | NVDA job | Variant A | Variant B | Retried | Notes |
| --- | ----------- | -------- | --------- | --------- | ------- | ----- |
| 1   | 44345867416 | 5 min 2 s | Failed   | Failed    | Yes, failed again | The three wording failures above, on both attempts. VoiceOver and Orca passed. |
| 2   | 44349309077 | 4 min 58 s | Failed  | Failed    | Yes, failed again | The same failures. VoiceOver and Orca passed. |
| 3   | 44350926720 | 4 min 46 s | Failed  | Failed    | Yes, failed again | The same failures. VoiceOver was cancelled because no hosted macOS runner picked the job up ("The job was not acquired by Runner of type hosted"), which this change does not affect. |
| 4   | 44354307768 | 5 min 8 s | Failed   | Failed    | Yes, failed again | The same failures. VoiceOver was cancelled for the same macOS capacity reason. |
| 5   | 44357655471 | 5 min 1 s | Failed | Failed  | Yes, failed again | Ran the old checks after a long wait for a macOS runner; NVDA failed as in runs 1 to 4, and VoiceOver was cancelled again for macOS capacity. |

The five consecutive runs on the corrected checks, at commit `b623cf1`, all passed with no retry.
Each run's list reporter printed "2 passed (1.7m)" for NVDA, with no "flaky" count and no
"retry #1" line, and VoiceOver, Orca and the required `screen-readers` job also passed.

| Run | Run ID      | NVDA job  | Variant A | Variant B | Retried | Notes |
| --- | ----------- | --------- | --------- | --------- | ------- | ----- |
| 1   | 44369145097 | 2 min 59 s | Passed   | Passed    | No      | All screen reader jobs passed. |
| 2   | 44370147131 | 2 min 48 s | Passed   | Passed    | No      | All screen reader jobs passed. |
| 3   | 44373329846 | 2 min 59 s | Passed   | Passed    | No      | All screen reader jobs passed. |
| 4   | 44377257673 | 3 min 1 s  | Passed   | Passed    | No      | All screen reader jobs passed. |
| 5   | 44378316134 | 2 min 50 s | Passed   | Passed    | No      | All screen reader jobs passed. |

## Issue #189 — Cloudflare zone facts for the two new hostnames

**Question.** Can both hostnames (`browser-compat.dev` for the introduction page and `docs.browser-compat.dev`
for the documentation site) be attached as planned, and what headers can the documentation site safely send?

**Status.** Answered on 20 November 2026. The owner supplied the dashboard facts from
screenshots, so they are recorded as the owner's reading, not as something this spike verified. The local dry run
and the Content-Security-Policy check ran on this branch. The rate-limit probe ran on 20 November 2026 with the
owner's approval and the rule still blocks. The account warns about Workers spend through an email budget alert.

| Acceptance criterion                                 | Result                                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| DNS records and blockers                             | Nothing blocks either hostname. Owner-supplied.                              |
| Dry run with `routes`, `workers_dev`, `preview_urls` | Passed. The change stays in `apps/website/wrangler.jsonc`.                   |
| Deploy credentials                                   | Interactive `wrangler login`, so no token permissions apply. Coordinator-confirmed. |
| Report-Only policy violations                        | Recorded below for the home page, a Mermaid page and the search dialog.      |
| Rate-limit probe (301 requests)                      | Ran 20 November 2026: 300 `200` and one `429`. Details below.                |
| Rollback procedure                                   | Quoted below with its address.                                               |
| Usage notification, Always Use HTTPS                 | HTTPS is on. Workers spend is covered by a budget alert. Details below.      |
| No token, account ID or dashboard address            | None appears in this section.                                                |

### DNS records for `browser-compat.dev` (owner-supplied)

The owner read the zone's DNS page on 20 November 2026. Exactly one record exists.

| Name                        | Type   | Content         | Proxy status | TTL  |
| --------------------------- | ------ | --------------- | ------------ | ---- |
| `api`                       | Worker | `bcd-embed-api` | Proxied      | Auto |
| `browser-compat.dev` (apex) | none   |                 |              |      |
| `www`                       | none   |                 |              |      |
| `docs`                      | none   |                 |              |      |

Because the apex and `docs` have no record, no existing record blocks a Workers Custom Domain on either
hostname. The `api` record is for a different name, so it does not interact with them.

The dashboard also showed a recommendation that visitors cannot reach `www.browser-compat.dev`. That is
correct: `www` has no record, so nothing answers it. No issue in the plan covers `www` so far, so the choice
(redirect it to the apex, or leave it unanswered) belongs to the introduction page issue, #211.

### Always Use HTTPS (owner-supplied)

Always Use HTTPS is on for the zone. The dashboard said the setting had changed moments before the screenshot,
so the owner turned it on on 20 November 2026. It was not on before that date.

### Workers usage notification (owner-supplied)

The owner supplied dashboard screenshots on 20 November 2026, so these are the owner's readings, not something
this spike verified through an API. The account offers three ways to hear about Workers usage, and the owner
chose the first.

| Mechanism                          | What the dashboard showed                                                                                                                                                         | What it does at the threshold                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Budget alert (chosen)              | One exists, "Default budget alert (auto-created)", with the event "Billing budget alert" and email delivery. The Billable usage page lists Workers Standard Requests and Workers CPU ms as usage-billed. | Sends email "without blocking usage" (Cloudflare's spend management page).    |
| "Usage Based Billing" notification | The account uses it for three R2 alerts. Whether its product list includes Workers was not checked.                                                                                | Sends a notification when a chosen product's usage passes a chosen threshold. |
| Spend limit                        | Offered for Workers and Durable Objects, marked Beta in the dashboard, with no limit set.                                                                                         | Rejects new Worker invocations, so the API would return error 1103.           |

The owner decided on 20 November 2026 to rely on the budget alert and set no Workers spend limit. A limit would
stop `api.browser-compat.dev`, because that hostname runs Worker code, and the load test (#213, #214) would come
closer to tripping it than real traffic. The documentation site serves its files without running Worker code,
and Cloudflare says such files "continue to be available" under a limit. The budget alert's threshold was not
visible in the screenshots, so its amount is not recorded here.

For scale, usage in the billing period starting 10 November 2026 was 2.62 thousand Workers Standard Requests of
10 million included, and 31.65 thousand Workers CPU milliseconds of 30 million included. Both cost $0.00.

Sources:
- Cloudflare's notification list (<https://developers.cloudflare.com/notifications/notification-available/>)
  names "Usage Based Billing", for Pay-as-you-go accounts on Professional plans or higher.
- Cloudflare's spend management pages (<https://developers.cloudflare.com/billing/manage/spend-management/> and
  <https://developers.cloudflare.com/workers/platform/spend-management/>, both modified 13 November 2026) describe
  spend limits and email alerts.

### Deploy credentials (coordinator-confirmed)

Deploys use an interactive `wrangler login`, which authenticates by OAuth (Open Authorization). The coordinator
confirmed that the local Wrangler configuration holds an OAuth token, a refresh token and its scopes, and that
no `CLOUDFLARE_API_TOKEN` is configured. So no API token exists whose permissions need listing. If a later issue
moves deploys into CI, that issue must work out which permissions a token needs for a Custom Domain.

### Dry run with `routes`, `workers_dev: false` and `preview_urls: false`

`apps/website/wrangler.jsonc` gained three keys, in the same form as `apps/worker/wrangler.jsonc`, which already
uses them:

```jsonc
"routes": [{ "pattern": "docs.browser-compat.dev", "custom_domain": true }],
"workers_dev": false,
"preview_urls": false,
```

The command `pnpm --filter @bcd-embed/website run deploy:dry-run` runs `astro build && wrangler deploy --dry-run`
(the script exists in `apps/website/package.json`). I ran it from `apps/website` as `pnpm run deploy:dry-run`,
which runs the same script. It exited with code 0 on Wrangler 4.160.1. The build wrote 4 pages and the search
index, Wrangler read 129 files from the assets directory, and the output ended with "--dry-run: exiting now."
Nothing deployed, and no Cloudflare call was made.

A dry run does not deploy, and its output never mentions the route. So it shows that Wrangler accepts the three
keys, not that Cloudflare will attach the hostname. The attach happens at the first real deploy, in #193. The
keys stay in the branch because #193 needs them and the dry run passed.

### Content-Security-Policy-Report-Only on a local preview

I served `apps/website/dist` (the dry run's build) with a small local Node server that added
`Content-Security-Policy-Report-Only: default-src 'self'` to every response, then opened three views in
Playwright's headless Chromium shell (build 1254; the build the installed Playwright expects was not
installed, and I did not download one). A report-only policy blocks nothing, so each row is what an enforcing
`default-src 'self'` would block. I counted `securitypolicyviolation` events by the directive that applied
and the blocked address. Chromium reports one event per occurrence, so the counts include repeats.

| View                                       | Inline scripts (`script-src-elem`) | Inline `<style>` elements (`style-src-elem`) | `style=""` attributes (`style-src-attr`) | `data:` images (`img-src`) | Total |
| ------------------------------------------ | ---------------------------------- | -------------------------------------------- | ---------------------------------------- | -------------------------- | ----- |
| Home page (`/`)                            | 10                                 | 13                                           | 356                                      | 1                          | 380   |
| Mermaid page (`/deployment/`)              | 10                                 | 13                                           | 464                                      | 2                          | 489   |
| Search dialog (opened on `/`, query typed) | 10                                 | 13                                           | 356                                      | 6                          | 385   |

Observations that hold in all three views:

- No violation named `connect-src`, `font-src`, `worker-src` or a `blob:` address, and no ordinary console
  error or warning appeared. The search returned 9 results, and `/deployment/` rendered 2 Mermaid diagrams as
  SVG. So `default-src 'self'` would not stop the search index or Mermaid from loading; the violations are all
  inline code and `data:` images.
- The Mermaid page adds 108 `style=""` attribute violations over the home page, which comes from the diagrams'
  generated SVG.
- The search dialog adds 5 `data:` image violations over the home page, from the search interface's icons.

What this means for a policy (my inference, not tested): an enforcing `default-src 'self'` would break the site,
because Starlight's inline scripts and styles would be blocked. A working policy needs `script-src` entries for
those 10 inline scripts (Chromium's messages offered a hash for each), `style-src 'unsafe-inline'` or
equivalent for the `<style>` elements and `style=""` attributes (a hash cannot cover attributes without
`'unsafe-hashes'`), and `img-src 'self' data:`. #193 should send the policy as Report-Only first and test any
enforcing candidate against these same three views before it switches.

### Final report-only policy, three engines (#193)

I measured the policy that `apps/website/public/_headers` sends, not `default-src 'self'` alone. A small Node
server (kept outside the repository) served `apps/website/dist` and added the exact
`Content-Security-Policy-Report-Only` value from that file to every response: `default-src 'self'; script-src
'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`. Playwright 1.65.1 opened three
views in each engine, and an init script counted `securitypolicyviolation` events per effective directive. To
confirm the counter works, I ran Chromium once against `default-src 'self'` alone, which produced 445, 799 and
450 events on the three views.

| Engine (version)          | View                                       | Violation events | Console errors | Console messages naming the policy |
| ------------------------- | ------------------------------------------ | ---------------- | -------------- | ---------------------------------- |
| Chromium 159.0.8154.6     | Home page (`/`)                            | 0                | 0              | 0                                  |
| Chromium 159.0.8154.6     | Mermaid page (`/deployment/`)              | 0                | 0              | 0                                  |
| Chromium 159.0.8154.6     | Search dialog (opened on `/`, query typed) | 0                | 0              | 0                                  |
| Firefox 159.0             | Home page (`/`)                            | 0                | 0              | 0                                  |
| Firefox 159.0             | Mermaid page (`/deployment/`)              | 0                | 0              | 0                                  |
| Firefox 159.0             | Search dialog (opened on `/`, query typed) | 0                | 0              | 0                                  |
| WebKit 27.2 (Playwright)  | Home page (`/`)                            | 0                | 1              | 1                                  |
| WebKit 27.2 (Playwright)  | Mermaid page (`/deployment/`)              | 0                | 1              | 1                                  |
| WebKit 27.2 (Playwright)  | Search dialog (opened on `/`, query typed) | 0                | 2              | 2                                  |

All three engines reported no violation. The `/deployment/` page rendered 2 Mermaid diagrams as SVG in each engine,
and the search dialog opened and accepted the query in each. I did not count the individual search results, so
this run does not show that the results list is correct, only that no violation occurred while it was open.

WebKit's console errors are all one message, which says the policy was delivered in report-only mode but
specifies no `report-uri` or `report-to` directive. That is a note about where reports would go, not a
violation. Firefox and WebKit fired no `securitypolicyviolation` events, and in Firefox and Chromium nothing named
the policy in the console, so for those two engines the zero is a consistent result across both signals. The
browsers were the builds Playwright's `browsers.json` pins for 1.65.1 (Chromium headless shell 1255, Firefox 1572,
WebKit 2388). This is a local run of the built site, so it does not show what the deployed Worker sends.

### Rate-limit probe (run 20 November 2026)

The owner approved the probe on 20 November 2026, and the coordinator ran it from one IP address between
17:14:10 and 17:14:14 UTC. It sent 301 requests to `api.browser-compat.dev`, 40 at a time, then fetched one
more response's headers:

```sh
seq 301 | xargs -P 40 -I{} curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'Origin: https://example.com' https://api.browser-compat.dev/v1/meta.json | sort | uniq -c
curl -sS -D - -o /dev/null -H 'Origin: https://example.com' https://api.browser-compat.dev/v1/meta.json
```

The burst returned 300 `200` responses and one `429`, so the rule still blocks at its threshold of 300 requests
in 10 seconds. A `429` appeared, so the bounded second burst of 400 requests was not needed and was not sent.
The extra request, sent straight after the burst, was also blocked. Its headers, with the reporting endpoint's
signed address left out:

| Header                        | Value                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| Status                        | `HTTP/2 429`                                                                           |
| `content-type`                | `text/plain; charset=UTF-8`                                                            |
| `content-length`              | `17`                                                                                   |
| `retry-after`                 | `10`                                                                                   |
| `cache-control`               | `private, max-age=0, no-store, no-cache, must-revalidate, post-check=0, pre-check=0`   |
| `access-control-allow-origin` | Absent                                                                                 |
| `server`                      | `cloudflare`                                                                           |

Two details differ from Document 9's measurement. The blocked response is now `text/plain` with a 17-byte
body, where Document 9 recorded a `text/html` "Access denied" page. `Retry-After` is now `10`, where Document 9
recorded `9`. The body text was not captured, because the block had ended before anyone thought to read it.

What matters for the component is unchanged: the `429` still carries no `access-control-allow-origin`, so a
browser cannot read its status from another origin. The feature client already relies on this
(the module comment in `packages/element/src/data/feature-client.ts`): it reports such a block
as `reason: "network"` with `status: null`, and keeps that failure for the failure window.

### Rollback for a static-assets Worker

Cloudflare's rollback page (<https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/>)
has no section specific to Workers with static assets. Its general procedure applies: "To roll back to a
specified version of your Worker via Wrangler, use the `wrangler rollback` command." The dashboard route is
Workers & Pages, then the Worker, then Deployments, then the three-dot menu on the version, then Rollback.

The Wrangler command reference (<https://developers.cloudflare.com/workers/wrangler/commands/workers/>) gives
the syntax:

```txt
wrangler rollback [<VERSION_ID>] [OPTIONS]
```

It says `VERSION_ID` is "The ID of the version you wish to roll back to" and that "If not supplied, the
rollback command defaults to the version uploaded before the latest version." It says a rollback "will
immediately create a new deployment with the specified version of your Worker" and that the new deployment
becomes "the active deployment across all your deployed routes and domains." With `--message`, "interactive
prompts for rollback confirmation and message are skipped." The installed Wrangler 4.160.1 lists `--name`,
`--message` (`-m`) and `--yes` (`-y`) in `wrangler rollback --help`, and `wrangler versions list` shows the 10
most recent versions, which is how to find a version ID.

For the documentation site, run from `apps/website` after choosing the version ID:

```sh
pnpm exec wrangler versions list
pnpm exec wrangler rollback <VERSION_ID> --message "<reason>"
```

Three limits from the rollback page matter here. It says "You can only roll back to the 100 most recently
published versions", and that versions older than 30 days can be deleted, after which "you cannot roll back to
a deleted version." For static assets it warns that "Pages loaded before rollback can still request the newer
version's assets", and tells readers to "check whether the older version includes those files", pointing to
Cloudflare's "Version skew and static assets" page. For this site, that means a reader who loaded a page just
before a rollback may request a hashed asset that the older version no longer has. I did not read the version
skew page, so how Cloudflare handles that request is unverified.

### Sources checked

- `apps/website/wrangler.jsonc` and `apps/worker/wrangler.jsonc`, for the key names and their form.
- Cloudflare, [Rollbacks](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/) and
  [Wrangler Workers commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/), fetched on 20 November 2026.
- `wrangler rollback --help`, `wrangler deployments --help` and `wrangler versions --help` from the installed Wrangler 4.160.1.
- `docs/planning/09-custom-domain-and-rate-limits.md`, for the rate limit rule and its earlier measurements.

## Issue #199 — Screen reader walks against the component

**Question.** Do the VoiceOver, Orca and NVDA walks test what ships, and do they cover the cases
the first walk skipped?

**Answer.** They now test what ships, with one gap. The walks load a built page that renders
`<bcd-compat-table>` from the library build, `dist/index.js`. The gap is that variant B has no
counterpart in the element, so steps 13 and 14 are no longer run in CI. The `<bdi>` around each
note, which no screen reader had heard, is settled for NVDA: run 44788533467 read it as the static
page's note. That run also changed two phrases and exposed an Orca bug, listed under "What the
first CI run showed".

### What was measured

On 20 November 2026 a Chromium script compared the element's table with the static page
`phase1-markup/index.html`, element by element and attribute by attribute, ignoring `id` and
`aria-labelledby`, whose values differ by design. The two were identical except for the `<bdi>`
around each note's text and the splitting of each hidden glyph span's text into several text nodes
(for example "✓" and "46" instead of "✓ 46"). That span is `aria-hidden` and `hidden`, so no
screen reader reads either difference. Because of this, every recorded NVDA, VoiceOver and Orca
phrase for the static page applies to the component, and only the note's `<bdi>` is new.

### What the change does

- **One page, built.** `screen-reader/fixtures/component.html` holds the element and a fallback
  paragraph, and `component.ts` assigns `v1NormalizedFixture` to `data`. Vite builds it with
  `vite.screen-reader.config.ts`, and each Playwright config starts `vite preview` on port 5199
  through `webServer`, so the walks hear a production build, not the dev server's modules. The
  workflow builds the page in its own step, so a failed build fails the job. The workflow's path
  filter now names `packages/schema/` (the fixture's source) and no longer names
  `docs/planning/phase1-markup/`.
- **Steps 8 to 12 for VoiceOver and Orca.** `component-steps.ts` performs them with `up`, `left`
  and `activate` moves, in the same route the NVDA walk takes. The expectations are the cell
  sentences from the string table, because no transcript exists.
- **The first cell reads the string table.** `walk-table.ts` builds the sentence from
  `disclosure-summary`, `supported-since` and `disclosure-history`, and checks it for every
  reader, NVDA included.
- **Variant B is gone from CI.** The NVDA walk loses its variant B steps (13 and 14) and the
  `headers-id.html` test.

### A build pitfall: importing the source rendered no table

The first version of the page imported `src/index.ts`, and its build rendered nothing.
`package.json` lists `./dist/index.js` and `./dist/*.css` as the only files with side effects, and
Vite passes that list to Rolldown. `src/index.ts` defines the element and exports nothing the page
uses, so Rolldown dropped the import. The bundle held 104 kB and no element, and no error appeared.
Setting `treeshake.moduleSideEffects: true` left the output byte for byte the same, and a plugin
that forced the side effect fixed it, but that tested a path no consumer takes. The page now
imports `@bcd-embed/element`, which `vite.screen-reader.config.ts` maps to the library build
(`dist/index.js`). That file is in the `sideEffects` list, so the page needs no workaround, and the
walks exercise the path a consumer's bundler takes. `tsconfig.json` maps the same name to the
source, so `tsc` needs no build first. The 142 kB bundle holds the element.

### What the first CI run showed (run 44788533467)

- **VoiceOver passed**, which confirms its checks below. Orca and NVDA failed.
- **Orca.** `orca.act()` said "On-screen speech. read only text" and opened nothing. After it,
  every move said "Not in a table", because Orca had entered Focus mode on the summary. Orca's walk
  now presses Enter, as the shared walk does ("expanded", "collapsed"), and closes each disclosure
  it opens, as the shared walk does for the first one. The retry then failed at the first Tab with
  an empty transcript, which follows from the first attempt leaving Orca in that state. The fix is
  unverified until a new run.
- **NVDA, wording.** The component drops the empty item before a cell's sentence ("column 2, ,
  Supported" is now "column 2, Supported", for the first cell and steps 8 and 9), and
  "from(part of Array)" is now "from (part of Array)". The checks use the new wording and are as
  strict as before. The `<bdi>` note and the heading read as expected.
- **NVDA, lag.** In the first attempt, the moves from "Array" on were empty or one move behind (for
  example "move left to from in Opera" held the speech for the move to `from`). The second attempt,
  with the same route, spoke every step as expected. Main's walk opened the same two disclosures
  and did not close them, so the route is not the cause. I judge it a capture timing fault in one
  attempt. Nothing was changed for it, and no check was loosened. A second occurrence would call for
  a wait after each move.
- **Walk.** The wait for the table now times out after 30 seconds, so a failed render fails there,
  not after the test's ten minutes.

### Expectations that are not recordings

The VoiceOver checks passed in that run. Orca's step 8 text is in its transcript, and Orca did not
reach the cells of steps 9 to 11. A new run confirms or replaces each remaining one.

| Reader      | Step                                                         | Derived from                                                     |
| ----------- | ------------------------------------------------------------ | ---------------------------------------------------------------- |
| VoiceOver, Orca | Step 8, `AudioTrackList` in Chrome                       | The string table: "Supported since Chrome 37 behind a flag"      |
| VoiceOver, Orca | Step 9, `removed_partial` in Chrome                      | The string table: "Supported from Chrome 11.1, then removed in Chrome 12.1" |
| VoiceOver, Orca | Step 10, `missing_target` in Opera and `unknown_runtime` in Node.js | The string table: "No data for Opera" and "Support unknown in Node.js" |
| VoiceOver, Orca | Step 11, `localName` in Opera                            | The string table: "Supported since Opera 12.1 or earlier"        |

Step 12 and the moves between steps have no check for VoiceOver and Orca. Also unrecorded is the
route itself: whether each move lands on the intended cell after a disclosure opens, which only
the transcripts show.

### Not verified

No screen reader ran, because they run only in CI. The checks were verified only for type
correctness (`pnpm --filter @bcd-embed/element typecheck`), and the page for its content in
Chromium: every sentence above is in the built page, the fallback is hidden, there are 14 body
rows and one region, and the first Tab focuses the region. The page imports the library build.

### Sources checked

- `@guidepup/guidepup` 0.39.0 type declarations: `VoiceOver.next`, `previous`, `act` and the
  `moveUp` and `moveDown` key code commands; `Orca.act` and the `MoveUp`, `MoveDown`, `MoveLeft`
  and `MoveRight` commands.
- `vite preview --help` from Vite 8.3.8, for `--config`, `--host`, `--port` and `--strictPort`.
- Vite 8.3.8's `index.d.ts` for `build.rolldownOptions`, and Rolldown 1.2.19's type declarations
  for `moduleSideEffects` and its precedence order.

## Issue #205 — The `source` mode and the order of the script

Status: done on 20 November 2026. #205 builds `source` mode and tests the inference that
Document 3 section 7 drew from #187 section 1: a JSON script written after the element does not
exist when the element's `connectedCallback` runs, if the element was defined before the parser
reached it. The inference is **confirmed**, in Chromium, Firefox, and WebKit (Playwright 1.65.1).

### How the two load orders were tested

Two kinds of page, in `packages/element/e2e/source-mode.e2e.ts`:

| Page                                 | How the element is defined                                                                                          | Script after the element exists at `connectedCallback`? |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Defined after the parser finished    | A `<script type="module">` in `<head>`, which runs after parsing                                                    | Yes                                                     |
| Defined before the parser reaches it | The page loads the definition into an iframe's window first, then streams the markup into it, one chunk at a time   | No                                                      |

The second page needs a stream, because `route.fulfill` in Playwright sends a whole body at once.
The test creates an iframe, calls `document.open()`, and writes one inline classic script that
starts `import()` of the element's source. It waits for that promise, checks that the iframe's
`customElements` holds `bcd-compat-table`, and only then calls `document.write` for the element
and the JSON script, one call per chunk, with `readyState` still `"loading"` after each. The
element is then created already upgraded, and its `connectedCallback` runs when its start tag is
parsed, which is the case #187 section 1 describes.

With the wait for the parser removed, the test "script that comes after the element" times out
and the test "fires nothing while the parser has not reached the script" fails, in Chromium. With
the wait in place, all 30 end-to-end tests pass in all three engines.

### The handling, and why `readystatechange`

When the `id` matches nothing and `document.readyState` is `"loading"`, the element waits for the
document's `readystatechange` event with `readyState` no longer `"loading"`, then reads once. A
`readyState` of `"loading"` means the parser can still add elements. Once it is `"interactive"`,
parsing has ended and a missing `id` will stay missing. The element listens for
`readystatechange` instead of `DOMContentLoaded`, because `readystatechange` fires when parsing
ends, before the deferred scripts run, so a module script that is waiting for the same moment
does not delay the first render of an element that waits. The order is read from MDN's page on `Document.readyState`, not measured: the state becomes `interactive` and `readystatechange` fires, then deferred and module scripts run, then `DOMContentLoaded` fires. How much time that gap holds is unmeasured.

### A pitfall in the stream test

A `<link rel="stylesheet">` in the first chunk keeps the parser from running the inline script
after it until the stylesheet has loaded, so `window.defined` was `undefined`, `await` returned
at once, and the element was not defined before the next chunk. The first chunk therefore links
no stylesheet. The test checks `customElements.get` before writing the element, so a regression
fails loudly instead of testing the wrong order.

### Review follow-up: the cancellation tests were checked by mutation

The first versions of the two "stops waiting" tests passed with `#cancelSourceWait()` deleted,
because a detached element holds its events back and a null `source` hides the element's state.
They now count calls to `Document.prototype.getElementById` after the test ends parsing, which a
leaked listener would make. With the body of `#cancelSourceWait()` replaced by a no-op, both
tests failed in Chromium (6 failures in all, 4 of them the new tests for later fixes); with it
restored, all 69 browser tests pass. The review also found that a wait ignored `data`; setting
`data` now cancels the wait, and a test shows the script is never parsed.

### Other results

- A test document cannot hold a JSON script with `type` absent or `module` made with
  `document.createElement("script")`: it runs the JSON as code when it gets text. The browser
  tests build their scripts through `<template>.innerHTML`, which marks them "already started".
- The element's events bubble but are not composed, so for an element inside a shadow root a
  listener on the document does not hear them. This was already true; the shadow-root test
  listens on the shadow root.

### Measurement

`dist/index.js` without Lit measures 8.69 kB with Brotli after `source` mode, against 8.26 kB
before it (the limit was 8.5 kB, now 9 kB): +0.43 kB for the reader, the parser wait, and the
state it needs.

### Not verified

- A document with a deferred module script and a `source` script after the element, where the
  element is defined by that module (the first page above covers a module script, but not one
  that waits for another).
- `source` when the element is created by a framework while the page is still loading.
- Real Safari and Chrome releases. The results are from Playwright's engine builds.

### Sources checked

- `lib.dom.d.ts` from TypeScript 7.0.2 (`@typescript/typescript-darwin-arm64`): `getElementById`
  on `Document` and `DocumentFragment`, `NonElementParentNode`, `Node.getRootNode`,
  `Document.readyState` and `DocumentReadyState`.
- MDN, `Document.readyState`, for what `loading` and `interactive` mean and the order of `readystatechange`, deferred scripts, and `DOMContentLoaded`.

---

## Issue #206 — Packaging verification: side effects, size budget, and manifest

Measured on 21 November 2026 with Vite 8.3.8, `size-limit` 14.3.0 (`@size-limit/preset-small-lib`), `@custom-elements-manifest/analyzer` 0.11.0, and Playwright 1.65.1 (Chromium) on macOS. Every command ran in `packages/element` unless it names a path from the repository root.

### Summary

| Question                                            | Answer                                                                                   |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Does a consumer build keep the element registered?  | Yes. `customElements.get("bcd-compat-table")` is defined in the built page.              |
| Does a type-only consumer ship Lit?                 | No. The built output holds none of Lit's version markers.                                |
| Does `sideEffects: false` break the consumer?       | Yes. The element stays undefined and the consumer test fails.                            |
| Size of the initial import with Lit, gzip           | 16,676 B (16.68 kB) against 25,000 B.                                                    |
| Size of the renderer alone, gzip, without Lit       | 1,736 B against the 8,000 B threshold. With Lit counted it is 8,098 B (see below).       |
| Decision on a lazy renderer chunk                   | None. The renderer stays a static import.                                                |
| Is the manifest committed and checked?              | Yes. `packages/element/custom-elements.json`, compared with a fresh run by a Vitest test. |

### Size, with the measures side by side

| Entry (`.size-limit.json` options)                            | Bytes  | Reading                                           |
| ------------------------------------------------------------- | ------ | ------------------------------------------------- |
| `dist/index.js`, `gzip: true`                                 | 16,676 | The budget measure: Lit and `@lit/task` counted.  |
| `dist/index.js`, Brotli                                       | 15,100 | The same entry with the preset's default.         |
| `dist/index.js`, `gzip: true`, `ignore: ["lit", "@lit/task"]` | 9,917  | The element's own code with gzip.                 |
| `src/render/table.ts`, `gzip: true`, no `ignore`              | 8,098  | The renderer with Lit counted.                    |
| `src/render/table.ts`, `gzip: true`, `ignore: ["lit"]`        | 1,736  | The renderer alone, the figure for the 8 KB rule. |

`"gzip": true` works as `size-limit/index.d.ts` says: the number changes from the Brotli figure, and the output line reads "minified and gzipped". `size-limit` reads `kB` as 1,000 bytes, so the 25 KB budget is 25,000 B.

**Which figure the renderer rule uses.** Document 3 section 6 says to propose a lazy chunk only if the renderer alone measures more than 8 KB. `src/render/table.ts` imports `lit` for `html` and the `repeat` directive, and its other imports are `render/status.ts` and the message formatter (`render/error.ts` is imported by the shell, not by `table.ts`, so it is not in this measure). "Alone" can therefore mean two things. With Lit counted the renderer measures 8,098 B, which is 98 B over 8,000 B and 94 B under 8,192 B (8 KiB), so a binary reading of "8 KB" puts it under the threshold too. Without Lit it measures 1,736 B. This section uses 1,736 B, for one reason: a lazy chunk moves only code that the shell does not already load, and the shell's `LitElement` base class loads `lit-html` itself. The 6.4 kB difference is shared code, so splitting the renderer out could save about 1.7 kB of the 16.68 kB. The owner can overrule this reading. The decision, the numbers, the 8 KiB point, and the reason that the check fails the build instead of proposing an issue are in Document 3 section 6.

### What is in the bundle

This is a one-off Vite build of the entry with `lit` and `@lit/task` bundled (not external), with a plugin that reads each module's `renderedLength` from the output chunk, which is the data that `rollup-plugin-visualizer` draws. No visualizer package was added, so the repository gained no dependency. The script is not committed.

```text
chunk index.js: 60680 bytes minified, 77330 bytes rendered before minify
  element src        51570 B  66.7%
  lit-html           13200 B  17.1%
  @lit/reactive-element    9146 B  11.8%
  @lit/task           2446 B  3.2%
  lit-element          968 B  1.3%
  element src modules (bytes rendered):
    bcd-compat-table.ts 10371   model/cell.ts 9778          model/note.ts 7444
    strings/en.ts 4921          data/feature-client.ts 3976 render/table.ts 3066
    model/payload-guard.ts 2161 model/table-model.ts 2066   strings/format.ts 1673
    model/targets.ts 1625       render/status.ts 1541       data/request-cache.ts 1433
    data/source-reader.ts 875   render/error.ts 510         index.ts 130
```

The output is one chunk. It holds no `zod` and no `@bcd-embed/schema` code. The three renderer files (`render/table.ts`, `render/status.ts`, `render/error.ts`) add 5.1 kB of the 77.3 kB before minification, and the table model (`model/cell.ts` and `model/note.ts`) is larger than the renderer. If the budget ever needs trimming, the model and the English message table are the larger targets.

### The consumer build test

`packages/element/tests/consumer-build.test.ts` builds the package into `node_modules/@bcd-embed/element/dist` of a temporary project, copies `package.json` there, and links `lit` and `@lit/task` from the package's own `node_modules`. It then builds the project with Vite in `production` mode, serves the result over HTTP, and loads it in Chromium. The consumer therefore follows the package's `exports` and `sideEffects`, and not a path alias.

| Consumer's `main.ts`                                     | Result                                                                                                                                                   |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import "@bcd-embed/element";`                           | `customElements.get("bcd-compat-table")` is defined; the output holds `litHtmlVersions`, `reactiveElementVersions`, and `litElementVersions`; no page error. |
| `import type { BcdCompatTableElement } from "…";`        | The element is undefined; the output holds none of those three markers; no page error.                                                                  |
| `import { en } from "@bcd-embed/element";`               | The element is defined and the output holds the Lit markers (see "What the type-only test can and cannot show").                                          |
| `import "@bcd-embed/element/base.css";`                  | The built CSS holds `@layer bcd-embed.base{` and the package's rules (see "base.css through exports").                                                  |
| `import "@bcd-embed/element";` with `sideEffects: false` | The element is undefined.                                                                                                                                |

Changing `sideEffects` to `false` in the real `packages/element/package.json` and running the test:

```text
$ pnpm exec vitest run --project node packages/element/tests/consumer-build.test.ts
 × defines bcd-compat-table when the built page runs
AssertionError: expected { defined: false, errors: [] } to deeply equal { defined: true, errors: [] }
Tests  1 failed | 2 passed (3)
exit=1
```

After reverting the change: `Tests  3 passed (3)`, exit 0.

### What the consumer test does about three gaps

**`NODE_ENV`.** Vitest sets `NODE_ENV=test`, and Vite fills `NODE_ENV` in only when it is unset, so a build started from a test chose Lit's development build through the `development` export condition. The first version of the test therefore did not build in production. `buildConsumer` now sets `process.env.NODE_ENV = "production"` around the consumer's build and restores it afterwards. Lit's development build logs "Lit is in dev mode. Not recommended for production!" when it loads, and the production build does not contain that text. The first test asserts that the text is absent, and a second test builds with `NODE_ENV=development` and asserts that the text is present, so the first assertion can fail. With the line that sets the variable disabled, the first test failed with `expected '(function(){let e=document.createElem…' not to contain 'Lit is in dev mode'`, exit 1.

**What the type-only test can and cannot show.** `import type` is erased before the bundler resolves anything, so a build of `import type { … } from "@bcd-embed/element"` cannot fail on account of the package; it shows only that a type-only consumer ships no Lit. Two tests make the claim real. One installs the emitted `.d.ts` files beside `dist/index.js`, runs `tsc --noEmit` on a consumer that imports the types through `exports` (with `moduleResolution: "bundler"`), and checks that `document.querySelector("bcd-compat-table")` is typed through `HTMLElementTagNameMap` (a `@ts-expect-error` line fails the compile if the type were `any`). A second compile imports a name that the package does not export and must fail: `error TS2305: Module '"@bcd-embed/element"' has no exported member 'NotExported'`, exit 1. The other test imports a value, `en`: the element is then defined and the output holds the Lit markers, because every value of the entry is in `dist/index.js`, a side-effect file that holds the `customElements.define` call. **No value import of the package avoids Lit**, so the only Lit-free consumer is one that imports types.

**`base.css` through `exports`.** A consumer that imports `@bcd-embed/element/base.css` builds, and the built CSS holds the package's rules. Vite's default CSS minifier, lightningcss, changed the file as issue #246 describes: the output starts with `@layer bcd-embed.base{.bcd-icon-supported{color:var(--lightningcss-light,var(--bcd-color-supported-light))var(--lightningcss-dark,var(--bcd-color-supported-dark))}…`, so the `@layer bcd-embed.base;` statement is gone and each `light-dark()` is lowered. The test therefore asserts on text that survives, `@layer bcd-embed.base{` and `.bcd-render-container`, and not on the statement. This does not contradict #246, which tracks the change.

### Proof that the size check fails

A 30 kB constant of random base64 text (incompressible, so gzip cannot shrink it) was appended to `src/index.ts` as `export const BLOB = "…"`, then `vite build --mode lib` and `size-limit` ran:

```text
$ pnpm exec size-limit
  The initial import with lit and @lit/task, gzip: the 25 kB budget of Document 3 section 6 (…)
  Package size limit has exceeded by 15.07 kB
  Size limit: 25 kB
  Size:       40.07 kB with all dependencies, minified and gzipped
exit=1
```

After `git checkout src/index.ts` and a rebuild: `Size: 16.68 kB`, exit 0. The change was made in the working tree and not committed, so the history holds no commit that adds the constant.

### Custom Elements Manifest

- **Where.** `custom-elements.json` sits beside `package.json` (`outdir: "."` in `custom-elements-manifest.config.mjs`), not in `dist/`, which is not committed. `package.json` lists it in `files` and names it in `customElements`. `packagejson: false` stays, so the analyzer never edits `package.json`. The field is written by hand with the value the analyzer would write (`path.posix.join(outdir, "custom-elements.json")` in `src/utils/cli-helpers.js`).
- **What it holds.** `globs` is now `src/index.ts`, `src/bcd-compat-table.ts`, and `src/public-types.ts`, the last only so that a plugin can read the interface's documentation. The element has six attributes (`query`, `endpoint`, `source`, `loading`, `browsers`, `locale`), seven public properties (those six and `data`, which has `attribute: false`), and two events (`bcd-load` and `bcd-error`, from the `@fires` tags). `src/index.ts` carries the `custom-element-definition` export. With the glob `src/**/*.ts`, which this issue's first commit replaced, the manifest listed 49 declarations from the 15 other modules (counted with `cem analyze --globs "src/**/*.ts"`), such as `buildTableModel` and `createFeatureClient`.
- **Public surface only.** The analyzer 0.11.0 has no option for private members: `exclude` takes file globs, and `@internal` or `@ignore` (read by `hasIgnoreJSDoc` in `src/utils/ast-helpers.js`) would have to tag each private member. A plugin in `custom-elements-manifest.config.mjs` removes the class's members with `privacy: "private"` in `packageLinkPhase`, so an internal refactor no longer changes the manifest: the 29 private members and their initializer source are gone, and the file shrank from 24.6 kB to 13.5 kB. The same plugin copies each description from the JSDoc of the `BcdCompatTableElement` interface in `src/public-types.ts` onto the matching field and attribute, and replaces a type that is exactly an alias name with the alias's definition, so `loading` reads `"lazy" | "eager"` (the order in the source) and not `CompatTableLoading`. Adding a private field `#probe` to the element left `custom-elements-manifest.test.ts` passing (5 of 5).
- **The check.** `tests/custom-elements-manifest.test.ts` runs `cem analyze --outdir <directory> --quiet` and compares the parsed result with the committed file. The analyzer joins `outdir` onto the working directory (`cli.js`, `path.join(cwd, mergedOptions.outdir)`), so the path must be relative to the package. The directory is a new one under the package's own `node_modules/.cache`, which Git ignores, so the relative path stays inside the package and on one drive on every platform. The test runs in `pnpm test`, so `pnpm check` and the CI `check` job run it.
- **Exit code.** A `theme` property was added to `static properties` in `src/bcd-compat-table.ts` without regenerating the manifest:

```text
$ pnpm exec vitest run --project node packages/element/tests/custom-elements-manifest.test.ts
 × equals a fresh run of the analyzer
-               "attribute": "theme",
Tests  1 failed | 3 passed (4)
exit=1
```

After `git checkout src/bcd-compat-table.ts`: exit 0.

### Not verified

- The CI run itself. The checks ran locally. The CI `check` job installs only Chromium's headless shell, which `chromium.launch()` in the consumer test uses by default.
- The consumer test with a bundler other than Vite. Framework fixture pages are #207.
- The contents of `npm pack`. The package is private, and publishing is out of scope.

### Sources checked

- `size-limit/index.d.ts` (14.3.0): the `gzip`, `ignore`, `entry`, and `limit` entry options.
- `@custom-elements-manifest/analyzer/src/utils/cli-helpers.js` (0.11.0): the flag list (`outdir`, `globs`, `litelement`, `packagejson`, `quiet`), the config keys read by `getUserConfig`, and `addCustomElementsPropertyToPackageJson`. `cli.js` for how `outdir` is joined.
- `vite/dist/node/index.d.ts` (8.3.8): the `configFile?: string | false` option of `InlineConfig`, with `root`, `mode`, and `logLevel` as the existing `e2e/global-setup.ts` uses them.
- `playwright-core` 1.65.1 `types/types.d.ts`: the `pageerror` event on `Page`.

---

## Issue #207 — Framework fixture pages: React, Vue, and Svelte

Measured on 21 November 2026 with React 19.3.1, Vue 3.5.45, Svelte 5.57.3, Vite 8.3.8, and Playwright 1.65.1 (Chromium 159.0.8154.6, Firefox 159.0, WebKit 27.2) on macOS. The element ran in the same three engines the Element browser workflow uses. The primary review question, "Does the element receive `data` as a property and report `bcd-load` in React 19.3.1, Vue 3.5.45, and Svelte 5.57.3?", is answered **yes in all three, in all three engines**, with one WebKit exception for Svelte that affects only an element defined after the first render (section 4).

### Summary

| Question                                                                                  | Answer                                                                                                                      |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `element.data` is the object the page passed, and the framework's own `bcd-load` listener ran | Yes, in React (`onbcd-load`), Vue (`@bcd-load`), and Svelte (`onbcd-load`), in dev and production builds, in three engines. |
| A re-render with changed props after the fallback is hidden: no console error, table stays | Yes, in all three. The framework updates the hidden `<p>` in place, and the element never removes or replaces it.            |
| A string child that changes: the render container is restored                              | Yes under real React and real Vue (section 3). Svelte updates a text node and never touches the container.                    |
| React's `data` prop when the element is defined after the render                          | Lost, as #187 found. Vue's `:data` loses it the same way. Svelte's `data` keeps it, except in WebKit 27.2 (section 4). A `ref` callback or `:data.prop` keeps it. |
| Did the element need a change?                                                             | No. The only source change is outside the element: test configuration and fixtures.                                           |

### How it was tested

Each framework has one page in `packages/element/e2e/frameworks/<name>/`, built with Vite. The query string selects a scenario (`define=before|after`, `binding=plain|robust`, `fallback=element|string`, `state=raw|deep`; `e2e/frameworks/shared.ts`). Each page has three buttons: "Re-render" changes the `browsers` prop and the fallback text, "Break data" passes an object the element rejects, and "Restore data" passes the payload again. The page records every event its framework's own listener syntax receives in `window.bcdPage`, so a passing test shows that the framework wired the listener.

`e2e/frameworks.e2e.ts` runs 7 tests against each framework and each of two builds, except that Svelte skips the "robust binding" test, because its page has one binding and the "ordinary binding" test covers it. It adds one test for the two reactive-state proxies (Vue and Svelte) and one for the WebKit bug: 43 tests an engine, 129 in all. Each page records `customElements.get("bcd-compat-table") === undefined` right after its first render (`window.bcdPage.undefinedAtFirstRender`), and every define-after test asserts it is `true`, so a page that defined the element too early cannot pass as a define-after page. The first test asserts it is `false`.

```text
                         ┌── Vite dev server, port 5199 ───── element source, framework dev builds
 Playwright (3 engines) ─┤
                         └── static server, port 5200 ─────── `dist/index.js` bundled in production mode
                              (reads the output of e2e/global-setup.ts on each request)
```

The production pages bundle `dist/index.js`, the file `vite build --mode lib` writes and a consumer's bundler reads through `exports`, with `NODE_ENV` forced to `production`. The #206 consumer test installed the package into a temporary `node_modules` for the same reason. This test did not, because the package directory already holds `dist/` and the `exports` map, and an alias to `dist/index.js` reads the same file; a difference between the two paths is therefore not covered. A test checks that Lit's development warning ("Lit is in dev mode") appears on the dev pages and never on the production pages, so a page cannot silently test the wrong build.

The static server exists because Playwright starts web servers before it runs the global setup, and `vite preview` refuses to start without its output directory. The static server reads from disk on each request and answers once the global setup has written the build.

### 1. How each framework sets `data`

The tests passed in all three engines with the element defined before the first render. The load-order table below shows the page with the element defined after the first render.

| Framework | Binding                       | Element defined first | Element defined after the first render                                          |
| --------- | ----------------------------- | --------------------- | ------------------------------------------------------------------------------- |
| React     | `data={x}`                    | property              | attribute `data="[object Object]"`, payload lost; next value arrives as property |
| React     | `ref` callback                | property              | property                                                                        |
| Vue       | `:data="x"`                   | property              | attribute `data="[object Object]"`, payload lost; next value arrives as property |
| Vue       | `:data.prop="x"`              | property              | property                                                                        |
| Svelte    | `{data}`                      | property              | property (an object is set as a property while the element is undefined)        |

The "after" rows were tested with the page rendering first (`flushSync(() => root.render(...))` in React, `mount` in Vue, `mount` then `flushSync` in Svelte) and then defining the element through a dynamic import. The lost-payload case was checked after the upgrade: `element.data` is `null`, because the element's constructor sets it (Document 3 section 8 said `undefined`, from the spike's stand-in element, and now says `null`), and the table does not render. The tests then press "Break data" and "Restore data", and the table renders from the property the framework now sets.

### 2. Events

React: `onbcd-load` and `onbcd-error` as props. `setPropOnCustomElement` in `react-dom-client.development.js` reads a key that begins with `on` as a listener for the event named by the rest of the key, with no case change. Vue: `@bcd-load` compiles to the prop `onBcdLoad` (`toHandlerKey(camelize(rawName))` in `compiler-core`), and `parseName` in `runtime-dom` hyphenates it back to `bcd-load`. Svelte: `onbcd-load={handler}`; `visit_event_attribute` takes the name after `on`, so the listener is for `bcd-load`. All three received `{ mode: "data", snapshot: null }` for `bcd-load`, and `{ mode: "data", reason: "invalid-payload", status: null, code: null }` for `bcd-error`. The events bubble and are not composed, as before.

### 3. Re-render, the author's children, and the render container

After the table loaded, "Re-render" changed `browsers` and the text of the hidden `<p>`. In all three frameworks and both builds the table gained the new column, the `<p>` was the same node with the new text and still hidden, one render container existed, no `bcd-load` fired again (a changed `browsers` is not a new payload), and no console error or uncaught exception appeared.

For a bare string child, the test checks that the element ends with one container, the table inside it, the same row count, and the new text node. **Mutation check:** with the line that starts the `MutationObserver` (`this.#containerGuard.observe(this, { childList: true })`) removed, the test failed for React and Vue in Chromium, and passed for Svelte, which updates a text node and never assigns `textContent`. Vue passed at first, because the page wrote the string inside `v-else`, where Vue did not assign `textContent`. The page now has a copy of the element whose only child is the text, which Vue sets with `el.textContent` (`setElementText` in `runtime-dom`), and that copy fails without the observer.

### 4. A WebKit bug that hides the element from `customElements.define`

In WebKit 27.2 the Svelte production page with the element defined after the first render never showed the table: `element.matches(":defined")` stayed false, even after `customElements.upgrade(element)`. Chromium, Firefox, and the Svelte dev page in WebKit were fine. A bisection found the cause with no framework and no Lit (macOS WebKit 27.2; not checked on Linux):

```js
const template = document.createElement("template");
template.innerHTML = "<main><x-a></x-a></main>";
const copy = document.importNode(template.content.firstChild, true);
document.body.append(copy);
customElements.define("x-a", class extends HTMLElement {}); // first read of window.customElements
copy.firstChild.matches(":defined"); // false in WebKit 27.2; true when anything read customElements earlier
```

Svelte 5 builds markup with `document.importNode` when a template holds a custom element (`needs_import_node` in `RegularElement.js`), and its production page reads `customElements` only after the markup exists. Svelte's dev server hides the bug, because Vite's client script reads `customElements` first. The page that defines the element first (the recommended order) works in WebKit, which fits the reproduction. `document.createElement` and an early read of `customElements` both avoid it. The cause inside WebKit is not traced.

The Svelte production test and the plain reproduction assert the bug instead of using `test.fail`, because `test.fail` passes on any failure and would hide an unrelated break in the same test. The Svelte test asserts that the element is not `:defined`, the fallback is visible, and no table exists; the plain test expects an upgrade everywhere except WebKit. Each test turns red when a WebKit release fixes the bug, which is the moment to remove the WebKit branch. A check that the Svelte test can fail: with the Svelte page changed to define the element before it renders, the WebKit production test failed on `undefinedAtFirstRender` (expected `true`, received `false`). The change was reverted.

**The dev build depends on Vite's dev client.** The Svelte dev page passes in WebKit only because Vite's client script defines `vite-error-overlay` first, which reads `customElements` before Svelte mounts. A Vite change could remove that read. A future WebKit failure of the Svelte dev tests with an element that is not `:defined` points at this cause, not at the element. The comment above the tests says so.

**Platform.** The bug was observed on macOS WebKit 27.2 (Playwright 1.65.1) only. The Element browser workflow runs Linux WebKit, so the first CI run may differ in either direction: a Linux build that upgrades the element turns the Svelte production test and the plain reproduction red.

### 5. Deeply reactive state

In Vue, `ref(payload)` makes the object deeply reactive, so the template passes a `Proxy`. In Svelte, `$state(payload)` does the same. In both, `element.data` was not the object the page passed, and the table still rendered once with one `bcd-load`. The README tells authors to use `shallowRef` or `markRaw` in Vue and `$state.raw` in Svelte. React has no equivalent.

### Dependencies

All are `devDependencies` of `packages/element`, with exact versions. Nothing was added to the element's `dependencies`. `pnpm-workspace.yaml` sets no `minimumReleaseAge`, so pnpm's default of 1,440 minutes (one day) applies (pnpm.io, "Supply chain security"). Every new version was at least nine days old on 21 November 2026, so `minimumReleaseAgeExclude` needed no entry. `pnpm add` printed "Lockfile passes supply-chain policies".

| Package                          | Version | Published (npm `time`)    |
| -------------------------------- | ------- | ------------------------- |
| `react`, `react-dom`             | 19.3.1  | 2026-10-14                |
| `vue`                            | 3.5.45  | 2026-11-05                |
| `svelte`                         | 5.57.3  | 2026-10-26                |
| `@vitejs/plugin-react`           | 6.3.0   | 2026-11-09                |
| `@vitejs/plugin-vue`             | 6.0.11  | 2026-11-12                |
| `@sveltejs/vite-plugin-svelte`   | 7.3.1   | 2026-09-23                |
| `@types/react`, `@types/react-dom` | 19.3.0 | 2026-09-09                |

The issue's pins for React, Vue, and Svelte were installed as written. Vue 3.5.46 (20 November 2026) and Svelte 5.59.1 (20 November 2026) exist; the issue fixes the older pins.

### Cost

`pnpm check` does not run these tests, because Playwright Test files are outside `vitest run`, so `pnpm check` gains no test time. Its type check and build gain the fixture pages' TypeScript and the extra build in `e2e/global-setup.ts` runs only under `test:e2e`. The full `test:e2e` run, three engines and every e2e file, took 54 seconds on this machine (load from other agents' work was present), 37 of them for the framework tests alone.

### Not verified

- The CI run of the `element-browser` job.
- Real Safari, Chrome, and Firefox releases. The results are from Playwright's engine builds.
- React in strict mode, server rendering, hydration, and the `ref` callback with a memoised function (#187 section 5 noted the caveat).
- The `.vue` and `.svelte` files' types. `tsc` reads neither, so the shims in `e2e/frameworks/shims.d.ts` stand in and the pages are compiled and run only.
- Other bundlers than Vite, other versions of the three frameworks, and Vue's and Svelte's own custom-element output.

### Sources checked

- `react-dom/cjs/react-dom-client.development.js` (19.3.1), `setPropOnCustomElement`: how `ref`, `children`, `on…` keys, and other keys are applied to a custom element.
- `@vue/runtime-dom` (3.5.45), `shouldSetAsProp`, `patchProp` (the `.` and `^` prefixes), and `parseName`; `@vue/compiler-core` (3.5.45), the `prop` modifier and `toHandlerKey(camelize(rawName))`; `@vitejs/plugin-vue` 6.0.11 `README.md` and `index.d.mts` for the `template` option.
- `svelte` 5.57.3 `src/internal/client/dom/elements/attributes.js` (`set_custom_element_data`), `src/internal/client/dom/template.js` (`from_html`, `document.importNode`), and `src/compiler/phases/3-transform/client/visitors/shared/events.js` (`visit_event_attribute`), plus the compiler's output for the page.
- `@vitejs/plugin-react` 6.3.0 `README.md` and peer metadata (`npm view`); `@sveltejs/vite-plugin-svelte` 7.3.1 `types/index.d.ts` (the `svelte` export).
- pnpm.io, "Supply chain security", for the default of `minimumReleaseAge`.
