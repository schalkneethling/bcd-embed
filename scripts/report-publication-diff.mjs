import { comparePublication } from "../packages/publisher/dist/index.js";
import { storeFromEnvironment } from "./publication-store.mjs";

const candidateRoot = process.argv[2];
if (candidateRoot === undefined || process.argv.length !== 3) {
  throw new Error("Usage: report-publication-diff <candidate-directory>");
}

// Read-only: checks the local candidate, reads the live snapshot's root and shards from R2, and
// prints the comparison. Its two digests are what the publication approval must name.
const { report } = await comparePublication({ candidateRoot, store: storeFromEnvironment() });
process.stdout.write(`${JSON.stringify(report)}\n`);
if (report.blocked.length > 0) process.exitCode = 2;
