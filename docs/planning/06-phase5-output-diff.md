# Phase 5 — semantic output-diff gate

This gate compares emitted artifact trees, not BCD source trees. It validates
the candidate and baseline contract first, then compares public identity JSON
one file at a time. Invalid JSON, schema failures, envelope mismatches, missing
or duplicate feature/raw pairs, and incomplete global or namespace indexes are
hard errors; an approval cannot make an invalid tree pass.

## What counts as a semantic change

Object properties are hashed in sorted-key order; array order remains
significant. The contract version and every data field remain significant.
Only generation/source provenance is normalized: `generated`, source version,
derived snapshot IDs and generator version, and snapshot expiry. This lets
equivalent support output compare equal when release or generation metadata
changes, without hiding contract or support-data changes. Raw BCD feature
subtrees are included in each feature's semantic digest, so a raw-output change
is visible even if normalization projects the same support summary.

The report includes added, removed, and changed feature counts; browser
metadata change presence; added/removed index keys; changed index shard count;
and namespace changes. Routine browser release metadata changes are reported,
not independently blocked. Namespace adds/removals require review. Contract or
schema mismatches fail before the magnitude gate.

## Reviewed magnitude policy

The operator-adjustable defaults are:

| Change | Percentage limit | Absolute cap |
| --- | ---: | ---: |
| Changed features | 10% | 2,500 |
| Added features | 2% | 500 |
| Removed features | 0.25% | 50 |

Crossing either a percentage limit or its absolute cap blocks the gate. Changed
percentage uses the larger baseline/candidate feature count as denominator;
additions use candidate count and removals use baseline count. These are
reviewable policy defaults, not claims about an upstream guarantee.

The observed full-volume comparison from BCD 8.0.13 to 8.1.3 covered multiple
releases, not a single routine update. It found 20,359 baseline and 20,647
candidate features: 1,813 changed (8.781%), 321 added (1.555%), and 33 removed
(0.162%). There were 9 changed index shards, no namespace changes, and browser
metadata changed. The identity-only trees used for this comparison contained
40,733 and 41,309 logical artifacts, respectively; this is a semantic
comparison baseline, not the physical representation-file count.
Eight of the twelve namespace shards and the global index changed.
Those measured values fit under the defaults above with limited headroom; a
larger update still blocks for review.

## Representation inventory

Historical identity-only trees remain valid inputs. A tree containing any
compressed representation must also contain `.bcd-embed-manifest.json`. The
gate validates that manifest with `@bcd-embed/schema`, checks its snapshot ID,
and compares every declared representation's path, size, and SHA-256 against
the first filesystem pass. The manifest inventory must exactly equal the
on-disk file inventory (excluding the manifest itself); unlisted files,
missing files, or compressed bytes without a manifest fail before semantic
comparison. Semantic comparison hashes identity JSON only, while exact tree
approval digests cover every file and the manifest.

## Approval and bootstrap

The CLI accepts an optional strict JSON approval with exactly these fields:

```json
{
  "baselineDigest": "<64 lowercase hex SHA-256 characters>",
  "candidateDigest": "<64 lowercase hex SHA-256 characters>",
  "approved": true,
  "reason": "A human-readable review reason"
}
```

The approval binds to SHA-256 digests of the exact sorted paths and bytes in
both trees, including the representation manifest when present. A changed
timestamp, representation, or file invalidates it. There
is no force flag or threshold override on the CLI. The approval file must come
from a trusted reviewed workflow; a report object is not an approval. A
bootstrap is represented by an existing empty baseline directory and always
requires this digest-bound approval. The report retains the blocked reasons
alongside its approval state for audit, and `semanticChanged` is true for a
bootstrap so the publisher cannot mistake it for a no-op.

From the repository root after build:

```sh
node packages/generator/dist/diff-bin.js --baseline artifacts-before --candidate artifacts-after
node packages/generator/dist/diff-bin.js --baseline artifacts-before --candidate artifacts-after --approval reviewed-approval.json
```

## Complexity and limits

The gate does not load the BCD aggregate. It keeps a sorted physical file-path
inventory, size/digest measurements, feature keys/digests, and index coverage
sets while parsing and hashing one identity JSON artifact at a time. Peak
payload memory is bounded by the largest individual artifact plus
the path/key indexes: `O(A + K + M)`, where `A` is physical file count, `K` is
the number of feature/index keys, and `M` is the largest parsed artifact.
Time is `O(B + A log A + K log K + Σ sᵢ log sᵢ)`: `B` is total emitted bytes,
path and key collections are sorted for deterministic digests, and each JSON
object's keys are sorted while canonical hashing. Metadata is read first to
identify the snapshot, then the inventory is traversed once; each artifact's
exact approval digest and semantic checks use the same bytes. Total I/O remains
`O(B)` and no payload tree is accumulated.

This layer only validates and compares candidate output. Freshness scheduling,
publishing, alias changes, pruning, and alert delivery remain separate
orchestration work.
