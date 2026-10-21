export const diffUsage = `Usage: bcd-embed-diff --baseline <directory> --candidate <directory> [--approval <json-file>]

Compare validated emitted artifact trees. A digest-bound approval is required
for bootstrap or changes over the reviewed magnitude policy.`;

export type DiffCommand = {
  approvalPath?: string;
  baselineRoot: string;
  candidateRoot: string;
  type: "diff";
};

export type DiffCommandParseResult = DiffCommand | { type: "help" };

const options = new Set(["--baseline", "--candidate", "--approval"]);

/** Defines the complete CLI grammar used by the executable and its documentation. */
export const parseDiffCommand = (arguments_: readonly string[]): DiffCommandParseResult => {
  if (arguments_.length === 1 && ["--help", "-h"].includes(arguments_[0] ?? "")) {
    return { type: "help" };
  }
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 1) {
    const option = arguments_[index];
    if (!options.has(option ?? ""))
      throw new Error(`Unknown argument '${option ?? ""}'.\n${diffUsage}`);
    if (values.has(option!))
      throw new Error(`Argument '${option}' may only be provided once.\n${diffUsage}`);
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Argument '${option}' requires a value.\n${diffUsage}`);
    }
    values.set(option!, value);
    index += 1;
  }
  const baselineRoot = values.get("--baseline");
  const candidateRoot = values.get("--candidate");
  const approvalPath = values.get("--approval");
  if (baselineRoot === undefined || candidateRoot === undefined) {
    throw new Error(`--baseline and --candidate are required.\n${diffUsage}`);
  }
  if (baselineRoot.length === 0 || candidateRoot.length === 0 || approvalPath === "") {
    throw new Error(`Directory and approval paths must not be empty.\n${diffUsage}`);
  }
  return {
    type: "diff",
    baselineRoot,
    candidateRoot,
    ...(approvalPath === undefined ? {} : { approvalPath }),
  };
};
