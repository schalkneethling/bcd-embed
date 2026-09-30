# @bcd-embed/server

Portable, read-only Fetch handler over generated artifacts. No BCD dependency,
normalization, write path, or full-dataset scan.

`createArtifactHandler({ store })` returns an async
`(request: Request) => Promise<Response>` handler. Optional `beforeRead` and
`onError` hooks are described below. `ArtifactStore.get(path)` receives a
relative artifact-root path (for example `v1/meta.json`) and returns `null` or
an `Artifact` object with `body`, `etag`, and optional `size` fields. Bodies are
`ReadableStream<Uint8Array>`; `etag` must be a
quoted strong entity tag for the exact bytes; `size` is the byte length when
known. Storage adapters own these guarantees and byte-preserving delivery.

All Document 1 routes are supported: metadata, browsers, full/sharded indexes,
features, and raw features. `current` resolves through metadata; pinned
snapshots must remain enumerated in `meta.snapshots`. Retention dates do not
trigger clock-based retirement: cleanup controls physical availability and
metadata membership. Misses use the selected snapshot's shard, never the current
snapshot's namespace list as a map of historical namespaces.

`beforeRead(request)` returns `null`, `{ code: "rate_limited", retryAfter: 60 }`
(nonnegative integer seconds), or `{ code: "generation_in_progress" }`.
Generation is an explicit dynamic-host hook, not a substitute for backend
failure. `onError(error)` can report backend failures without leaking details.
It supports synchronous or asynchronous reporters; their failures are isolated,
and pending reporting never delays the HTTP error response.

## Transport policy

GET and HEAD serve the same status/headers; HEAD and conditional 304 responses
cancel the unconsumed storage stream. OPTIONS returns 204 without storage I/O,
advertises `GET, HEAD, OPTIONS`, and allows `if-none-match`. Other methods return
405 with `Allow`. No request body, batch grammar, or dynamic query is evaluated.
Query strings are ignored and never enter storage paths.

Responses use JSON media type, unrestricted CORS, exposed `etag, retry-after`,
and `nosniff`. Artifact bytes stream unchanged. Metadata and `current` use
`max-age=86400, stale-while-revalidate=604800`; pinned successes use
`max-age=31536000, immutable`. Key/feature/namespace/snapshot 4xx errors use
`max-age=3600`. Rate limiting and generation responses use `no-store`; 429
includes `Retry-After`.

The six contract errors parse against `apiErrorResponseSchema`. Unknown routes,
missing unadvertised index shards, unsupported methods, and backend/corrupt
artifact failures are separate transport failures (404/405/500), with the exact
shape `{ "error": { "message": "..." } }`, no invented contract code. Backend
500s have the fixed message `Artifact service unavailable.` and `no-store`.
Every response carries a strong ETag. Conditional GET/HEAD use weak comparison,
wildcards, and entity-tag lists under
[RFC 9110 §13.1.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.2).
Malformed conditions are ignored; conditions do not turn error responses into
304s. Compression belongs to the hosting layer: adapters must preserve strong
validator identity across encoded representations, not label different bytes
with the same strong tag.

## Input and resource bounds

Keys use the schema's published ASCII allowlist, case-sensitive, with nonempty
dot segments and a 512-character routing limit. This is an adapter safety limit,
not a change to the contract schema; Phase 3 measured the largest key at 119
bytes. Snapshot tokens are bounded at 512, namespaces at 128, paths at 2048.
Percent encoding is decoded once; safely encoded ASCII such as `%40` is accepted,
while malformed escapes, encoded slashes/backslashes, double encoding, nulls,
non-ASCII keys, and empty dot segments are rejected before storage I/O.

Fetch URL construction already normalizes directory dot segments; the handler
cannot recover discarded spelling. A normalized canonical public route may be
served. Security does not depend on recovering it: object paths are constructed
only from validated route tokens, never arbitrary request paths. No input can
select private files, leave the artifact tree, or introduce storage separators.

Only resolution metadata (256 KiB) and miss-classification shards (2 MiB) are
buffered and schema-validated. Known lengths are rejected before reading; unknown
lengths are checked per chunk and cancelled on overflow. Zero-byte chunks are
not retained. Full indexes and successful payloads are streamed, not parsed or
capped. These bounds allow headroom above Phase 3's 368,237-byte largest shard.

## Complexity

Successful snapshot routes use two storage reads (bounded metadata plus one
artifact); metadata itself uses one. Streaming needs O(1) auxiliary payload
space; delivery is O(B) for B bytes. Metadata validation/resolution takes O(M)
time/space for bounded metadata size M, not dataset size. A feature miss uses at
most one additional shard read and scans its K entries: O(I + K × L) time and
O(I) space for bounded shard bytes I and maximum key length L. No fuzzy search,
normalization, full-index parse, or dataset scan runs at request time.

Build includes packed ESM runtime and public declaration smoke tests. Tests
cover every contract error, route, conditional/HEAD behavior, streaming, bounded
reads, corrupt artifacts, and forbidden-character fuzzing with zero storage I/O.
