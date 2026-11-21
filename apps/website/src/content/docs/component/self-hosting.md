---
title: Self-hosting
description: Point bcd-compat-table at your own copy of the API with the endpoint attribute.
---

The `endpoint` attribute is the whole self-hosting mechanism. Set it to the
base address of your own copy of the application programming interface (API),
and `<bcd-compat-table>` requests its data there instead of from
`https://api.browser-compat.dev`:

<!-- sample: packages/element/examples/self-hosted.html -->

```html
<bcd-compat-table query="css.properties.display" endpoint="https://compat.example.com">
  <p>
    <a href="https://developer.mozilla.org/en-US/docs/Web/CSS/display#browser_compatibility"
      >Browser compatibility for <code>display</code> on MDN Web Docs</a
    >
  </p>
</bcd-compat-table>
```

This element requests
`https://compat.example.com/v1/current/features/css.properties.display.json`.

## The request

The element always requests `{endpoint}/v1/current/features/{query}.json`,
the feature route of version 1 of the API contract. A trailing slash on
`endpoint` does not produce a double slash, and the endpoint may include a
path, such as `https://example.com/compat`.

`endpoint` must be an absolute `https:` or `http:` address with no query
string, no fragment, and no user name or password. Any other value, such as an
empty string or an address that contains `?`, sends no request and fires
`bcd-error` with the reason `invalid-endpoint`. `http:` is accepted for any
host, typically for an API on your own machine during development. A browser
blocks an `http:` request from an `https:` page as mixed content, and the
element then reports `network`.

The element normalizes a valid endpoint, so `https://Example.TEST` and
`https://example.test/` count as the same endpoint and share one cached
answer.

## What your API must send

Your copy of the API answers the same way as the hosted one, because it runs
the same server code:

- A feature response from version 1.x of the API contract, as JavaScript
  Object Notation (JSON). Anything else fires `bcd-error` with the reason
  `invalid-payload`.
- Cross-Origin Resource Sharing (CORS) headers that let the page read the
  response. The hosted API sends `Access-Control-Allow-Origin: *`. Without a
  CORS header, the browser hides the response from the page, and the element
  reports `network`.
- The `bcd-embed-snapshot` header, listed in `Access-Control-Expose-Headers`,
  if the page wants to read the snapshot name. The element passes it to the
  page as `snapshot` in the `bcd-load` event, and passes `null` when the page
  cannot read the header.

The server code is in `packages/server` and the Cloudflare Worker that runs it
is in `apps/worker`, in the
[bcd-embed repository](https://github.com/schalkneethling/bcd-embed).
[Deploying the Worker](/deployment/) describes how the hosted API is
deployed.

## Content Security Policy

A page with a Content Security Policy (CSP) must allow the element's request
in `connect-src`. For the hosted API, that is
`connect-src https://api.browser-compat.dev`, and for your own copy, its
origin. This documentation site sends
`connect-src 'self' https://api.browser-compat.dev` in its report-only policy,
because the live example on the getting-started page requests its table from
the hosted API.
