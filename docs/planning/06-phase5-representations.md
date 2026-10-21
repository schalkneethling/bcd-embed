# Phase 5 — representation foundation

This layer prepares deterministic identity, Brotli, and gzip artifacts and
verifies local HTTP transport. No cloud resources, remote publication, freshness
automation, or Sentry integration are performed here.

The local inventory is `.bcd-embed-manifest.json` (`ARTIFACT_MANIFEST_PATH`).
`artifactManifestSchema` validates `ArtifactManifest`: version 1, snapshotId,
artifacts array. Each `ArtifactRepresentation` has logicalPath, encoding
(`identity`, `br`, `gzip`), path, byte size, lowercase SHA-256, and its quoted
strong ETag. Safe paths, ownership, uniqueness, and all three encoding groups
are validated in O(K). Publishers still verify actual bytes and complete logical
inventory; the manifest is not a public API object. The private publisher preserves
an immutable copy under `v1/_candidates/<snapshotId>/` for exact baseline recovery,
alongside the original singleton metadata and its compressed variants. See
`packages/publisher/README.md` for the verified publication and restoration contract.

Identity public paths remain unchanged. Snapshot variants append `.br`/`.gz`.
Metadata variants live at `v1/_meta/<identity-meta-sha256>.json.br`/`.json.gz`.
Only canonical `v1/meta.json` is mutable. A publisher merging retained snapshots
uses `createRepresentations` on the final merged metadata bytes, uploads those
variants first, and compare-and-swaps canonical metadata last.

Gzip level 6 and Brotli quality 4 match Phase 3 measurements. Offline emission
is O(sum(Bi)) work and O(Bmax + K) auxiliary memory; artifacts are sequential,
not expanded simultaneously. No request-time dataset scan or large-body
compression occurs. Snapshot success uses two reads; compressed metadata two
bounded reads. Encoded misses may check identity existence before reading a
bounded shard.
The adapter caches only canonical `current` and metadata routes. Pinned reads
bypass Cache API to enforce publication membership after retirement, while
preserving public immutable headers for consumer caches. Expiry-bound pinned
edge entries are a future optimization, not a prerequisite for correctness.

The real normalized Array fixture is 642,088 identity bytes, 6,826 Brotli bytes,
and 14,212 gzip bytes. Both representations decode byte-identically. Strict raw
local HTTP tests verify encoding-aware caches, GET/HEAD headers, 304s, errors,
and malformed/native-mismatched digest metadata. All 21 default endpoint probes
pass without `--local-identity-only`. Production edge acceptance remains deferred
until an explicitly authorized LIVE run.
