---
title: Attributes and properties
description: Every input that the bcd-compat-table element reads, and the order in which it reads them.
---

`<bcd-compat-table>` reads seven inputs. Six are attributes that also exist as
properties of the same name, and one, `data`, is a property only. The element
needs exactly one source of data: `data`, `source`, or `query`. The data is a
feature response from the bcd-embed application programming interface (API),
which describes a feature of MDN Browser Compatibility Data (BCD).

## The inputs

| Name       | Kind                   | What it does                                                                                                                                                                                                                                                                                                                                   |
| ---------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data`     | Property only          | A feature response from the API contract, version 1.x. Assigning one renders the table with no request. `null`, the default, removes the table. The element reads the object when it is assigned, so assign a new object to show new data; a change made inside the same object is not seen.                                                   |
| `source`   | Attribute and property | The `id` of a `<script type="application/json">` that holds a feature response. The element reads the script once for each `id` and sends no request. When `source` is set, the element never requests `query`, even when the read fails. [Data modes](/component/data-modes/) covers it.                                                      |
| `query`    | Attribute and property | The BCD key to request, such as `css.properties.display`. Changing it requests the new key, and removing it removes the table. A key that does not match the pattern of BCD keys sends no request and fires `bcd-error` with the reason `invalid-query`.                                                                                       |
| `endpoint` | Attribute and property | The base URL of the API. The default is `https://api.browser-compat.dev`. It must be an absolute `https:` or `http:` URL with no query string, fragment, or credentials. [Self-hosting](/component/self-hosting/) covers it.                                                                                                                   |
| `loading`  | Attribute and property | `lazy`, the default, holds the first request back until the element is within 400 pixels of the viewport. `eager` requests as soon as the element is in the document. Any other value means `lazy`, as for the `loading` attribute of `<img>`.                                                                                                 |
| `browsers` | Attribute and property | Space-separated ids of the support targets to show, such as `chrome firefox`. Without it, the table shows `chrome firefox safari nodejs`, less any target the data does not describe. A target listed here that the data does not describe still gets a column, in a group named "Other", and every cell in it reads "No data for" and the id. |
| `locale`   | Attribute and property | Selects the table of messages the element renders. Only English ships, and an unknown locale selects English.                                                                                                                                                                                                                                  |

Setting an attribute updates the property of the same name, which reads `null`
while the attribute is absent. Setting a property does not write the attribute
back, and the element uses the property's value. `loading` differs in one way:
its property always reads `"lazy"` or `"eager"`, never `null`.

## Which input wins

When more than one source of data is set, the element uses the first of these
that is set, and ignores the others:

1. `data`
2. `source`
3. `query`

So `data` wins over a request: setting `data` drops a pending request, and
setting `data` back to `null` shows the fetched table again. A present
`source` keeps the element out of fetch mode, so a wrong `id` reports an error,
even when `query` names a feature the API could answer. To use `query`
instead, remove the `source` attribute.

A change to `browsers` or `locale` renders the same data again and fires no
new `bcd-load` event. [Events](/component/events/) describes the one exception.

## Children

The element's children are its fallback content. They show until a table
renders, and again after an error or when `data` becomes `null`. The element
never moves or removes them, with one exception: a child with the class
`bcd-render-container` is a copy of an earlier table, from `cloneNode(true)`
or from saved HTML, so the element removes it. That class belongs to the
element; do not put it on your own content.

## Attributes the element sets on itself

The element sets two attributes of its own. A stylesheet or a script may read
them, but should not set them.

| Attribute   | When it is present                                                                                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `loaded`    | While a table is rendered. The base stylesheet hides the fallback content while it is present. It is removed after an error and when `data` becomes `null`.                                                                                      |
| `aria-busy` | Set to `true` while a request is in flight, and removed when the answer arrives. A lazy element that is still waiting for the viewport does not carry it. The element removes only a value it set, so an `aria-busy` that you set is left alone. |

## TypeScript

The package's types describe the element as `BcdCompatTableElement`, an
interface written by hand, so no type from Lit reaches your code. The package
adds the element to TypeScript's `HTMLElementTagNameMap`, so
`document.querySelector("bcd-compat-table")` returns a
`BcdCompatTableElement`, and adds both events to
`GlobalEventHandlersEventMap`, so a listener's `event.detail` is typed. The
type of `data` is exported as `CompatTableData`.
