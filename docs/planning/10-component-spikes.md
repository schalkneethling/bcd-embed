# Document 10 — Component spikes

This document records the results of the time-boxed spikes that test the assumptions behind
Document 3 (`03-web-component-architecture.md`) before Phase 2 of the component starts. Each
spike has its own section, titled with its issue number and subject. A section states the
versions it tested, how it tested them, and whether each assumption was confirmed. Findings that
contradict Document 3 are listed at the end of each section, so the Document 3 amendment (issue
#192) can pick them up.

## Issue #187 — Lit behaviours the light-DOM design depends on

Status: done on 18 November 2026. Every question below has a running test in three browser
engines, and two findings contradict Document 3 as written (see "Findings for the Document 3
amendment").

### Summary

| Question                                                         | Result                            |
| ---------------------------------------------------------------- | --------------------------------- |
| `createRenderRoot()` returning an appended `<div>`               | Confirmed in all three engines    |
| A `<slot>` in a light-DOM template projects nothing              | Confirmed, with a caveat          |
| React re-renders after the element toggled `hidden` on children  | Confirmed, with a caveat          |
| React re-renders after the element removed children (contrast)   | Fails: error, and React unmounts  |
| `declare` field in `static properties` renders again when set    | Confirmed                         |
| React 19 sets `data` as a property                               | Not confirmed as Document 3 says  |
| `@lit/task` 1.0.3 constructor options                            | Listed from the type definitions  |
| `<bcd-compat-table>` directly inside `<table>`                   | The parser moves it out           |
| A second `connectedCallback` creates a second render container   | It does not                       |

### What was tested, and how

The spike code lives on the `issue-187-lit-spike` branch in `packages/element/spike/`. None of it
ships: the branch is not merged, only this document is. It holds four small Lit elements
(`spike-elements.ts`), four test pages, and four Playwright test files in
`spike/tests/`.

Every test runs six times: in Chromium, Firefox, and WebKit, and in each engine once
against the Vite dev server and once against a production build served by `vite preview`. The
two servers matter because Lit and React ship different development and production builds, and
one finding (class fields) behaves differently between them.

```
                    ┌── Vite dev server ──── Lit and React development builds
spike/*.html ──────┤
                    └── vite build + preview ─ Lit and React production builds
                              │
            each served page runs in Chromium, Firefox, and WebKit
```

To run the tests, install the browsers once and then run the spike script:

```sh
pnpm --filter @bcd-embed/element exec playwright install chromium firefox webkit
pnpm --filter @bcd-embed/element test:spike
```

The second command was run on 18 November 2026 and reported `66 passed`.

#### Versions

| Package or engine         | Version                                            |
| ------------------------- | -------------------------------------------------- |
| `lit`                     | 3.3.3                                              |
| `lit-element`             | 4.2.2 (installed by `lit` 3.3.3)                   |
| `@lit/reactive-element`   | 2.1.2 (installed by `lit` 3.3.3)                   |
| `lit-html`                | 3.3.3 (installed by `lit` 3.3.3)                   |
| `@lit/task`               | 1.0.3                                              |
| `react`, `react-dom`      | 19.3.1                                             |
| `typescript`              | 7.0.2 (root `package.json`)                        |
| `vite`                    | 8.3.8                                              |
| `@playwright/test`        | 1.65.0                                             |
| Chromium                  | 158.0.8127.18 (Playwright build 1254)              |
| Firefox                   | 159.0 (Playwright build 1572)                      |
| WebKit                    | 27.2 (Playwright build 2388)                       |

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
  this.append(container); // after the author's children
  return container;       // Lit renders the template into this, and only this
}
```

After the first render, the element has no shadow root, its children are in the order
`p#author-a`, `a#author-b`, `div[data-render-container]`, the template output is inside the
`<div>` only, and the `outerHTML` of both author children is byte-for-byte what the page
contained. Test: `spike/tests/light-dom.spike.ts`, "renders the template inside the appended
`<div>`…".

Why it works, from the installed source: `LitElement.update()` calls
`render(value, this.renderRoot, this.renderOptions)`
(`lit-element/development/lit-element.js`, line 129), and `renderRoot` is whatever
`createRenderRoot()` returned. The override does not call `super.createRenderRoot()`, so no
shadow root is attached (`@lit/reactive-element/development/reactive-element.js`, lines
564–568).

That same source shows a consequence the spike did not exercise with running code:
`ReactiveElement.createRenderRoot()` is also where Lit adopts `static styles`
(`adoptStyles(renderRoot, …)`, line 567). An override that skips `super` therefore never applies
`static styles`. This is consistent with Document 3 §3, which delivers base styles as an
ordinary stylesheet in a cascade layer, but Phase 2 must not reach for `static styles`.

### 2. A `<slot>` in a light-DOM template

**Confirmed, with a caveat**, in all three engines and both builds.

The spike element renders `<slot>slot fallback text</slot>` into its render container, and the
author gives it one child, `p#slot-author`. The slot projects nothing: `assignedNodes()` and
`assignedNodes({ flatten: true })` both return an empty list, the author's child has
`assignedSlot === null`, and it stays a direct child of the host. Test:
`spike/tests/light-dom.spike.ts`, "a `<slot>` in a light-DOM template projects nothing".

The caveat is that the slot still renders its own content. Outside a shadow tree the slot is
an ordinary element with `display: contents` (measured with `getComputedStyle`), so its fallback
text appears on the page next to the author's child, which also still renders where it was.

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

React rendered the author's children, then the element hid (or removed) them when `data`
arrived, then React re-rendered with changed props. The test page drives four steps through
`flushSync`, so each step's effect is in the DOM before the next one starts.

1. React renders `<bcd-spike-table>` with a `<p>` and an `<a>` as children, and no `data`.
2. React renders again with `data`. The element's `updated()` hides (or removes) every child
   except its render container.
3. React renders again with new `<p>` text and without the `<a>`.
4. React renders again with the `<a>` back.

Test: `spike/tests/react.spike.ts`, "React re-renders after the element hid its children" and
"…removed its children".

#### Hiding the children with `hidden`

**Confirmed, with a caveat**, in all three engines and both builds. No console error and no
uncaught error appear in any step. In step 3, React updates the text of the hidden `<p>` in
place (it stays hidden and stays a child of the element) and removes the `<a>`.

The caveat appears in step 4. React inserts the returning `<a>` as a new node, and in all three
engines it lands after the render container, as the last child of the element. (The spike
observed this position; it did not trace which React code path chooses it.) The `<a>` is also
visible, because the element hid only the children that existed when `data` changed.

```
after step 2:  p[hidden]  a[hidden]  div[data-render-container]
after step 3:  p[hidden]             div[data-render-container]
after step 4:  p[hidden]             div[data-render-container]  a     ← visible, after the table
```

#### Removing the children (contrast)

**Fails** in all three engines and both builds. In step 3, React calls `removeChild` to drop the
`<a>`, which the element already removed, and the browser throws (`NotFoundError` in Chromium and
WebKit, "Node.removeChild: The node to be removed is not a child of this node" in Firefox). The
error does not reach the code that called `flushSync`; it surfaces as an uncaught page error,
and React then unmounts the whole root, so the element itself disappears from the page. The next
render mounts a brand-new element from scratch.

This confirms that hiding, not removing, is the only safe way to retire fallback content under a
framework that owns the children.

### 4. `declare` properties in `static properties`, under TypeScript 7 and Vite 8

**Confirmed** in all three engines and both builds.

The element declares `data`, `label`, and `fallbackMode` in `static properties`, types them with
`declare`, and assigns defaults in the constructor. The element has no own `label` property, and
setting `label` triggers exactly one more render with the new value. Test:
`spike/tests/light-dom.spike.ts`, "a `declare` property with a constructor default renders again
when it is set". TypeScript 7.0.2 type-checks the pattern with the root `tsconfig.json`
(`pnpm --filter @bcd-embed/element typecheck`, which extends the root configuration).

The contrast shows what `declare` protects against. A second element writes the same property as
an ordinary field, `label = "default label"`. The root `tsconfig.json` sets `target: "ESNext"` and
does not set `useDefineForClassFields`, and Vite 8.3.8's Oxc transform keeps the field as a
native class field: the module the dev server serves contains `label = "default label";` inside
the class body, while the `declare` fields produce no output at all. The native field becomes an
own property that hides Lit's accessor on the prototype.

| Build       | What happens with the plain field                                          |
| ----------- | -------------------------------------------------------------------------- |
| Development | Lit throws on the first update ("…set using class fields: label…") and renders nothing |
| Production  | Lit renders the default once, then ignores every later change, with no error |

Test: `spike/tests/class-fields.spike.ts`. The development-build error comes from
`@lit/reactive-element/development/reactive-element.js`, lines 843–855. The production build has
no such check, which is why the failure there is silent.

### 5. React 19 setting `data` on the element

**Not confirmed as Document 3 §8 words it.** Document 3 says React 19 passes "non-primitive values
as properties, primitives as attributes". React 19.3.1 does not look at the value's type. It sets
a property when the key already exists on the element (`key in domElement`) at the moment React
applies the prop, and an attribute otherwise
(`react-dom/cjs/react-dom-client.development.js`, line 22174; the production build has the same
check at line 14793).

That makes the result depend on whether the element is defined before React renders it. The
test page renders `createElement("bcd-spike-table", { data })`, which is what the JSX
`<bcd-compat-table data={obj}>` compiles to.

| When the element is defined           | What React does with `data`                                   |
| ------------------------------------- | ------------------------------------------------------------- |
| Before React renders it               | Sets the property; `el.data` is the same object               |
| After React renders it                | Sets the attribute `data="[object Object]"`; after the upgrade `el.data` is `undefined` |
| After, then React renders a new value | Sets the property, because the accessor now exists            |
| After, with a `ref` callback          | The callback sets the property; Lit keeps it through the upgrade |

The second row loses the data, because `data` is declared with `attribute: false`, so Lit never
reads the attribute. The fourth row works because Lit saves own properties that were set before
the upgrade and applies them again (`__saveInstanceProperties`,
`@lit/reactive-element/development/reactive-element.js`, lines 541–554). Tests:
`spike/tests/react.spike.ts`, the three tests whose titles start with "React 19 sets `data`" and
"a ref callback".

So the form that works for every load order is a `ref` callback that assigns `data`; the plain
`data={obj}` prop works only when the element's module has run before React renders.

### 6. `@lit/task` 1.0.3 constructor options

Read from `node_modules/@lit/task/task.d.ts` in the installed `@lit/task` 1.0.3. The class has two
constructor overloads (lines 164–165):

```ts
constructor(host: ReactiveControllerHost, task: TaskConfig<T, R>);
constructor(host: ReactiveControllerHost, task: TaskFunction<T, R>, args?: ArgsFunction<T>);
```

The `TaskConfig<T, R>` options (lines 29–73):

| Option         | Type                                                      | Line |
| -------------- | --------------------------------------------------------- | ---- |
| `task`         | `TaskFunction<T, R>` (required)                           | 30   |
| `args`         | `ArgsFunction<T>`                                         | 31   |
| `autoRun`      | `boolean \| 'afterUpdate'`; defaults to `true`            | 53   |
| `argsEqual`    | `(oldArgs: T, newArgs: T) => boolean`; defaults to `shallowArrayEquals` | 61 |
| `initialValue` | `R`; starts the task in the `COMPLETE` status             | 70   |
| `onComplete`   | `(value: R) => unknown`                                   | 71   |
| `onError`      | `(error: unknown) => unknown`                             | 72   |

The task function receives `(args, { signal })`, where `signal` is an `AbortSignal`
(`TaskFunctionOptions`, lines 2–4), and may return `initialState` to reset the task to
`INITIAL`. These options were read from the type definitions only; the spike did not run a
`Task`.

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
`<table>` (the HTML standard calls this foster parenting). Its own `<p>` child moves with it, and
the `<tr>` stays in the table. The control case, the element inside a `<td>`, stays in the cell.
Test: `spike/tests/table-parse.spike.ts`.

### 8. Removing the element and adding it again

**No second render container is created** in any engine or build. After `remove()` and
`append()`, the element still has exactly one `div[data-render-container]`, `createRenderRoot()`
has run once, and a property change after reconnection renders into that same container. Test:
`spike/tests/light-dom.spike.ts`, "removing and re-adding the element…".

The reason is in `ReactiveElement.connectedCallback()`: `this.renderRoot ??= this.createRenderRoot()`
(`@lit/reactive-element/development/reactive-element.js`, lines 575–578). The render root is
created only when none exists yet. Phase 2 keeps this property only if the container is created
in `createRenderRoot()`; creating it in `connectedCallback()` instead would add a new one on every
reconnection.

### Not verified

- What happens if something other than Lit (an author script, or a framework) removes the render
  container. Lit would keep rendering into the detached `<div>`; the spike did not test this.
- `static styles` not being applied with the overridden `createRenderRoot()` comes from reading
  the source (section 1), not from a running test.
- Real Safari and Chrome releases. The results are from Playwright's engine builds listed above.
- React's server rendering and hydration of the element. The spike tested client rendering only.

### Findings for the Document 3 amendment (#192)

These contradict Document 3 as written, or add a rule it does not state yet.

1. **§8 misstates React 19's rule.** React 19.3.1 sets a property only when the key already
   exists on the element, not when the value is non-primitive. If the element is not defined
   before React renders it, `data` becomes the attribute `"[object Object]"` and the payload is
   lost. Document 3 should say that the element's module must run before React renders it, or
   recommend a `ref` callback, which works in every load order (section 5).
2. **`hidden` toggling needs a rule for children added later.** Toggling `hidden` on each child
   works with React (no errors, children stay in place), but it is a one-time snapshot: a child
   React adds after `data` arrives is visible and appears after the table (section 3). Document 3
   should choose a mechanism that also covers later children, for example a state attribute on
   the host with a base-style rule that hides its non-container children, and should state that
   the element never removes author children, because removal makes React throw and unmount
   (section 3).
3. **The light-DOM render root rules out `static styles`.** Overriding `createRenderRoot()`
   without calling `super` skips Lit's style adoption, so base styles must stay an ordinary
   stylesheet, as §3 already plans (section 1; source-read only).
4. **`declare` is required, not optional.** Document 3 should state that every reactive property
   is a `declare` field with its default in the constructor, because a plain field breaks updates
   silently in production builds under the root `tsconfig.json` (section 4).
5. **Placement inside a table.** The author documentation should say the element cannot sit
   directly inside `<table>`, `<tbody>`, or `<tr>`; the parser moves it before the table. Inside a
   cell it is fine (section 7).

The `static properties` and light-DOM assumptions themselves held: none of the tests found a
reason to change them.
