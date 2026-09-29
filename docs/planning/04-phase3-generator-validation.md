# Phase 3 — generator validation and measurements

The full-volume gate uses the pinned `@mdn/browser-compat-data` 8.0.13 package.
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

Generation requires a case-sensitive output filesystem. BCD 8.0.13 contains
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
Every raw response is
validated with an independently compiled Ajv validator against the vendored
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

Measured against BCD 8.0.13 / generator 0.0.0 on macOS 27.0, Apple M3 Pro
(arm64), Node 24.21.0, 11 logical CPUs, using a temporary case-sensitive APFS
volume. The generator CLI completed in 14.526 seconds; the full gate, including
disk validation and compression, completed in about 22 seconds. These local
timings are observations, not CI thresholds. The CI runner uses Node 22.18.0
on Ubuntu, so its timing and RSS can differ.

| Measure | Result |
| --- | ---: |
| Addressable keys / namespaces | 20,359 / 12 |
| Emitted files, expected / actual | 40,733 / 40,733 |
| Total compact bytes / emitted file bytes | 486,926,624 / 486,967,357 |
| Per-object gzip / Brotli bytes | 35,465,402 / 32,251,286 |
| All-artifact JSON parse time | 1,043.8 ms |
| Generation wall time / 50 ms sampled RSS | 14,526 ms / 350,961,664 bytes |
| Validator process RSS observed during artifact checks | 581,500,928 bytes |
| Maximum addressable key length | 119 bytes |

The largest feature/raw payloads by compact size were:

| Artifact | Compact bytes | gzip bytes | Brotli bytes |
| --- | ---: | ---: | ---: |
| `features/javascript.builtins.Temporal.json` | 3,015,614 | 36,342 | 7,277 |
| `features/api.Element.json` | 3,012,608 | 72,365 | 33,677 |
| `features/api.WebGL2RenderingContext.json` | 2,682,517 | 35,158 | 7,314 |
| `features/api.RTCStatsReport.json` | 2,654,260 | 45,850 | 15,971 |
| `features/api.Document.json` | 2,295,394 | 60,477 | 28,046 |

Index sizes are measured independently per response. The full index contains
20,359 keys and is 801,087 compact bytes (113,333 gzip; 110,299 Brotli). The
largest namespace shard is `api`, with 10,121 keys and 362,821 compact bytes.

| Namespace index | Entries | Compact bytes | gzip bytes | Brotli bytes |
| --- | ---: | ---: | ---: | ---: |
| `api` | 10,121 | 362,821 | 57,714 | 56,329 |
| `css` | 4,059 | 158,991 | 20,223 | 19,882 |
| `webextensions` | 2,074 | 108,233 | 12,775 | 12,430 |
| `javascript` | 1,395 | 65,070 | 7,826 | 7,722 |
| `html` | 818 | 27,214 | 4,654 | 4,493 |
| `webdriver` | 515 | 29,508 | 3,480 | 3,325 |
| `svg` | 443 | 14,527 | 2,543 | 2,434 |
| `http` | 412 | 16,910 | 3,197 | 3,158 |
| `webassembly` | 333 | 12,499 | 1,811 | 1,744 |
| `mathml` | 134 | 4,894 | 944 | 914 |
| `manifests` | 38 | 1,501 | 445 | 429 |
| `mediatypes` | 17 | 608 | 239 | 226 |

`javascript.builtins.Array` raw output measured 54,217 compact bytes (3,167
gzip; 2,963 Brotli), with a 0.183 ms JSON parse and 68,824-byte observed heap
delta. Its normalized response measured 642,088 compact bytes (14,212 gzip;
6,816 Brotli), with a 1.162 ms parse and 595,392-byte observed heap delta. The
heap deltas are per-parse observations after an explicit GC request, not size
limits or guarantees about process peak memory.
