import { deleteLegacySnapshot, summarizeBucket } from "../packages/publisher/dist/index.js";
import { storeFromEnvironment } from "./publication-store.mjs";

const [snapshotId, mode, ...rest] = process.argv.slice(2);
if (snapshotId === undefined || (mode !== undefined && mode !== "--execute") || rest.length > 0) {
  throw new Error("Usage: delete-legacy-snapshot <snapshot-id> [--execute]");
}

// Prints what the bucket holds, then deletes v1/<snapshot-id>/ only with --execute. Without it,
// the run lists and counts and changes nothing. The publisher refuses a snapshot meta.json lists.
const store = storeFromEnvironment();
const before = await summarizeBucket(store);
const result = await deleteLegacySnapshot(store, snapshotId, { dryRun: mode !== "--execute" });
process.stdout.write(`${JSON.stringify({ before: before.groups, ...result })}\n`);
if (result.remaining > 0 && !result.dryRun) process.exitCode = 1;
