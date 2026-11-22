/**
 * The API contract's feature response, written out as plain types.
 *
 * `@bcd-embed/schema` defines these types with Zod (`z.infer`), and it is a private workspace
 * package. The element's source imports the contract from this file instead, so the published
 * declarations name no package that a consumer cannot install, and no Zod type. The two copies
 * must agree: `tests/contract.test.ts` checks that each type here and its namesake in
 * `@bcd-embed/schema` are assignable to each other, so `pnpm typecheck` fails when the schema
 * changes and this file does not.
 *
 * Only the types the feature response reaches are here. The runtime checks the schema applies on
 * top of these shapes (string patterns, minimum lengths, a summary that projects its statements)
 * are not types, so they are not repeated.
 */

/** The contract version that the feature response carries. */
export type ContractVersion = "1.1.0";

/** The kind of platform a support target is. */
export type SupportTargetType = "desktop" | "mobile" | "xr" | "server";

/** A support target's summarized state. */
export type SupportState = "unsupported" | "unknown" | "preview" | "partial" | "supported";

/** A preference or runtime flag that must be set for a statement's support to apply. */
export type SupportFlag = {
  type: "preference" | "runtime_flag";
  name: string;
  valueToSet: string | null;
};

type SupportStatementCommon = {
  versionRemoved: string | null;
  versionRemovedIsApproximate: boolean;
  versionLast: string | null;
  versionLastIsApproximate: boolean;
  releaseDate: string | null;
  removalDate: string | null;
  isPreview: boolean;
  partialImplementation: boolean;
  flags: SupportFlag[];
  notes: string[];
  implUrls: string[];
};

/** A statement or summary whose `versionAdded` is a version string. */
type KnownVersion = {
  versionAdded: string;
  versionAddedIsApproximate: boolean;
};

/** A statement or summary with no version: `false` (never added) or `null` (unknown). */
type UnknownVersion = {
  versionAdded: false | null;
  versionAddedIsApproximate: false;
};

/**
 * Which implementation a statement describes: the canonical one (both `null`), a prefixed one, or
 * one under an alternative name.
 */
type Identity<Prefix extends string | null, AlternativeName extends string | null> = {
  prefix: Prefix;
  alternativeName: AlternativeName;
};

type StatementFor<
  Prefix extends string | null,
  AlternativeName extends string | null,
> = SupportStatementCommon & (KnownVersion | UnknownVersion) & Identity<Prefix, AlternativeName>;

/** One BCD support statement, normalized. */
export type SupportStatement =
  | StatementFor<null, null>
  | StatementFor<string, null>
  | StatementFor<null, string>;

/** The statements of one implementation identity. */
export type SupportBranch =
  | { canonical: true; prefix: null; alternativeName: null; statements: StatementFor<null, null>[] }
  | {
      canonical: false;
      prefix: string;
      alternativeName: null;
      statements: StatementFor<string, null>[];
    }
  | {
      canonical: false;
      prefix: null;
      alternativeName: string;
      statements: StatementFor<null, string>[];
    };

type SupportSummaryCommon = {
  releaseDate: string | null;
  removalDate: string | null;
  versionRemovedIsApproximate: boolean;
  behindFlag: boolean;
  hasNotes: boolean;
};

type SummaryFor<
  Prefix extends string | null,
  AlternativeName extends string | null,
> = SupportSummaryCommon &
  Identity<Prefix, AlternativeName> &
  (
    | {
        state: "unsupported";
        versionAdded: false;
        versionAddedIsApproximate: false;
        versionRemoved: string | null;
        partialImplementation: boolean;
        isPreview: boolean;
      }
    | ({
        state: "unsupported";
        versionRemoved: string;
        partialImplementation: boolean;
        isPreview: boolean;
      } & (KnownVersion | UnknownVersion))
    | {
        state: "unknown";
        versionAdded: null;
        versionAddedIsApproximate: false;
        versionRemoved: null;
        partialImplementation: boolean;
        isPreview: boolean;
      }
    | ({
        state: "preview";
        versionRemoved: null;
        partialImplementation: boolean;
        isPreview: true;
      } & KnownVersion)
    | ({
        state: "partial";
        versionRemoved: null;
        partialImplementation: true;
        isPreview: false;
      } & KnownVersion)
    | ({
        state: "supported";
        versionRemoved: null;
        partialImplementation: false;
        isPreview: false;
      } & KnownVersion)
  );

/** The one-cell summary of a support target's statements. */
export type SupportSummary =
  | SummaryFor<null, null>
  | SummaryFor<string, null>
  | SummaryFor<null, string>;

/** A feature's support in one target: its summary and every statement behind it. */
export type SupportTargetSupport = {
  summary: SupportSummary;
  branches: SupportBranch[];
};

/** A browser or runtime that the response describes. */
export type SupportTarget = {
  name: string;
  type: SupportTargetType;
  previewName: string | null;
};

/** A feature's standards status. */
export type FeatureStatus = {
  experimental: boolean;
  standardTrack: boolean;
  deprecated: boolean;
};

/** One feature: the queried one, or one of its subfeatures. */
export type Feature = {
  key: string;
  name: string;
  depth: number;
  description: string | null;
  mdnUrl: string | null;
  specUrls: string[];
  status: FeatureStatus | null;
  tags: string[];
  /** Keyed by support target id, such as `chrome`. */
  support: Record<string, SupportTargetSupport>;
};

/** The body of `GET /v1/current/features/{query}.json`. */
export type FeatureResponse = {
  contract: ContractVersion;
  query: string;
  /** Keyed by support target id; describes every target that a feature's `support` names. */
  browsers: Record<string, SupportTarget>;
  features: Feature[];
};
