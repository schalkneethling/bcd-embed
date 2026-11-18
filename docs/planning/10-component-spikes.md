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
