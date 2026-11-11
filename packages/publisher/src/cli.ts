import { PublisherError } from "./errors.js";
export const usage = `Usage: bcd-embed-publish --candidate-root <directory> [--baseline-root <directory>] [--approval-file <json>] [--execute-remote-write --account-id <id> --bucket <name>]

Without --execute-remote-write, compare the candidate with --baseline-root locally and report,
without contacting R2. With it, the baseline is the live snapshot read from R2, so
--baseline-root is not accepted.
Remote writes require R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY environment variables.`;

export type PublishCommand =
  | { candidateRoot: string; approvalFile?: string; baselineRoot: string; remote?: undefined }
  | {
      candidateRoot: string;
      approvalFile?: string;
      baselineRoot?: undefined;
      remote: { accountId: string; bucket: string };
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
  if (candidateRoot === undefined) {
    throw new PublisherError(`A candidate root is required.\n${usage}`);
  }
  const accountId = values.get("--account-id");
  const bucket = values.get("--bucket");
  const approvalFile = values.get("--approval-file");
  if (!execute) {
    if (accountId !== undefined || bucket !== undefined) {
      throw new PublisherError(
        `Remote account and bucket require explicit --execute-remote-write.\n${usage}`,
      );
    }
    if (baselineRoot === undefined) {
      throw new PublisherError(`A local comparison requires --baseline-root.\n${usage}`);
    }
    return { baselineRoot, candidateRoot, approvalFile };
  }
  if (accountId === undefined || bucket === undefined) {
    throw new PublisherError(
      `Remote account and bucket require explicit --execute-remote-write.\n${usage}`,
    );
  }
  if (baselineRoot !== undefined) {
    throw new PublisherError(
      `--baseline-root is not accepted with --execute-remote-write.\n${usage}`,
    );
  }
  return { candidateRoot, approvalFile, remote: { accountId, bucket } };
};
