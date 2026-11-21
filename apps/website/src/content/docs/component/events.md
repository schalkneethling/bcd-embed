---
title: Events
description: The bcd-load and bcd-error events, every error reason, and how a page handles a failure.
---

`<bcd-compat-table>` fires `bcd-load` when a table renders and `bcd-error`
when it cannot render one. A page uses `bcd-error` to notice a failed table
instead of noticing it only when a reader reports a missing table.

The element's data comes from MDN Browser Compatibility Data (BCD), through
the bcd-embed application programming interface (API) or a copy of its
answer.

## The two events

Both events are `CustomEvent`s that bubble, so a listener on the element, on
any ancestor, or on the document receives them. Neither can be cancelled.

| Event       | When it fires                                                                             | `detail`                         |
| ----------- | ----------------------------------------------------------------------------------------- | -------------------------------- |
| `bcd-load`  | Once for each update that renders newly assigned data, or the answer to a new request     | `{ mode, snapshot }`             |
| `bcd-error` | Once for each update that rejects newly assigned data, or for each new request that fails | `{ mode, reason, status, code }` |

`mode` names the input that supplied the data, or failed to: `"data"`,
`"source"`, or `"fetch"`. `snapshot` is the value of the API's
`bcd-embed-snapshot` response header in fetch mode, such as
`bcd-8.1.9-gen-0.0.0`, and `null` in the other two modes. `status` and `code`
are `null` for every reason except `http`.

## Error reasons

| Reason                | Mode                | When                                                                                                                                                                 |
| --------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invalid-query`       | fetch               | `query` does not match the pattern of BCD keys. No request is sent, and the error fires at once, even for a lazy element.                                            |
| `invalid-endpoint`    | fetch               | `endpoint` is not an absolute `https:` or `http:` base URL. No request is sent.                                                                                      |
| `network`             | fetch               | The request failed with no readable response, or took longer than 20 seconds.                                                                                        |
| `http`                | fetch               | The API answered with an error status. `status` holds it, and `code` holds the contract's error code, such as `feature_not_found`, or `null` when the body has none. |
| `invalid-payload`     | data, source, fetch | The value is not a feature response from version 1.x of the API contract that the element can read.                                                                  |
| `source-missing`      | source              | No element has the `id` that `source` names, or the first one that does is not a `<script type="application/json">`.                                                 |
| `source-invalid-json` | source              | The script's text is empty or is not JSON.                                                                                                                           |

The hosted API's rate limit answers with a status of 429 that carries no
Cross-Origin Resource Sharing (CORS) header. The browser hides such a response
from the page, so the element reports it as `network`, not `http`. A failed
request means the data is temporarily unavailable, so treat `network` as a
reason to try again later.

## Handling a failure

After an error, the element shows its fallback content again, fires one
`bcd-error`, and stops. It never retries by itself, so fifty tables on a page
cannot turn one refusal into a loop of requests. This example logs both
events, and offers a button that asks again when the failure is temporary:

<!-- sample: packages/element/examples/handle-errors.js -->

```js
import "@bcd-embed/element";

// One listener on the document hears every table on the page, because both events bubble.
document.addEventListener("bcd-load", (event) => {
  const { mode, snapshot } = event.detail;
  console.info(`Compatibility table loaded in ${mode} mode`, snapshot);
});

document.addEventListener("bcd-error", (event) => {
  const table = event.target;
  const { mode, reason, status, code } = event.detail;
  console.warn(`Compatibility table failed in ${mode} mode: ${reason}`, { status, code });

  // A network failure or a server error is temporary, so offer to ask again. Any other reason
  // needs a change to the page, and asking again would fail the same way.
  const temporary = reason === "network" || (reason === "http" && status >= 500);
  if (!temporary || table.nextElementSibling?.matches(".retry-table")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "retry-table";
  button.textContent = "Try loading the compatibility table again";
  button.addEventListener("click", () => {
    button.remove();
    const query = table.getAttribute("query");
    table.removeAttribute("query");
    // Let the element update without a query first, so that setting it again is a new request.
    setTimeout(() => table.setAttribute("query", query));
  });
  table.after(button);
});
```

The retry removes `query` and sets it again in a later task, because setting
the value `query` already has is no change and does nothing. The element
applies every change in one update after the running script finishes, so
removing and setting the attribute in the same script would also look like no
change. `setTimeout` runs the second step after that update.

All tables on a page share one feature client, which holds a failure for 10
seconds. A retry inside that window gets the held failure back with no
request, so the element fires `bcd-error` again and the example shows its
button again. After the window, a retry sends one new request.

## What "once" means

The element updates in a batch, so these rules decide how many events a page
sees:

- Two values assigned one after the other in the same script render the
  second and fire one event.
- Assigning the object that `data` already holds is no change, so nothing
  renders and nothing fires.
- An event never fires while the element is out of the document. The element
  holds it back and fires one event, for the state it is in, when it is added
  to the document again, so a listener on the document misses nothing.
- Restoring the `query` and `endpoint` of the element's last successful answer
  renders that table again with no request, and fires one `bcd-load`, because
  the input changed.
- A change to `browsers` or `locale` renders the same data again and fires
  nothing. The exception is a change that adds a support target whose entry in
  the data is malformed: that change fires `bcd-error`, and removing the target
  again fires `bcd-load`.
