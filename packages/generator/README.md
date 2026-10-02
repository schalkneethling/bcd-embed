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

The output filesystem must be case-sensitive. Published BCD keys include
distinct addressable keys that differ only by case (for example, `api.Crypto`
and `api.crypto`), and the contract maps each key directly to its filename.
Typical Linux filesystems meet this requirement; default macOS APFS volumes are
often case-insensitive, so use Linux or a case-sensitive APFS volume there.

It emits compact JSON plus a trailing newline under `v1/meta.json` and
`v1/<snapshot>/{browsers,index,features,raw}`. It is local generation only:
no `v1/current` alias is created or changed. Existing unrelated output is
preserved; byte-identical snapshot and metadata reruns are no-ops, while a
difference fails safely. Files are staged first and an exclusive local lock
prevents concurrent commits. An abrupt process kill can leave a staging
directory or lock; remove either only after confirming no emission is active.
If final metadata rename fails after snapshot rename, an unreferenced snapshot
may remain, but no alias is changed.

`emitGeneratedSnapshot` consumes a validated `generateSnapshot` result. It
checks artifact paths, envelopes, and path-to-payload identity, but does not
deep-parse every payload again; generation already performs those validations.

Emission additionally creates deterministic gzip (level 6) and Brotli (quality 4)
variants. Snapshot variants append `.gz`/`.br`; metadata variants are immutable
`v1/_meta/<identity-meta-sha256>.json.gz`/`.json.br`. Only `v1/meta.json` is mutable
in publication. `createRepresentations(logicalPath, bytes)` exports these exact
bytes and an inventory descriptor with logicalPath, path, encoding, size,
sha256, and quoted SHA-256 etag. Gzip embeds no wall-clock timestamp; identical
inputs/settings/toolchain produce identical bytes.

The local control file `.bcd-embed-manifest.json` uses the schema package's
`artifactManifestSchema` and is returned as `EmissionResult.manifest`. `files`
counts representations plus this control file. Do not upload the control file;
publishers must verify actual bytes and complete logical inventory before use.
Merged retained metadata must be re-encoded before publishing its variants and
the canonical metadata CAS. Representation work is O(sum(Bi)) time and
O(Bmax + K) auxiliary memory, processing one artifact at a time.

`generateSnapshot({ generated, expires, data? })` returns snapshot metadata,
namespace names, and a single-use lazy `Iterable<GeneratedArtifact>`. The default
input is exact BCD 8.1.3; optional input must satisfy the same published schema
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

The grammar is defined in `src/diff-cli.ts`. The gate validates schemas and
index coverage, then compares output JSON with provenance-only normalization;
contract and support data remain significant. It keeps feature/index keys and
digests plus a sorted path inventory, but parses one artifact at a time; each
artifact's exact-byte and semantic digests are derived from the same read. The
default limits are 10%/2,500 changed, 2%/500 added, and 0.25%/50 removed
features; crossing either bound blocks. Operators adjust these reviewed source
constants in `src/diff.ts`, not with a command-line bypass. Bootstrap and
namespace changes also require approval. Every approval binds the exact
baseline and candidate tree SHA-256 digests and includes a review reason; stale
approvals fail. Schema and contract errors cannot be approved. Browser release
metadata changes are reported but do not independently block routine refreshes.

The measured BCD 8.0.13→8.1.3 output delta and complexity model are recorded in
[`docs/planning/06-phase5-output-diff.md`](../../docs/planning/06-phase5-output-diff.md).
