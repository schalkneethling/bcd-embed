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
  createPointerTree,
  describeContentTree,
  emitContentTree,
  shardIndexOf,
  type ContentPointer,
  type ContentTree,
  type DescribeContentTreeOptions,
  type ContentTreeEmission,
  type EmitContentTreeOptions,
  type PointerTree,
  type PointerTreeFile,
} from "./content-tree.js";
export {
  loadContentTree,
  MAX_CONTENT_FILE_BYTES,
  MAX_CONTENT_TREE_BYTES,
  MAX_META_BYTES,
  type LocalContentTree,
} from "./load-content-tree.js";
export {
  compareContentTrees,
  compareOutputTrees,
  EMPTY_TREE_DIGEST,
  parseDiffApproval,
  DiffApprovalMismatchError,
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
