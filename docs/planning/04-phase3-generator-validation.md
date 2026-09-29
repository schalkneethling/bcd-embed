# Phase 3 — generator validation and measurements

The full-volume gate uses the pinned `@mdn/browser-compat-data` 8.1.3 package.
It invokes the built `bcd-embed-generate` CLI with fixed generation and expiry
timestamps, writing into an isolated temporary directory. It then reads the
generated tree one file at a time and removes the temporary directory on both
success and failure. No generated dataset is committed.

From a clean checkout, build the workspaces and run the full gate with:

```sh
pnpm check
node --expose-gc packages/generator/scripts/full-volume-check.mjs
```

For a local candidate artifact tree, the CLI grammar is defined by
`packages/generator/src/cli.ts`. After the build, run:

```sh
node packages/generator/dist/bin.js \
  --out /tmp/bcd-embed-artifacts \
  --generated 2026-09-27T12:00:00Z \
  --expires 2026-12-26
```

This emits immutable candidate snapshot files and `v1/meta.json`; it does not
create a `current` alias or publish anything. Reusing the same timestamps,
source package, and generator version produces the same paths and bytes. The
writer refuses to replace an immutable snapshot or candidate metadata with
different content.

Generation requires a case-sensitive output filesystem. BCD 8.1.3 contains
distinct addressable keys that differ only by case (for example,
`api.Crypto` and `api.crypto`), while the contract maps each dotted key directly
to a filename. The default macOS APFS volume is commonly case-insensitive; use
Linux or a case-sensitive APFS volume for generation. The full-volume gate
checks this before starting generation.

## What the gate verifies

The source tree is traversed once to collect addressable key order, namespace
shards, and references to source subtrees. For every emitted normalized
response, the gate parses the canonical schema and walks only that response's
source subtree to assert exact key and depth coverage. It recomputes normalization
of that same subtree using `@bcd-embed/core` and compares each emitted feature's
complete support object, including values, to the recomputed result. This catches
schema-valid support-value corruption as well as missing or extra targets.
Every raw response is validated with an independently compiled Ajv validator against the vendored
published BCD public identifier schema, then compared to its source subtree
without normalizing it. Browsers, full and sharded indexes, and metadata are
parsed against their canonical schemas and checked for provenance.

Finally, the gate checks the exact on-disk path set, output count, index order
and shard coverage, one-to-one raw/normalized addressability, and absence of
unexpected files. It keeps only source-node references and path/key manifests;
generated payloads are parsed, checked, measured, and released sequentially.
It has no product payload-size threshold. `BCD_EMBED_FULL_VOLUME_TIMEOUT_MS`
can override its 8-minute generator-process safety timeout with a positive integer.

## Complexity and memory

Let `N` be nodes in the BCD tree, `K` independently addressable keys, `A` the
number of emitted artifacts, `P_i` the serialized size of artifact `i`, and
`L` the total byte length of retained key and relative-path strings. Source
discovery and expected-path construction are `O(N + K)` time. The validator
retains `O(K + A + L)` key/path references and source-subtree references;
recursive `Object.entries` enumeration can temporarily retain up to `O(N)`
entries across active frames, with `O(D)` call-stack depth. Filesystem
verification and compression are `O(sum(P_i))` work with `O(P_max)` live
artifact data; raw equality is output-sensitive to each intentionally
duplicated subtree. For
each normalized feature, source coverage walks that feature's subtree once,
matching the redundant subtree output rather than repeatedly scanning the
global key list. The generator's base discovery uses the same `O(N)` walk and
retains addressable subtree references, not all generated responses.

The generation child reports a best-effort 50 ms sampled RSS high-water mark.
Array parse heap deltas are observational measurements around each parsed Array
artifact; they are not thresholds and vary with runtime allocation and
collection. Compact byte counts use `JSON.stringify` output; gzip and Brotli
compress the actual compact emitted file bytes plus the trailing newline.
Compression is calculated independently per artifact
(the API serves separate objects), with gzip level 6 and Brotli quality 4.
Reported totals are therefore the sum of separately compressed artifacts, not
a compressed archive.

## Full-volume baseline

Measured against BCD 8.1.3 / generator 0.0.0 on macOS 27.0, Apple M3 Pro
(arm64), Node 24.21.0, 11 logical CPUs, using a temporary case-sensitive APFS
volume. The generator CLI completed in 18.239 seconds; the full gate, including
disk validation and compression, completed in about 27 seconds. These local
timings are observations, not CI thresholds. The CI runner uses Node 22.18.0
on Ubuntu, so its timing and RSS can differ.

| Measure | Result |
| --- | ---: |
| Addressable keys / namespaces | 20,647 / 12 |
| Emitted files, expected / actual | 41,309 / 41,309 |
| Total compact bytes / emitted file bytes | 494,225,610 / 494,266,919 |
| Per-object gzip / Brotli bytes | 35,950,207 / 32,678,875 |
| All-artifact JSON parse time | 1,496.1 ms |
| Generation wall time / 50 ms sampled RSS | 18,239 ms / 363,233,280 bytes |
| Validator process RSS observed during artifact checks | 558,006,272 bytes |
| Maximum addressable key length | 119 bytes |

The largest feature/raw payloads by compact size were:

| Artifact | Compact bytes | gzip bytes | Brotli bytes |
| --- | ---: | ---: | ---: |
| `features/api.Element.json` | 3,254,829 | 76,600 | 34,020 |
| `features/javascript.builtins.Temporal.json` | 3,014,495 | 35,973 | 6,993 |
| `features/api.WebGL2RenderingContext.json` | 2,682,516 | 35,157 | 7,339 |
| `features/api.RTCStatsReport.json` | 2,654,267 | 45,836 | 16,040 |
| `features/api.Document.json` | 2,299,836 | 60,841 | 28,199 |

Index sizes are measured independently per response. The full index contains
20,647 keys and is 812,607 compact bytes (114,694 gzip; 111,563 Brotli). The
largest namespace shard is `api`, with 10,263 keys and 368,237 compact bytes.

| Namespace index | Entries | Compact bytes | gzip bytes | Brotli bytes |
| --- | ---: | ---: | ---: | ---: |
| `api` | 10,263 | 368,237 | 58,424 | 56,928 |
| `css` | 4,175 | 163,593 | 20,701 | 20,296 |
| `webextensions` | 2,075 | 108,291 | 12,779 | 12,441 |
| `javascript` | 1,400 | 65,263 | 7,855 | 7,738 |
| `html` | 824 | 27,381 | 4,680 | 4,531 |
| `webdriver` | 528 | 30,410 | 3,580 | 3,411 |
| `svg` | 443 | 14,526 | 2,542 | 2,430 |
| `http` | 414 | 17,005 | 3,213 | 3,180 |
| `webassembly` | 333 | 12,498 | 1,810 | 1,742 |
| `mathml` | 137 | 4,974 | 958 | 931 |
| `manifests` | 38 | 1,500 | 444 | 427 |
| `mediatypes` | 17 | 607 | 238 | 226 |

`javascript.builtins.Array` raw output measured 54,217 compact bytes (3,167
gzip; 2,963 Brotli), with a 0.256 ms JSON parse and 68,800-byte observed heap
delta. Its normalized response measured 642,087 compact bytes (14,211 gzip;
6,822 Brotli), with a 1.582 ms parse and 595,368-byte observed heap delta. The
heap deltas are per-parse observations after an explicit GC request, not size
limits or guarantees about process peak memory.
