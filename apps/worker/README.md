# Cloudflare Worker adapter

This Worker maps `@bcd-embed/server` artifact reads to a local or deployed R2
binding. Successful bodies stream from R2. The server owns route validation,
bounded metadata/index parsing, error bodies, HTTP validators, and cache policy;
the Worker adds a named Cloudflare Cache API layer. Cache API entries expire at
their `max-age`. Cloudflare's Cache API does **not** implement
`stale-while-revalidate`; that directive remains on client-facing `current`
responses, but edge cache misses re-read R2 after one day. Cache API entries
are local to a data center and do not bypass Worker invocation.

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

`R2Object.httpEtag` is the strong validator for local identity responses.
Cloudflare may weaken or remove ETags when compressing at the edge, so live
Brotli/gzip **and** strong-ETag contract acceptance must be verified before
public launch. Local Miniflare tests cannot establish wire behavior.

Runtime errors are currently reported as structured, non-request-derived
error classes in Workers Logs. This is not Sentry integration or guaranteed
alerting; those must be configured and tested before public launch.
