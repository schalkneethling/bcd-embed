# Phase 4 — server and endpoint verification

## Status and scope

Phase 4 verification is local-only in this change. The portable server handler
and the Worker/R2 adapter are exercised by their automated tests; this endpoint
CLI adds a bounded request-level check for an already-running endpoint. It does
not start a server, seed a bucket, create Cloudflare resources, deploy, or
publish an artifact tree. No LIVE endpoint or Cloudflare edge was contacted for
this validation.

The CLI accepts only a caller-supplied origin. Loopback HTTP/HTTPS is allowed;
a non-loopback target requires HTTPS and the explicit `--allow-remote` flag.
The remote form exists for a later, controlled acceptance run and was not run
here.

## Local validation

Install the pinned workspace dependencies and run the repository checks:

```sh
pnpm install --frozen-lockfile
pnpm check
```

The checks cover portable handler routes and the Worker/R2 Miniflare integration
using generated fixture artifacts. They do not prove Cloudflare edge behavior.
The Worker integration invokes the endpoint CLI in loopback-only
`--local-identity-only` mode, which explicitly skips its compressed-representation
probes.

To check a locally running HTTP endpoint, pass its origin explicitly:

```sh
node packages/server/scripts/verify-endpoint.mjs \
  --base-url http://127.0.0.1:8787
```

This command does not launch or seed that endpoint. The base URL must contain
only the origin—no path, query, fragment, or credentials. The exact CLI grammar
is defined by `packages/server/scripts/verify-endpoint.mjs` and covered by
`packages/server/tests/verify-endpoint.test.mjs`; `--help` prints the usage.
By default, the CLI requests identity and compressed representations and fails
if a compressed response reuses the identity strong ETag. The optional
`--local-identity-only` flag skips both compressed requests; it is restricted to
loopback URLs, even when `--allow-remote` is also supplied.

## Probe plan and limits

All requests are sequential and read-only (`GET`, `HEAD`, or `OPTIONS`). The
plan discovers a feature key and its namespace from `/v1/meta.json` and the full
index, so it does not rely on a hard-coded production URL or a particular
feature being present. It checks:

- metadata and the current snapshot;
- current full and namespace indexes, browser metadata, a normalized feature,
  and its raw subtree;
- the same feature and raw subtree through an immutable pinned snapshot;
- `HEAD`, `If-None-Match`, CORS preflight, strong ETags, and current/pinned cache
  policies;
- `feature_not_found`, `namespace_not_queryable`, `snapshot_not_found`, and
  `invalid_key` responses, including malformed escapes and encoded slash,
  backslash, NUL, and traversal-like input.

Before using endpoint-provided identifiers in request paths, the verifier
checks snapshot IDs, namespaces, and every full-index key against the project
schema grammar plus the server's traversal and length constraints. JSON
responses must declare `application/json`; expected error responses must use
the one-hour error cache policy. For compressed representations, a strong ETag
must differ from the identity representation's ETag, and a conditional request
for the compressed representation must retain its validator.

The command performs at most 24 requests, with a 5-second default per-request
timeout (configurable from 100 to 30,000 ms), a 120-second overall deadline, an
8 MiB per-response limit, and a 32 MiB cumulative response-body limit. It does
not retry, parallelize, request each feature, or deliberately generate
rate-limit pressure. It does not test `rate_limited` or the self-hosted-only
`generation_in_progress` response.

Index discovery is output-sensitive: the verifier reads the full index once,
validates its keys in O(K), builds one O(K) membership set, and checks the
manifest namespaces in O(N). It does not rescan all keys for each namespace or
repeatedly rebuild key prefixes. The request sequence is serial; retained
identifier/index data is O(K), with response bodies capped at 8 MiB each and
32 MiB total. Parsed-object memory varies with JSON shape, so these are input
bounds rather than a precise RSS guarantee.

The seeded Miniflare/workerd HTTP transport negotiated Brotli for the generated
Array feature and returned 5,854 bytes instead of the 642,088-byte identity
body, while retaining the same strong R2 ETag. This is a local runtime
observation, not evidence about Cloudflare's production edge. The default CLI
correctly rejects that representation pair. The CI Worker integration therefore
uses `--local-identity-only` to verify the remaining routes and identity
validators without claiming compression acceptance; its report states that
compression was skipped. The compressed strong-ETag contract remains unverified
until a controlled LIVE probe passes.

Adversarial paths are sent using a raw HTTP request target rather than building
a URL for each path; a local HTTP fixture asserts that the encoded probe bytes
reach the transport unchanged. A literal `..` path segment, or a segment made
only of percent-encoded dots, may be normalized by the URL implementation or an
edge before the Worker receives `Request.url`. The application cannot reject
bytes it never receives. Accordingly, the verifier uses encoded traversal-like
characters inside one key segment and does not treat a canonicalized literal
dot path as evidence of `invalid_key` handling.

## LIVE acceptance — pending

After a controlled deployment to an explicitly selected staging origin, run
the verifier only with that caller-supplied URL and explicit opt-in:

```sh
node packages/server/scripts/verify-endpoint.mjs \
  --base-url "$BCD_EMBED_STAGING_ORIGIN" \
  --allow-remote
```

Do not set the variable to a production URL for routine CI. The verifier sends
only its bounded GET/HEAD/OPTIONS plan and will not follow redirects. It rejects
plain HTTP for non-loopback hosts. A LIVE pass is still required before claiming
Cloudflare acceptance: the compressed-response probe must receive Brotli or
gzip with a strong (non-weak) ETag, and a conditional request for the same
encoding must return a bodyless `304` with that ETag. Cloudflare may transform
or weaken an origin ETag when compressing, so local Miniflare identity-response
tests do not establish this property. If the edge weakens the ETag, resolve the
transport contract before marking this gate complete.

The CLI probe is not a load test or a substitute for deployment-specific
security review. Phase 5 freshness automation, output-diff gates, alias flips,
retention/pruning, and Sentry alerting remain out of scope. Phase 6 self-hosting
recipes remain separate.
