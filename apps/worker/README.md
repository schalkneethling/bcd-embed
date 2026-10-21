# Cloudflare Worker adapter

This Worker maps `@bcd-embed/server` artifact reads to a local or deployed R2
binding. Successful bodies stream from R2. The server owns route validation,
bounded metadata/index parsing, error bodies, HTTP validators, and cache policy;
the Worker adds a named Cloudflare Cache API layer. Cache API entries expire at
their `max-age`. Cloudflare's Cache API does **not** implement
`stale-while-revalidate`; that directive remains on client-facing `current`
responses, but edge cache misses re-read R2 after one day. Cache API entries
are local to a data center and do not bypass Worker invocation.
Only canonical `current` routes and `meta.json` use this edge cache. Pinned
routes retain their public immutable cache headers, but bypass Cache API so a
retired snapshot cannot remain edge-served for a year after metadata removal.
Each pinned origin read rechecks membership and streams the artifact from R2;
consumer caches may retain a previously fetched immutable response.

`pnpm --filter @bcd-embed/worker test` builds a dry-run bundle and runs a
Miniflare/workerd integration suite against a local R2 binding seeded from an
actual generator-produced, Array-scale BCD snapshot. It never accesses a
Cloudflare account. `pnpm --filter @bcd-embed/worker wrangler:dry-run` validates
the deployable bundle without deploying. Run `pnpm check` from the repository
root before review.

The compatibility date is pinned to 2026-09-23, the latest supported by the
workerd bundled with the pinned Wrangler/Miniflare versions. Upgrade these
versions together before advancing the date.

The configured bucket name is a **deployment prerequisite**, not a resource
created by this repository. No bucket is provisioned and no remote objects are
uploaded by these commands. Before a public endpoint exists, an operator must
create the bucket, publish and verify all immutable snapshot objects, then
publish `v1/meta.json` last. A validated idempotent uploader, atomic alias
flip, pruning, freshness pipeline, Sentry alerting, account-level rate limit,
and live deployment/pressure tests remain separate work. Do not deploy an
empty bucket or assume the candidate metadata produced by the generator is
already a safe remote publication.

The Worker serves offline variants with `encodeBody: "manual"`; no large-body
compression runs on requests. It restores `request.cf.clientAcceptEncoding`
before negotiation because Cloudflare rewrites the origin header. Cache keys
include the selected encoding and responses carry `Vary: Accept-Encoding`.
A private Cache API header preserves encoded length and is stripped on all
public responses. Cached GET uses `FixedLengthStream` when needed to retain
GET/HEAD wire length without buffering.

R2 objects require lowercase 64-digit `customMetadata.sha256`; wire ETags quote
this digest. Missing/malformed metadata fails closed; native `checksums.sha256`,
when available, must match. Uploads without a native checksum must establish
the digest through verified upload and byte readback before publication. The
hot path never hashes large stored bodies. Only small generated errors use
request-time compression, with a 16 KiB input bound.

Strict raw-HTTP local tests verify identity, Brotli, gzip, HEAD, 304, errors,
and exact encoded bytes. The endpoint verifier now runs without the identity-only
skip. This is local transport evidence, not deployed Cloudflare edge acceptance;
an explicitly authorized LIVE probe remains required before launch.

Runtime errors emit structured, non-request-derived error classes to Workers
Logs and Sentry when the optional `SENTRY_DSN` Worker secret is configured.
The Sentry SDK is configured to drop request, user, breadcrumb, message, stack,
and extra fields; it receives only bounded error types. Without that secret,
Sentry is deliberately disabled and no alert delivery is implied. Configure and
test an alert before public launch.
