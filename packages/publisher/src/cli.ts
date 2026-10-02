import { PublisherError } from "./errors.js";
export const usage = `Usage: bcd-embed-publish --baseline-root <directory> --candidate-root <directory> [--approval-file <json>] [--execute-remote-write --account-id <id> --bucket <name>]

Without --execute-remote-write, validate and report locally without contacting R2.
Remote writes require R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY environment variables.`;

export type PublishCommand = {
  baselineRoot: string;
  candidateRoot: string;
  approvalFile?: string;
  remote?: { accountId: string; bucket: string };
};

const valueOptions = new Set([
  "--baseline-root",
  "--candidate-root",
  "--approval-file",
  "--account-id",
  "--bucket",
]);

/** Complete publisher CLI grammar; unknown, repeated, and partial options fail closed. */
export const parsePublishCommand = (args: readonly string[]): PublishCommand | { type: "help" } => {
  if (args.length === 1 && ["--help", "-h"].includes(args[0]!)) return { type: "help" };
  const values = new Map<string, string>();
  let execute = false;
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]!;
    if (option === "--execute-remote-write") {
      if (execute) throw new PublisherError(`Repeated '${option}'.\n${usage}`);
      execute = true;
      continue;
    }
    if (!valueOptions.has(option) || values.has(option)) {
      throw new PublisherError(`Unknown or repeated argument.\n${usage}`);
    }
    const value = args[++index];
    if (value === undefined || value.length === 0 || value.startsWith("--")) {
      throw new PublisherError(`Argument '${option}' requires a value.\n${usage}`);
    }
    values.set(option, value);
  }
  const baselineRoot = values.get("--baseline-root");
  const candidateRoot = values.get("--candidate-root");
  if (baselineRoot === undefined || candidateRoot === undefined) {
    throw new PublisherError(`Baseline and candidate roots are required.\n${usage}`);
  }
  const accountId = values.get("--account-id");
  const bucket = values.get("--bucket");
  if (
    (execute && (accountId === undefined || bucket === undefined)) ||
    (!execute && (accountId !== undefined || bucket !== undefined))
  ) {
    throw new PublisherError(
      `Remote account and bucket require explicit --execute-remote-write.\n${usage}`,
    );
  }
  return {
    baselineRoot,
    candidateRoot,
    approvalFile: values.get("--approval-file"),
    remote: execute ? { accountId: accountId!, bucket: bucket! } : undefined,
  };
};
