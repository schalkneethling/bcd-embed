#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { compareOutputTrees, parseDiffApproval } from "./diff.js";
import { diffUsage, parseDiffCommand } from "./diff-cli.js";

const main = async (): Promise<void> => {
  const command = parseDiffCommand(process.argv.slice(2));
  if (command.type === "help") {
    process.stdout.write(`${diffUsage}\n`);
    return;
  }
  let approval: unknown;
  if (command.approvalPath !== undefined) {
    const bytes = await readFile(command.approvalPath, "utf8");
    try {
      approval = parseDiffApproval(JSON.parse(bytes) as unknown);
    } catch (cause) {
      throw new Error(`Invalid approval file '${command.approvalPath}'.`, { cause });
    }
  }
  const report = await compareOutputTrees({
    baselineRoot: command.baselineRoot,
    candidateRoot: command.candidateRoot,
    ...(approval === undefined ? {} : { approval }),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.blocked.length > 0 && !report.approved) process.exitCode = 1;
};

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown error.";
  process.stderr.write(`bcd-embed-diff: ${message}\n`);
  process.exitCode = 1;
}
