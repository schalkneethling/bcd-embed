# `@bcd-embed/publisher`

For an overview with diagrams of what is published and how, read [How publication works](../../apps/website/src/content/docs/publication.md) first. This page is the reference for the command and its limits.

Private, Node-only R2 publication tool. It does not run in the public Worker. Nothing here creates an R2 bucket, configures a Worker, or executes a remote write without the explicit CLI opt-in below.

## What a publication does

The publisher uploads only what the live snapshot does not already have. The design is described in [Document 8](../../docs/planning/08-incremental-publication.md); this is the sequence the command follows.

1. **Check the candidate.** It reads the local folder that `bcd-embed-generate` wrote and verifies all of it: every pointer resolves to a blob whose bytes hash to its name, both compressed copies decode to those bytes, every body matches its schema, the indexes cover exactly the feature keys, and the folder holds no other file.
2. **Read the live snapshot's pointers.** It reads `v1/meta.json`, then the current snapshot's root and the shards the root names. That is at most 258 reads, and no blob is downloaded.
3. **Compare pointers.** A feature counts as changed when the hash of its normalized file or of its raw file differs. The comparison produces the diff report and the review gate's decision.
4. **Reserve the snapshot identifier** with an immutable marker under `v1/_publication/`.
5. **Upload the missing blobs.** Each write succeeds only if the name is unused, and each object is read back and verified. A refused write means the object already exists, and the read-back verifies that copy instead.
6. **Upload the new shards and the root.**
7. **Repeat the gate, then switch `v1/meta.json`** with one compare-and-swap. Nothing is live before this step.
8. **Clean up** blobs, shards and roots that no retained snapshot uses, and compressed copies of metadata that is no longer current.

The command prints one JSON line with what it uploaded, what it deleted, and how many R2 operations the run made.

## Local review (no R2 calls)

Generate a candidate with `@bcd-embed/generator` and keep an earlier generated folder as the baseline. For a first publication, the baseline must be an existing empty folder. After building this workspace:

```sh
node packages/publisher/dist/bin.js --baseline-root /path/to/baseline --candidate-root /path/to/candidate
```

The command checks both folders as in step 1, compares their pointers, and prints the diff report as JSON. Exit 2 means the review policy blocked publication; exit 1 means invalid input or a runtime failure.

A blocked diff needs an approval file that a person has reviewed. It holds the report's exact `baselineDigest` and `candidateDigest`, `approved: true`, and a `reason` of at least eight characters. Each digest is the SHA-256 hash of a snapshot's root file, which covers the snapshot's identifier and every pointer in it. The root holds no timestamp, so generating the same data again gives the same digest. An approval is bound to those two digests; it does not relax the policy.

## Remote publication (operator-only)

Prerequisites: an existing private R2 bucket, scoped R2 S3 credentials, an approval when the gate requires one, and the deployment, security and monitoring acceptance checks in `docs/planning/`. Keep real account IDs, bucket names, keys and approval files out of the repository.

```sh
R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… node packages/publisher/dist/bin.js \
  --candidate-root /path/to/candidate \
  --approval-file /path/to/reviewed-approval.json \
  --execute-remote-write --account-id <32-lowercase-hex-account-id> --bucket <existing-bucket>
```

The remote command takes no `--baseline-root`, because its baseline is the live snapshot in R2. Omit `--approval-file` only when the gate reports no blockers. To see the report and its digests before approving, call `comparePublication({ store, candidateRoot })`, which reads from R2 and writes nothing; `scripts/report-publication-diff.mjs` does this in the publish workflow.

**Reruns.** An interrupted run leaves objects that nothing points to yet. Running the same candidate again finds them, verifies them, and continues. `readPublicationReservation(store, snapshotId)` returns the reserved `{ version: 1, snapshotId, candidateDigest, generated, expires }`, or `null`. A rerun must generate with the reserved timestamps, because the marker refuses different ones, and a changed candidate cannot reuse a reserved snapshot identifier.

**Retries.** Uploads send buffers, not streams, so a request that fails in transit or times out is sent again with the same bytes, up to three attempts. An object that reads back with the wrong bytes is an integrity failure and is not retried.

**Compressed copies.** A compressed copy is named by the hash of the plain bytes. A copy stored by another zlib or Brotli build can therefore differ in its own bytes, and it is accepted when it decodes to the expected plain bytes.

## Cleanup

`pruneRetiredSnapshots(store, { clock, dryRun })` runs after every publication, and also when the candidate is unchanged.

1. It removes expired snapshots from `v1/meta.json` by compare-and-swap, before any bytes are deleted. The current snapshot is never removed.
2. It reads the root and shards of every snapshot that metadata still lists. Their pointers are the live set. If any of them cannot be read and verified, the run stops and deletes nothing.
3. It lists `v1/blobs/`, `v1/shards/` and `v1/snapshots/`, and deletes what is not live and is older than seven days.

The seven days protect a publication in progress, whose blobs exist before anything points to them. Metadata is read again before each batch of deletes; if it changed, another publication ran at the same time and the run stops. With `dryRun: true` nothing is deleted and the result counts what a real run would delete.

4. It lists `v1/_meta/`, which holds two compressed copies of each `v1/meta.json` that was ever written, named by the hash of its plain bytes. It keeps the pair for the current `meta.json` and deletes the others once they are older than seven days. It skips this step until the current `meta.json` is a day old. The server reads `meta.json` and then the copy its hash names, so a request that read the previous `meta.json` just before a switch still needs the previous copy.

The result counts deletions as `{ blobs, shards, roots, metaCopies }`.

Publication markers under `v1/_publication/` are small and are kept, because a marker permanently reserves its snapshot identifier.

## Bounds

| Limit                      | Value                                             |
| -------------------------- | ------------------------------------------------- |
| One file                   | 16 MiB (the largest in BCD 8.1.8 is 3.4 MB)       |
| A candidate, all encodings | 2 GiB (BCD 8.1.8 is about 0.57 GB)                |
| `v1/meta.json`             | 256 KiB                                           |
| A root                     | 256 KiB                                           |
| A shard                    | 2 MiB (about 17 KB in practice)                   |
| Concurrent uploads         | 32 (`UPLOAD_CONCURRENCY` in `src/concurrency.ts`) |
| One R2 request             | 60 seconds                                        |
| Listing page               | 1,000 keys                                        |

Checking the candidate is O(total bytes), with one file in memory at a time; it took 22 seconds for BCD 8.1.8. Comparing pointers is O(N) for N feature keys and took 3 milliseconds. Uploading costs one write and one read per missing object. Cleanup costs at most 257 reads per retained snapshot and one listing per 1,000 stored objects, and holds one hash per live object in memory.

The optional `clock: () => Date` hook defaults to wall time, must return a finite Date, and is read again before the metadata switch. During a remote write the command prints a progress line to stderr every 5,000 verified objects.

## Launch status

No publication in this layout has run against R2 yet. The first live attempt, on 10 November 2026, used the earlier design that uploaded all 125,640 objects of a snapshot, and it did not finish; [Document 8](../../docs/planning/08-incremental-publication.md) records why. The bucket still holds about 81,300 objects from that attempt, which step 6 of that document removes. Public launch additionally requires verified compressed-wire strong ETags, operational alerting through Sentry, and live bandwidth and rate protections.
