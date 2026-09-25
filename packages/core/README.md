# `@bcd-embed/core`

Pure normalization of addressable subtrees from the pinned published BCD package.
The caller supplies a key, its subtree, and browser metadata; the result contains
flattened features and exactly the referenced support targets. Response envelopes,
file I/O, raw-input schema validation, and artifact emission belong to the generator.

## Complexity

For a subtree with `N` identifier nodes, `S` support statements, and output size
`P`, normalization visits each node and statement once before local sorting.
For each target history with `s` statements and `b` implementation branches,
sorting costs `O(s log s + b log b)` comparisons. Version and identity comparisons
also depend on the lengths of their strings; they are not constant-time for
unbounded input. Browser release metadata is looked up directly, without scanning
the release catalog once per feature.

Including strings and metadata copied into the result, memory is `O(P + N + S)`;
the recursive traversal additionally uses stack space proportional to tree depth.
This API targets the finite depth of published BCD, not arbitrary adversarial trees.

Generating a payload for every addressable root intentionally repeats descendants
in overlapping payloads. Total work must therefore be measured against total
emitted output, not only the number of unique BCD nodes. The generator should
discover addressable roots in one traversal and avoid repeated global key searches.

## Validation

The dataset test visits all 20,359 compatibility records in BCD 8.0.13 and checks
each normalized record against the canonical schema, preserving every target.
Each record is normalized once so this test does not repeatedly process overlapping
subtrees. Dedicated subtree and golden tests cover composition and exact values.

Malformed-input tests cover empty/null support, invalid or missing version values,
and non-addressable subtrees. Errors retain the failing feature key and cause.
This is not a replacement for the generator's upstream JSON Schema input gate.

Full emitted-artifact validation and compressed payload sizing remain generator
Phase 3 gates. Wall-clock timing is environment-dependent; deterministic coverage
and complexity bounds are preferable to brittle timing thresholds in unit tests.
