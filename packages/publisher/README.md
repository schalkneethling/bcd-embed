# `@bcd-embed/publisher`

Private, Node-only R2 publication tool. It does not run in the public Worker. Nothing here creates an R2 bucket, configures a Worker, or executes a remote write without the explicit CLI opt-in below.

## Local review (no R2 calls)

Generate a complete candidate tree with `@bcd-embed/generator`; keep the prior generated output tree as the baseline. For a first publication, the baseline must be an existing empty directory. After building this workspace:

```sh
node packages/publisher/dist/bin.js --baseline-root /path/to/baseline --candidate-root /path/to/candidate
```

The command validates every manifest entry and encoded variant, independently parses the identity artifacts, verifies that the all-index, namespace shards, feature/raw pairs, browsers, and metadata form a complete tree, then runs the exact output-tree diff gate. It prints the diff report as JSON. Exit 2 means the reviewed policy blocked publication; exit 1 means invalid input or a runtime failure. A blocked diff needs a human-reviewed approval file with the exact baseline and candidate digests, `approved: true`, and a nonblank reason of at least eight characters. Use the diff tool's `parseDiffApproval` grammar; approval is digest-bound, not a policy override.

The API exports `readPublicationReservation(store, snapshotId)`. It returns `null` or the strict, checksum-verified reservation `{ version: 1, snapshotId, candidateDigest, generated, expires }`. Preparation must reuse reserved timestamps for that snapshot ID; the resulting tree must still match the reserved digest. Regeneration with a new wall-clock timestamp cannot resume an older reservation.

`restorePublishedBaseline({ store, outputRoot })` reconstructs the exact original current tree into an existing empty trusted directory. It returns `null` for an unpublished bucket, otherwise `{ root, snapshotId, candidateDigest }`. It never regenerates old data with newer generator or encoder code. The private immutable controls at `v1/_candidates/<snapshotId>/` preserve the original manifest plus singleton metadata and its two encoded variants; snapshot payloads come from their original immutable public object paths. Restore verifies sizes, SHA-256, complete inventory, decoded representations, and the exact published tree digest, then rechecks that current metadata did not change. A failed restore leaves a partial local tree; retry with a fresh empty directory. These private controls are not public API routes and do not depend on GitHub artifact retention.

## Remote publication (operator-only, not automated yet)

Prerequisites: an existing private R2 bucket, scoped R2 S3 credentials, a reviewed local baseline/candidate pair, approved diff when required, and the deployment/security/monitoring acceptance checks in `docs/planning/`. Keep real account IDs, bucket names, keys, and approval files out of the repository. No command in this repository automatically provisions or deploys these resources.

```sh
R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… node packages/publisher/dist/bin.js \
  --baseline-root /path/to/baseline --candidate-root /path/to/candidate \
  --approval-file /path/to/reviewed-approval.json \
  --execute-remote-write --account-id <32-lowercase-hex-account-id> --bucket <existing-bucket>
```

Omit `--approval-file` only when the local gate reports no blockers. The remote command reopens the files and runs the trusted diff gate before upload and immediately before the sole mutable metadata write. It first reserves the snapshot ID with an immutable marker, then uses create-only conditional PUTs for immutable snapshot objects. A colliding object is accepted only if its full bytes, size, and SHA-256 metadata match. The publisher generates publication-specific compressed metadata representations and checks their remote bytes before one conditional compare-and-swap of `v1/meta.json`. It reads the result back. A lost race or a changed local/remote baseline fails closed. Repeating the same candidate resumes verified partial uploads or reports `unchanged`; a changed candidate cannot reuse a reserved snapshot ID, even after pruning.

Published metadata retains unexpired prior snapshots. Retention removes expired non-current membership by metadata CAS before deleting old snapshot-prefix objects and their private candidate controls; a failed deletion can be retried. The current snapshot is never physically pruned. Immutable metadata-variant objects and tiny publication markers are retained; orphan metadata-variant cleanup is a separate operational task because concurrent preuploads must not be deleted. Even on a no-change run, the command performs eligible retention cleanup, which can update metadata without publishing the candidate.

## Bounds and launch status

Validation is O(total artifact bytes + objects), with one identity artifact parsed at a time and bounded decoded output per variant. Upload and restoration concurrency is four; listing/deletion pages are at most 500 keys with strict prefix and progress checks. Source-owned reviewed limits are 16 MiB per identity, 2 GiB total representations plus manifest, 64 MiB manifest, 256 KiB metadata, and 2 MiB index shards. Current measured BCD's largest identity is approximately 3.25 MiB and the representation tree approximately 560 MiB; raising these caps requires source review, not candidate configuration. Memory is O(objects + largest bounded identity), plus bounded stream buffers during four uploads/restorations. The optional `clock: () => Date` publication hook defaults to wall time, must return a finite Date, and is reread before final CAS and pruning eligibility checks. Remote GET/PUT/list/delete operations have a 60-second abort deadline; rejected/unconsumed bodies and all timers are explicitly disposed. Large-dataset publication latency and R2 account-specific behavior still need live acceptance testing. No live deployment, R2 write, or credential use has been performed as part of this implementation. Public launch additionally requires verified compressed-wire strong ETags, operational alerting/Sentry, and live bandwidth/rate protections.
