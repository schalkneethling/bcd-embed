import { compareOutputTrees } from "../packages/generator/dist/index.js";

const usage = "Usage: compare-freshness-output --baseline <directory> --candidate <directory>";
const values = new Map();
const options = new Set(["--baseline", "--candidate"]);
for (let index = 2; index < process.argv.length; index += 2) {
  const option = process.argv[index];
  const value = process.argv[index + 1];
  if (!options.has(option) || values.has(option) || !value || value.startsWith("--"))
    throw new Error(usage);
  values.set(option, value);
}
const baseline = values.get("--baseline");
const candidate = values.get("--candidate");
if (baseline === undefined || candidate === undefined || values.size !== 2) throw new Error(usage);

const report = await compareOutputTrees({ baselineRoot: baseline, candidateRoot: candidate });
process.stdout.write(`${JSON.stringify(report)}\n`);
if (report.blocked.length > 0) process.exitCode = 2;
