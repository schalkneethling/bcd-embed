import { readFile } from "node:fs/promises";

import { parseReviewApprovals } from "./freshness-policy.mjs";

const path = process.argv[2] ?? ".github/freshness-approvals.json";
const approvals = parseReviewApprovals(JSON.parse(await readFile(path, "utf8")));
process.stdout.write(`Validated ${approvals.length} freshness approval(s) in ${path}.\n`);
