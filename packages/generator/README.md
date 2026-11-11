# @bcd-embed/generator

Node-only generation and local artifact-emission package. It does not deploy
or create a `current` alias.

## Local artifact emission

```sh
bcd-embed-generate --out ./artifacts --generated 2026-09-27T12:00:00Z --expires 2026-12-26
```

The CLI grammar is defined by `src/cli.ts`: all three options are required and
occur once; positional arguments and `--option=value` are rejected.
`--generated` follows the contract's ISO 8601 UTC timestamp schema and
`--expires` its ISO 8601 date schema. Explicit time makes reruns reproducible.

The command writes the content-addressed layout of
[Document 8](../../docs/planning/08-incremental-publication.md):

```
v1/
├─ meta.json                    names the snapshot; the only file that changes after publication
├─ _meta/<sha256>.json.{gz,br}  compressed copies of meta.json, named by the hash of its plain bytes
├─ blobs/<sha256>.json          a served file's plain bytes, with .gz and .br copies beside it
├─ shards/<sha256>.json         the pointers for the feature keys of one shard
└─ snapshots/<snapshot>.json    the root: 256 shard hashes and the pointers for browsers.json and the indexes
```

A pointer says which blob answers a request path such as
`features/css.properties.gap.json`. A feature key's shard is the first byte of
the SHA-256 hash of the key, which `shardIndexOf(key)` returns. Files are
compact JSON with a trailing newline.

No file is named after a feature key, so the output folder may be on a
case-insensitive filesystem, which is the default on macOS. Keys that differ
only in case, such as `api.Crypto` and `api.crypto`, are separate entries
inside a shard.

`emitContentTree({ outputRoot, generatedSnapshot })` is the function behind the
command. It checks artifact paths, envelopes and path-to-payload identity, but
does not parse every payload again, because generation already validated them.
A rerun into the same folder compares each existing file with the new bytes and
writes nothing when they match; a difference fails. An output folder holds one
candidate: existing metadata that names other content is refused, not replaced.
Each file is written under a staging name and renamed into place, and an
exclusive local lock prevents concurrent runs. A killed process can leave the
staging folder or the lock; remove either only after confirming no run is
active.

The compressed copies are deterministic gzip (level 6) and Brotli (quality 4).
Gzip embeds no wall-clock timestamp and its header OS byte is fixed to 255
("unknown", RFC 1952), so identical inputs, settings and toolchain produce
identical bytes on any host. `createRepresentations(logicalPath, bytes)`
exports these exact bytes.

The work is one pass over the K served files: O(sum(Bi)) time for their bytes
and O(Bmax + K) memory, plus O(K log(K / 256)) to sort the keys inside each
shard, which `createPointerTree` does. For BCD 8.1.8 that is 41,880 files,
40,612 distinct blobs, 46 seconds and about 410 MB.

`loadContentTree(path)` reads such a folder back and checks all of it: every
pointer resolves to a blob whose bytes hash to its name, both compressed copies
decode to those bytes, every body matches its schema, the indexes cover exactly
the feature keys, and the folder holds no other file. It returns `null` for an
empty folder. It took 22 seconds for BCD 8.1.8. The diff tool and the publisher
both use it.

`emitGeneratedSnapshot` is the earlier emitter, which writes one folder per
snapshot with a file per feature key and therefore needs a case-sensitive
filesystem. Only the server's tests still use it. It is removed in step 5 of
Document 8, when the server reads the new layout.

`generateSnapshot({ generated, expires, data? })` returns snapshot metadata,
namespace names, and a single-use lazy `Iterable<GeneratedArtifact>`. The default
input is the exact pinned BCD version; optional input must satisfy the same published schema
and exact source-version gate. Timestamps and retention dates are caller inputs,
so identical reruns produce identical artifacts. Expiry must be later than
generation. Generator version comes from this package's manifest.

Artifacts carry a tagged kind, full relative path, and JSON data. Feature/raw
pairs precede browsers, full/sharded indices, and candidate `v1/meta.json`.
Candidate metadata is not a publish operation. Each normalized artifact uses
the canonical contract schema's `.parse()`; each untouched raw subtree uses a
compiled upstream Ajv identifier validator. Validation failures throw.

Consume lazily. The input must not be mutated during iteration. Retaining all
yielded responses defeats the bounded-memory design. Raw artifacts reference
the original input subtree; serialization preserves its fields and key order.

Discovery walks the source tree once: `O(N)` time, stores `O(K)` addressable
keys/subtree references, with up to `O(N)` temporary property-enumeration space
and `O(D)` call-stack space at depth `D`. Per-query subtree
normalization and raw validation repeat only intentionally duplicated output,
not full-dataset scans. Total work is output-sensitive (including core's
statement sorting); live expanded payload memory is `O(Pmax)`, not the sum of
all emitted payloads. The loaded input, key index, and browser metadata remain
resident. No size cap is invented before full-volume measurement.

Tests resolve core/schema source through the root Vitest aliases so fresh CI
does not require prebuilt packages. Package smoke tests separately validate
runtime and declaration exports from an extracted npm tarball.

## Upstream validation provenance

BCD's npm package contains generated types, not JSON schemas or a schema-version
field. We vendor the unmodified semantic object from
[public.schema.json at v8.1.3](https://github.com/mdn/browser-compat-data/blob/f376872e9f5f937631243c2263cda5497d0c1296/schemas/public.schema.json),
commit `f376872e9f5f937631243c2263cda5497d0c1296`, licensed CC0-1.0 by upstream.
The repository schema copy retains upstream text and rules; only whitespace
formatting changes. SHA-256 of `JSON.stringify(JSON.parse(schema))`:

`0a94f39473d919fd6caa54ef4055879a4442810ffded72081707130fef7b81b7`

Relative to v8.0.13, the public schema adds a required, nonnegative integer
`index` to each browser release. Generation validates it but does not add it to
the versioned response contract.

The compiled draft-07 aggregate and identifier validators use this public
schema unchanged. Source-file schemas are deliberately not used: they accept
`mirror` and lack generated `source_file`/`version_last` fields. Public
aggregate data resolves mirrors and requires `source_file`. Ajv recognizes
the upstream `tsType` annotation as non-validating while enforcing strict
validation keywords; it does not coerce, remove, or default input data.
Ajv's strictRequired schema lint is disabled because upstream conditional
requirements reference fields declared on an enclosing object; the actual
required-field validation is unchanged. Formats use the same fast mode as
[upstream's validator](https://github.com/mdn/browser-compat-data/blob/f376872e9f5f937631243c2263cda5497d0c1296/scripts/lib/ajv.js),
which deliberately accepts Unicode specification anchors such as ①.
There is no schema fetch or network access at runtime.

An upgrade must review upstream public schema and normalizer compatibility,
update the exact dependency/version pin and reviewed schema fingerprint, and
run all gates. Changing only a dependency version fails closed.

## Semantic output diff

After building, compare two emitted trees with:

```sh
node packages/generator/dist/diff-bin.js --baseline artifacts-before --candidate artifacts-after
node packages/generator/dist/diff-bin.js --baseline artifacts-before --candidate artifacts-after --approval reviewed-approval.json
```

The grammar is defined in `src/diff-cli.ts`. The tool loads both folders with
`loadContentTree`, then `compareContentTrees` compares their pointers: a
feature counts as changed when the hash of its normalized file or of its raw
file differs. No file body is read for the comparison itself, which is O(K)
and took 3 milliseconds for BCD 8.1.8. `baselineDigest` and `candidateDigest`
are the hashes of the two root files, and the semantic digests are the hashes
of the pointers without the snapshot identifier, so the same data under
another release name has the same semantic digest. The
default limits are 10%/2,500 changed, 2%/500 added, and 0.25%/50 removed
features; crossing either bound blocks. Operators adjust these reviewed source
constants in `src/diff.ts`, not with a command-line bypass. Bootstrap and
namespace changes also require approval. Every approval binds the exact
baseline and candidate tree SHA-256 digests and includes a review reason; stale
approvals fail. This is the approval publication uses. The Freshness pull
request gate has its own reviewed approvals, which bind the report's
`baselineSemanticDigest` and `semanticDigest` instead, so they survive the
rerun after a rebase; see
[Approving a blocked BCD update](../../docs/planning/06-phase5-freshness.md#approving-a-blocked-bcd-update).
Schema and contract errors cannot be approved. Browser release
metadata changes are reported but do not independently block routine refreshes.

The measured BCD 8.0.13→8.1.3 output delta and complexity model are recorded in
[`docs/planning/06-phase5-output-diff.md`](../../docs/planning/06-phase5-output-diff.md).
