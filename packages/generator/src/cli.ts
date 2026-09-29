import { generatedTimestampSchema, releaseDateSchema } from "@bcd-embed/schema";

export const usage = `Usage: bcd-embed-generate --out <directory> --generated <timestamp> --expires <date>

Emit a local candidate artifact tree. The timestamp must be an ISO 8601 UTC
timestamp and the expiration date must be an ISO 8601 calendar date.`;

export type GenerateCommand = {
  expires: string;
  generated: string;
  outputRoot: string;
  type: "generate";
};

export type GenerateCommandParseResult = GenerateCommand | { type: "help" };

const expectedOptions = new Set(["--out", "--generated", "--expires"]);

/** Defines the complete CLI grammar used by the executable and its documentation. */
export const parseGenerateCommand = (arguments_: readonly string[]): GenerateCommandParseResult => {
  if (arguments_.length === 1 && ["--help", "-h"].includes(arguments_[0] ?? "")) {
    return { type: "help" };
  }

  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 1) {
    const option = arguments_[index];
    if (!expectedOptions.has(option ?? "")) {
      throw new Error(`Unknown argument '${option ?? ""}'.\n${usage}`);
    }
    if (values.has(option!))
      throw new Error(`Argument '${option}' may only be provided once.\n${usage}`);
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Argument '${option}' requires a value.\n${usage}`);
    }
    values.set(option!, value);
    index += 1;
  }

  const outputRoot = values.get("--out");
  const generated = values.get("--generated");
  const expires = values.get("--expires");
  if (outputRoot === undefined || generated === undefined || expires === undefined) {
    throw new Error(`--out, --generated, and --expires are required.\n${usage}`);
  }
  if (outputRoot.length === 0) throw new Error(`--out must not be empty.\n${usage}`);
  if (!generatedTimestampSchema.safeParse(generated).success) {
    throw new Error(`--generated must be an ISO 8601 UTC timestamp.\n${usage}`);
  }
  if (!releaseDateSchema.safeParse(expires).success) {
    throw new Error(`--expires must be an ISO 8601 calendar date.\n${usage}`);
  }
  return { type: "generate", outputRoot, generated, expires };
};
