#!/usr/bin/env node
import { lstat, readFile } from "node:fs/promises";

import { compareOutputTrees, parseDiffApproval } from "@bcd-embed/generator";

import { parsePublishCommand, usage } from "./cli.js";
import { PublisherError, formatPublisherError } from "./errors.js";
import { publishCandidate } from "./publish.js";
import { createR2S3Store } from "./r2-s3.js";
import { validateCandidate } from "./validate.js";

const loadApproval = async (path: string | undefined) => {
  if (path === undefined) return undefined;
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4_096) {
    throw new PublisherError("Approval must be a bounded regular JSON file.");
  }
  return parseDiffApproval(JSON.parse(await readFile(path, "utf8")));
};

const main = async (): Promise<void> => {
  const command = parsePublishCommand(process.argv.slice(2));
  if ("type" in command) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  const approval = await loadApproval(command.approvalFile);
  if (command.remote === undefined) {
    await validateCandidate(command.candidateRoot);
    const report = await compareOutputTrees({
      baselineRoot: command.baselineRoot,
      candidateRoot: command.candidateRoot,
      approval,
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (report.blocked.length > 0 && !report.approved) process.exitCode = 2;
    return;
  }
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new PublisherError(
      "R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are required for remote writes.",
    );
  }
  const store = createR2S3Store({
    ...command.remote,
    accessKeyId,
    secretAccessKey,
  });
  const result = await publishCandidate({
    baselineRoot: command.baselineRoot,
    candidateRoot: command.candidateRoot,
    approval,
    store,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

try {
  await main();
} catch (error) {
  // No SDK error details, request IDs, paths, or credentials are echoed.
  process.stderr.write(`bcd-embed-publish: ${formatPublisherError(error)}\n`);
  process.exitCode = 1;
}
