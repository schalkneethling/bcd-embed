# @bcd-embed/generator

Node-only generation foundation. No filesystem writes, CLI, deployment, or
`current` alias changes at this stage.

`generateSnapshot({ generated, expires, data? })` returns snapshot metadata,
namespace names, and a single-use lazy `Iterable<GeneratedArtifact>`. The default
input is exact BCD 8.0.13; optional input must satisfy the same published schema
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
[public.schema.json at v8.0.13](https://github.com/mdn/browser-compat-data/blob/b6e8a038045c0511a024093a07ee95ae4dad58f0/schemas/public.schema.json),
commit `b6e8a038045c0511a024093a07ee95ae4dad58f0`, licensed CC0-1.0 by upstream.
The repository schema copy retains upstream text and rules; only whitespace
formatting changes. SHA-256 of `JSON.stringify(JSON.parse(schema))`:

`073720627a01805c003aa5c198127512c8aa303466a35327effc99d94ebb5a2a`

The compiled draft-07 aggregate and identifier validators use this public
schema unchanged. Source-file schemas are deliberately not used: they accept
`mirror` and lack generated `source_file`/`version_last` fields. Public
aggregate data resolves mirrors and requires `source_file`. Ajv recognizes
the upstream `tsType` annotation as non-validating while enforcing strict
validation keywords; it does not coerce, remove, or default input data.
Ajv's strictRequired schema lint is disabled because upstream conditional
requirements reference fields declared on an enclosing object; the actual
required-field validation is unchanged. Formats use the same fast mode as
[upstream's validator](https://github.com/mdn/browser-compat-data/blob/b6e8a038045c0511a024093a07ee95ae4dad58f0/scripts/lib/ajv.js),
which deliberately accepts Unicode specification anchors such as ①.
There is no schema fetch or network access at runtime.

An upgrade must review upstream public schema and normalizer compatibility,
update the exact dependency/version pin and reviewed schema fingerprint, and
run all gates. Changing only a dependency version fails closed.
