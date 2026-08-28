import { z } from "zod";

/** The initial semantic version of the documented API contract. */
export const CONTRACT_VERSION = "1.0.0" as const;

export const contractVersionSchema = z.literal(CONTRACT_VERSION);
export type ContractVersion = z.infer<typeof contractVersionSchema>;

export const generatedTimestampSchema = z.iso.datetime();
export const releaseDateSchema = z.iso.date();
export const featureKeySchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
export const supportTargetIdentifierSchema = z.string().regex(/^[a-z0-9][a-z0-9_]*$/);
export const namespaceSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);

export const sourceSchema = z.strictObject({
  package: z.literal("@mdn/browser-compat-data"),
  version: z.string().min(1),
});
export type Source = z.infer<typeof sourceSchema>;

export const supportTargetTypeSchema = z.enum(["desktop", "mobile", "xr", "server"]);
export type SupportTargetType = z.infer<typeof supportTargetTypeSchema>;

export const releaseStatusSchema = z.enum([
  "retired",
  "current",
  "beta",
  "nightly",
  "esr",
  "planned",
]);
export type ReleaseStatus = z.infer<typeof releaseStatusSchema>;

export const supportStateSchema = z.enum([
  "unsupported",
  "unknown",
  "preview",
  "partial",
  "supported",
]);
export type SupportState = z.infer<typeof supportStateSchema>;

const normalizedVersionSchema = z
  .string()
  .min(1)
  .regex(/^[^≤]+$/);

export const versionValueSchema = z.union([normalizedVersionSchema, z.literal(false), z.null()]);
export type VersionValue = z.infer<typeof versionValueSchema>;

export const supportFlagSchema = z.strictObject({
  type: z.enum(["preference", "runtime_flag"]),
  name: z.string().min(1),
  valueToSet: z.string().min(1).nullable(),
});
export type SupportFlag = z.infer<typeof supportFlagSchema>;

export const supportStatementSchema = z
  .strictObject({
    versionAdded: versionValueSchema,
    versionAddedIsApproximate: z.boolean(),
    versionRemoved: z.string().min(1).nullable(),
    releaseDate: releaseDateSchema.nullable(),
    removalDate: releaseDateSchema.nullable(),
    isPreview: z.boolean(),
    partialImplementation: z.boolean(),
    prefix: z.string().min(1).nullable(),
    alternativeName: z.string().min(1).nullable(),
    flags: z.array(supportFlagSchema),
    notes: z.array(z.string().min(1)),
    implUrls: z.array(z.url()),
  })
  .superRefine((statement, context) => {
    if (statement.versionAddedIsApproximate && typeof statement.versionAdded !== "string") {
      context.addIssue({
        code: "custom",
        path: ["versionAddedIsApproximate"],
        message: "Approximate support requires a normalized version string.",
      });
    }
    if (statement.prefix !== null && statement.alternativeName !== null) {
      context.addIssue({
        code: "custom",
        path: ["alternativeName"],
        message: "A statement cannot have both a prefix and alternative name.",
      });
    }
  });
export type SupportStatement = z.infer<typeof supportStatementSchema>;

const branchStatementsSchema = z.array(supportStatementSchema).min(1);

const canonicalSupportBranchSchema = z.strictObject({
  canonical: z.literal(true),
  prefix: z.null(),
  alternativeName: z.null(),
  statements: branchStatementsSchema,
});

const prefixedSupportBranchSchema = z.strictObject({
  canonical: z.literal(false),
  prefix: z.string().min(1),
  alternativeName: z.null(),
  statements: branchStatementsSchema,
});

const alternativeNameSupportBranchSchema = z.strictObject({
  canonical: z.literal(false),
  prefix: z.null(),
  alternativeName: z.string().min(1),
  statements: branchStatementsSchema,
});

export const supportBranchSchema = z
  .union([
    canonicalSupportBranchSchema,
    prefixedSupportBranchSchema,
    alternativeNameSupportBranchSchema,
  ])
  .superRefine((branch, context) => {
    branch.statements.forEach((statement, index) => {
      if (
        statement.prefix !== branch.prefix ||
        statement.alternativeName !== branch.alternativeName
      ) {
        context.addIssue({
          code: "custom",
          path: ["statements", index],
          message: "Statement identity must match its enclosing branch.",
        });
      }
    });
  });
export type SupportBranch = z.infer<typeof supportBranchSchema>;

export const supportSummarySchema = z
  .strictObject({
    state: supportStateSchema,
    versionAdded: versionValueSchema,
    versionRemoved: z.string().min(1).nullable(),
    releaseDate: releaseDateSchema.nullable(),
    removalDate: releaseDateSchema.nullable(),
    partialImplementation: z.boolean(),
    behindFlag: z.boolean(),
    prefix: z.string().min(1).nullable(),
    alternativeName: z.string().min(1).nullable(),
    isPreview: z.boolean(),
    hasNotes: z.boolean(),
  })
  .superRefine((summary, context) => {
    if (summary.prefix !== null && summary.alternativeName !== null) {
      context.addIssue({
        code: "custom",
        path: ["alternativeName"],
        message: "A summary cannot have both a prefix and alternative name.",
      });
    }
  });
export type SupportSummary = z.infer<typeof supportSummarySchema>;

export const supportTargetSupportSchema = z
  .strictObject({
    summary: supportSummarySchema,
    branches: z.array(supportBranchSchema).min(1),
  })
  .superRefine((support, context) => {
    const identities = support.branches.map((branch) =>
      JSON.stringify([branch.prefix, branch.alternativeName]),
    );
    if (new Set(identities).size !== identities.length) {
      context.addIssue({
        code: "custom",
        path: ["branches"],
        message: "Support branches must have unique implementation identities.",
      });
    }

    const projectedStatement = support.branches
      .flatMap((branch) => branch.statements)
      .find(
        (statement) =>
          statement.versionAdded === support.summary.versionAdded &&
          statement.versionRemoved === support.summary.versionRemoved &&
          statement.releaseDate === support.summary.releaseDate &&
          statement.removalDate === support.summary.removalDate &&
          statement.partialImplementation === support.summary.partialImplementation &&
          statement.prefix === support.summary.prefix &&
          statement.alternativeName === support.summary.alternativeName &&
          statement.isPreview === support.summary.isPreview &&
          statement.flags.length > 0 === support.summary.behindFlag &&
          statement.notes.length > 0 === support.summary.hasNotes,
      );
    if (projectedStatement === undefined) {
      context.addIssue({
        code: "custom",
        path: ["summary"],
        message: "Summary fields must project one statement from the branches.",
      });
      return;
    }

    const expectedState: SupportState =
      projectedStatement.versionAdded === false || projectedStatement.versionRemoved !== null
        ? "unsupported"
        : projectedStatement.versionAdded === null
          ? "unknown"
          : projectedStatement.isPreview
            ? "preview"
            : projectedStatement.partialImplementation
              ? "partial"
              : "supported";
    if (support.summary.state !== expectedState) {
      context.addIssue({
        code: "custom",
        path: ["summary", "state"],
        message: "Summary state must match the projected statement precedence.",
      });
    }
  });
export type SupportTargetSupport = z.infer<typeof supportTargetSupportSchema>;

export const supportTargetSchema = z.strictObject({
  name: z.string().min(1),
  type: supportTargetTypeSchema,
  previewName: z.string().min(1).nullable(),
});
export type SupportTarget = z.infer<typeof supportTargetSchema>;

export const featureStatusSchema = z.strictObject({
  experimental: z.boolean(),
  standardTrack: z.boolean(),
  deprecated: z.boolean(),
});
export type FeatureStatus = z.infer<typeof featureStatusSchema>;

export const featureSchema = z.strictObject({
  key: featureKeySchema,
  name: z.string().min(1),
  depth: z.int().nonnegative(),
  description: z.string().min(1).nullable(),
  mdnUrl: z.url().nullable(),
  specUrls: z.array(z.url()),
  status: featureStatusSchema,
  tags: z.array(z.string().regex(/^[a-z0-9-]+:.+$/)),
  support: z.record(supportTargetIdentifierSchema, supportTargetSupportSchema),
});
export type Feature = z.infer<typeof featureSchema>;

const normalizedResponseEnvelope = {
  contract: contractVersionSchema,
  generated: generatedTimestampSchema,
  source: sourceSchema,
};

export const featureResponseSchema = z
  .strictObject({
    ...normalizedResponseEnvelope,
    query: featureKeySchema,
    browsers: z.record(supportTargetIdentifierSchema, supportTargetSchema),
    features: z.array(featureSchema).min(1),
  })
  .superRefine((response, context) => {
    const referencedTargets = new Set(
      response.features.flatMap((feature) => Object.keys(feature.support)),
    );
    const describedTargets = new Set(Object.keys(response.browsers));

    for (const target of referencedTargets) {
      if (!describedTargets.has(target)) {
        context.addIssue({
          code: "custom",
          path: ["browsers"],
          message: `Missing metadata for referenced support target '${target}'.`,
        });
      }
    }
    for (const target of describedTargets) {
      if (!referencedTargets.has(target)) {
        context.addIssue({
          code: "custom",
          path: ["browsers", target],
          message: `Unreferenced support target '${target}' must not be included.`,
        });
      }
    }
  });
export type FeatureResponse = z.infer<typeof featureResponseSchema>;

export const browserReleaseSchema = z.strictObject({
  version: z.string().min(1),
  releaseDate: releaseDateSchema.nullable(),
  status: releaseStatusSchema,
});
export type BrowserRelease = z.infer<typeof browserReleaseSchema>;

export const browserMetadataSchema = z.strictObject({
  name: z.string().min(1),
  type: supportTargetTypeSchema,
  previewName: z.string().min(1).nullable(),
  releases: z.array(browserReleaseSchema).min(1),
});
export type BrowserMetadata = z.infer<typeof browserMetadataSchema>;

export const browsersResponseSchema = z.strictObject({
  ...normalizedResponseEnvelope,
  browsers: z.record(supportTargetIdentifierSchema, browserMetadataSchema),
});
export type BrowsersResponse = z.infer<typeof browsersResponseSchema>;

export const indexResponseSchema = z.strictObject({
  ...normalizedResponseEnvelope,
  namespace: namespaceSchema.nullable(),
  keys: z.array(featureKeySchema).min(1),
});
export type IndexResponse = z.infer<typeof indexResponseSchema>;

export const snapshotIdentifierSchema = z.string().regex(/^bcd-[A-Za-z0-9.-]+-gen-[A-Za-z0-9.-]+$/);

export const snapshotSchema = z
  .strictObject({
    id: snapshotIdentifierSchema,
    source: sourceSchema,
    generatorVersion: z.string().min(1),
    generated: generatedTimestampSchema,
    expires: releaseDateSchema,
  })
  .superRefine((snapshot, context) => {
    const expectedIdentifier = `bcd-${snapshot.source.version}-gen-${snapshot.generatorVersion}`;
    if (snapshot.id !== expectedIdentifier) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: "Snapshot identifier must encode its BCD and generator versions.",
      });
    }
  });
export type Snapshot = z.infer<typeof snapshotSchema>;

export const metaResponseSchema = z
  .strictObject({
    contract: contractVersionSchema,
    generated: generatedTimestampSchema,
    current: snapshotIdentifierSchema,
    snapshots: z.array(snapshotSchema).min(1),
    namespaces: z.array(namespaceSchema).min(1),
  })
  .superRefine((metadata, context) => {
    const snapshotIds = metadata.snapshots.map((snapshot) => snapshot.id);
    if (!snapshotIds.includes(metadata.current)) {
      context.addIssue({
        code: "custom",
        path: ["current"],
        message: "Current must identify one of the available snapshots.",
      });
    }
    if (new Set(snapshotIds).size !== snapshotIds.length) {
      context.addIssue({
        code: "custom",
        path: ["snapshots"],
        message: "Snapshot identifiers must be unique.",
      });
    }
    if (new Set(metadata.namespaces).size !== metadata.namespaces.length) {
      context.addIssue({
        code: "custom",
        path: ["namespaces"],
        message: "Namespaces must be unique.",
      });
    }
  });
export type MetaResponse = z.infer<typeof metaResponseSchema>;

export const apiErrorCodeSchema = z.enum([
  "invalid_key",
  "feature_not_found",
  "namespace_not_queryable",
  "snapshot_not_found",
  "rate_limited",
  "generation_in_progress",
]);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: apiErrorCodeSchema,
    message: z.string().min(1),
    query: z.string().min(1).nullable(),
  }),
});
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
