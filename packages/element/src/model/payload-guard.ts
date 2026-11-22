import type {
  Feature,
  FeatureResponse,
  SupportSummary,
  SupportTargetSupport,
} from "../contract.js";

/**
 * The checks that stand between an unknown value and the table model. The element bundle carries
 * no Zod (Document 3 section 6), so these are shallow structural checks of the fields the model
 * reads, not a validation of the whole contract. The envelope is checked once, up front. Each
 * feature, each displayed support target, and each displayed support entry is checked by the model
 * as it visits it, so the checks add constant work per visit and never a second pass over the
 * payload. A `browsers` entry for a target that the table does not display is never read, so it is
 * never checked either.
 */

/** Why a value is not a payload the table model can read. */
export type TablePayloadErrorReason =
  | "not-an-object"
  | "unsupported-contract"
  | "missing-query"
  | "missing-browsers"
  | "invalid-browser"
  | "no-features"
  | "invalid-feature"
  | "invalid-support"
  | "invalid-content";

/**
 * Thrown when the table model receives a value that is not a contract-conformant payload. The
 * element reports it as the `invalid-payload` reason of its `bcd-error` event. The message is the
 * reason, followed by the offending value or path where there is one.
 */
export class TablePayloadError extends Error {
  readonly reason: TablePayloadErrorReason;

  constructor(reason: TablePayloadErrorReason, detail?: string, options?: ErrorOptions) {
    super(detail === undefined ? reason : `${reason}: ${detail}`, options);
    this.name = "TablePayloadError";
    this.reason = reason;
  }
}

/**
 * A support summary at any contract 1.x version. Contract 1.0.0 has no `versionAddedIsApproximate`
 * on the summary, and contract 1.1.0 added it (Document 1 section 7), so the model reads it as
 * optional.
 */
export type TableModelSummary = Omit<SupportSummary, "versionAddedIsApproximate"> & {
  readonly versionAddedIsApproximate?: boolean;
};

/** A support entry whose summary may come from any contract 1.x version. */
export type TableModelSupport = Omit<SupportTargetSupport, "summary"> & {
  readonly summary: TableModelSummary;
};

/** A feature whose support entries may come from any contract 1.x version. */
export type TableModelFeature = Omit<Feature, "support"> & {
  readonly support: Readonly<Record<string, TableModelSupport>>;
};

/**
 * A feature response at any contract 1.x version. A 1.1.0 `FeatureResponse` is assignable to it,
 * and so is a 1.0.0 payload, whose summaries lack `versionAddedIsApproximate`.
 */
export type TableModelPayload = Omit<FeatureResponse, "contract" | "features"> & {
  readonly contract: string;
  readonly features: readonly TableModelFeature[];
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A full contract version: 1, a minor, and a patch, each a number without leading zeros. A
 * pre-release or build suffix, a missing part, and a fourth part do not match.
 */
const CONTRACT_1X = /^1\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

const SUPPORT_STATES: ReadonlySet<unknown> = new Set([
  "unsupported",
  "unknown",
  "preview",
  "partial",
  "supported",
]);

/**
 * Checks the envelope: an object with a contract 1.x version, a query, a `browsers` object, and
 * at least one feature. Any `1.minor.patch` version passes, because a minor version only adds
 * optional fields (Document 1 section 7). O(1) time and space.
 *
 * @throws {TablePayloadError} when the value is not a payload envelope the model can read.
 */
export function assertTableModelPayload(value: unknown): asserts value is TableModelPayload {
  if (!isRecord(value)) throw new TablePayloadError("not-an-object");
  const { contract, query, browsers, features } = value;
  if (typeof contract !== "string" || !CONTRACT_1X.test(contract)) {
    throw new TablePayloadError("unsupported-contract", String(contract));
  }
  if (typeof query !== "string" || query === "") throw new TablePayloadError("missing-query");
  if (!isRecord(browsers)) throw new TablePayloadError("missing-browsers");
  if (!Array.isArray(features) || features.length === 0) {
    throw new TablePayloadError("no-features");
  }
}

/**
 * Checks the fields of one displayed `browsers` entry that the model formats: a non-empty `name`,
 * and a `previewName` that is absent, null, or a non-empty string. The entry's `type` is not
 * checked, because an unknown type is a valid input that selects the "Other" group. O(1) time and
 * space.
 *
 * @throws {TablePayloadError} when the entry is not an object or its names are unusable.
 */
export function assertTableModelBrowser(value: unknown, id: string): void {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    value.name === "" ||
    (value.previewName !== undefined &&
      value.previewName !== null &&
      (typeof value.previewName !== "string" || value.previewName === ""))
  ) {
    throw new TablePayloadError("invalid-browser", `browsers.${id}`);
  }
}

/**
 * Checks the fields of one feature that the model reads. The `key` and `name` are non-empty, and
 * `name` is the last dot-separated segment of `key` (so it holds no dot), which is how the contract derives it (the
 * name of `javascript.builtins.Array.from` is `from`). The model names a nested row's parent by
 * cutting `name` off the end of `key`, so a `name` that is not that segment would produce a wrong
 * "part of" text with no sign of the fault. The guard rejects such a feature, as it rejects a depth
 * that skips a level, instead of falling back to a guess. O(1) time and space.
 *
 * @throws {TablePayloadError} when the feature lacks a name, a depth, or a support object, or
 * when its name does not end its key.
 */
export function assertTableModelFeature(
  value: unknown,
  index: number,
): asserts value is TableModelFeature {
  if (
    !isRecord(value) ||
    typeof value.key !== "string" ||
    typeof value.name !== "string" ||
    value.key === "" ||
    value.name === "" ||
    value.name.includes(".") ||
    !(value.key === value.name || value.key.endsWith(`.${value.name}`)) ||
    !Number.isInteger(value.depth) ||
    (value.depth as number) < 0 ||
    !isRecord(value.support)
  ) {
    throw new TablePayloadError("invalid-feature", `features[${index}]`);
  }
}

/**
 * Checks the fields of one support entry that the model reads: a summary with a known state, and
 * a non-empty list of branches. O(1) time and space.
 *
 * @throws {TablePayloadError} when the entry lacks a summary state or its branches.
 */
export function assertTableModelSupport(
  value: unknown,
  featureKey: string,
  target: string,
): asserts value is TableModelSupport {
  if (
    !isRecord(value) ||
    !isRecord(value.summary) ||
    !SUPPORT_STATES.has(value.summary.state) ||
    !Array.isArray(value.branches) ||
    value.branches.length === 0
  ) {
    throw new TablePayloadError("invalid-support", `${featureKey} ${target}`);
  }
}
