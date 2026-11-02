import { readFile } from "node:fs/promises";

import { compareOutputTrees } from "../packages/generator/dist/index.js";
import { findReviewApproval, parseReviewApprovals } from "./freshness-policy.mjs";

const usage =
  "Usage: compare-freshness-output --baseline <directory> --candidate <directory> [--approvals <json-file>]";
const values = new Map();
const options = new Set(["--baseline", "--candidate", "--approvals"]);
for (let index = 2; index < process.argv.length; index += 2) {
  const option = process.argv[index];
  const value = process.argv[index + 1];
  if (!options.has(option) || values.has(option) || !value || value.startsWith("--"))
    throw new Error(usage);
  values.set(option, value);
}
const baseline = values.get("--baseline");
const candidate = values.get("--candidate");
const approvalsPath = values.get("--approvals");
if (baseline === undefined || candidate === undefined) throw new Error(usage);

// Parse approvals before the slow comparison so a malformed file fails fast.
const approvals =
  approvalsPath === undefined
    ? []
    : parseReviewApprovals(JSON.parse(await readFile(approvalsPath, "utf8")));
const report = await compareOutputTrees({ baselineRoot: baseline, candidateRoot: candidate });
// A reviewed approval passes this PR gate only. Publication still requires its own
// exact-digest approval of the protected candidate tree.
const reviewApproval = report.blocked.length > 0 ? findReviewApproval(report, approvals) : null;
process.stdout.write(`${JSON.stringify({ ...report, reviewApproval })}\n`);
if (report.blocked.length > 0 && reviewApproval === null) process.exitCode = 2;
