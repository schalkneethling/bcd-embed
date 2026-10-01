export {
  BCD_VERSION,
  BCD_SCHEMA_SHA256,
  BcdInputError,
  validateBcdInput,
  validateRawArtifact,
} from "./input.js";
export {
  generateSnapshot,
  GENERATOR_VERSION,
  type GenerateSnapshotOptions,
  type GeneratedSnapshot,
  type GeneratedArtifact,
} from "./generate.js";
export {
  emitGeneratedSnapshot,
  type EmissionResult,
  type EmitGeneratedSnapshotOptions,
} from "./emit.js";
export { createRepresentations, type EncodedArtifact } from "./representations.js";
export {
  compareOutputTrees,
  parseDiffApproval,
  DEFAULT_DIFF_POLICY,
  type CompareOutputTreesOptions,
  type DiffApproval,
  type DiffReport,
} from "./diff.js";
export {
  parseDiffCommand,
  diffUsage,
  type DiffCommand,
  type DiffCommandParseResult,
} from "./diff-cli.js";
export {
  parseGenerateCommand,
  usage as cliUsage,
  type GenerateCommand,
  type GenerateCommandParseResult,
} from "./cli.js";
