---
title: Data modes
description: The three ways bcd-compat-table gets its data, where the element may be placed, and how to embed data safely.
---

`<bcd-compat-table>` gets its data in one of three ways. Fetch mode requests
it from the application programming interface (API) while the page runs. Data mode and source mode render data
that a build step saved earlier, so they send no request. All three render
the same table and fire the same [events](/component/events/), with a `mode`
that names the way the data arrived.

| Mode   | Input    | Request | Needs a script of the page's own                |
| ------ | -------- | ------- | ----------------------------------------------- |
| Fetch  | `query`  | Yes     | No                                              |
| Data   | `data`   | No      | Yes, to assign the property                     |
| Source | `source` | No      | No: the page holds the data in a script element |

Source mode holds the data as JavaScript Object Notation (JSON) in a
`<script>` element of the page. When more than one input is set, `data` wins, then `source`, then
`query`.

## Where the element may go

Do not write `<bcd-compat-table>` directly inside `<table>`, `<thead>`,
`<tbody>`, `<tfoot>`, or `<tr>`. The HyperText Markup Language (HTML) parser
moves an unknown element out of a table, to just before it, together with its
children. The project saw this in Chromium, Firefox, and WebKit with no script
on the page. Inside a `<td>` the element stays where it was written. The same
parsing rules apply to markup set through `innerHTML`, but not to an element that a
script inserts with `appendChild`.

## Fetch mode

Set `query` to the key of a feature in MDN Browser Compatibility Data (BCD),
such as `css.properties.display`, and the element requests
`{endpoint}/v1/current/features/{query}.json` from the API. The
[getting-started page](/component/getting-started/) shows it with a live
example. A lazy element, the default, sends its request once it is within 400
pixels of the viewport.

All elements on a page share one feature client, so fifty elements with the
same `query` send one request. The client keeps each successful answer for the
life of the page. A new `query` or `endpoint` while a request is pending starts
the new request, and the old answer neither renders nor fires an event.

A lazy element waits for an `IntersectionObserver`, which only reports on an
element that has a box. Inside a host styled `display: none` or
`display: contents`, a lazy element never sends its request, so use
`loading="eager"` there. The 400-pixel margin applies to the viewport, not to
a scrolling ancestor: inside a box with `overflow: auto`, the request starts
only when the element scrolls into view within that box.

## Data mode

Assign a feature response to the `data` property, and the element renders it
with no request. The data usually comes from a build step that saved the API's
answer. The element can be in the page before the script runs:

<!-- sample: packages/element/examples/data-mode.html -->

```html
<bcd-compat-table id="display" browsers="chrome firefox safari">
  <p>
    <a href="https://developer.mozilla.org/en-US/docs/Web/CSS/display#browser_compatibility"
      >Browser compatibility for <code>display</code> on MDN Web Docs</a
    >
  </p>
</bcd-compat-table>
```

<!-- sample: packages/element/examples/data-mode.js -->

```js
import "@schalkneethling/bcd-embed";

// `payload` is a feature response that the page's build step fetched from the API and kept, such
// as the body of https://api.browser-compat.dev/v1/current/features/css.properties.display.json.
export const showTable = (payload) => {
  const table = document.querySelector("#display");
  table.data = payload;
};
```

The element reads the object when it is assigned. To show new data, assign a
new object; a change made inside the same object is not seen. Assigning `null`
removes the table and shows the fallback content again. A value that is not a
feature response fires `bcd-error` with the reason `invalid-payload`.

## Source mode

Source mode needs no script of the page's own. The page holds the data in a
`<script type="application/json">`, and the element's `source` attribute names
the script's `id`. A static site generator only has to write two fragments of
plain HTML. This example writes them at build time:

<!-- sample: packages/element/examples/source-mode.js -->

```js
/** Writes a payload as script text that the HTML parser cannot end early. */
export const toScriptJson = (payload) => JSON.stringify(payload).replaceAll("<", "\\u003c");

/** The `id` convention: `bcd-data-` and the query, with each dot written as a dash. */
export const scriptIdFor = (query) => `bcd-data-${query.replaceAll(".", "-")}`;

export const sourceModeHtml = (payload, fallbackHtml) => {
  const id = scriptIdFor(payload.query);
  return [
    `<script type="application/json" id="${id}">${toScriptJson(payload)}</script>`,
    `<bcd-compat-table source="${id}">${fallbackHtml}</bcd-compat-table>`,
  ].join("\n");
};
```

For `css.properties.display`, the script's `id` is
`bcd-data-css-properties-display`. The element enforces no naming, but the
convention keeps several tables on one page from sharing an `id`.

### Escape every `<` in the JSON

The generator must replace every `<` in the JSON with the six characters
`\u003c` (a backslash, `u`, `0`, `0`, `3`, `c`), as `toScriptJson` does.
`JSON.parse` turns `\u003c` back into `<`, so
every note arrives unchanged.

Escaping only a closing script tag is not enough, because the HTML parser
decides where a script ends before the element sees any text. Two sequences in
a BCD note can end the script too early, or make the rest of the page part of
the script:

- A closing script tag, `</script>`, ends the script at the note. The rest of
  the JSON becomes text on the page, and the element reports
  `source-invalid-json`.
- The sequence `<!--<script>` moves the parser into its "script data double
  escaped" state (HTML Standard, section 13.2.5), where the next `</script>`
  no longer ends the script. The rest of the page, the element included,
  becomes part of the script.

Escaping every `<` removes both cases. The element cannot repair JSON that the
parser has already cut.

### What the element reads, and when

The element looks the `id` up in its own tree: the shadow root that holds it,
or else the document. It accepts one kind of target, an HTML `<script>` whose
`type` is `application/json`, and passes the script's text to `JSON.parse`, so
nothing in it runs. Anything else with that `id`, such as a `<div>`, gives
`source-missing`.

A script before the element, in the same tree and with no earlier element that
has the same `id`, always works. A script after the element works
while the page is still being parsed: the element waits for the end of
parsing, shows nothing, and fires no event until then. A script that inserts
both fragments into a page that has finished loading must insert the JSON
script first.

The element reads the script once for each `id`. Editing or removing the
script afterwards changes nothing. To show new data, give it a new script with
a new `id` and set `source` to that `id`, or remove the `source` attribute,
let the element update, and set it again.
