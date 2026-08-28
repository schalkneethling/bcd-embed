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

const supportStatementCommon = {
  versionRemoved: z.string().min(1).nullable(),
  releaseDate: releaseDateSchema.nullable(),
  removalDate: releaseDateSchema.nullable(),
  isPreview: z.boolean(),
  partialImplementation: z.boolean(),
  flags: z.array(supportFlagSchema),
  notes: z.array(z.string().min(1)),
  implUrls: z.array(z.url()),
};

const knownVersionStatement = {
  versionAdded: normalizedVersionSchema,
  versionAddedIsApproximate: z.boolean(),
};

const unknownVersionStatement = {
  versionAdded: z.union([z.literal(false), z.null()]),
  versionAddedIsApproximate: z.literal(false),
};

const canonicalSupportStatementSchema = z.union([
  z.strictObject({
    ...supportStatementCommon,
    ...knownVersionStatement,
    prefix: z.null(),
    alternativeName: z.null(),
  }),
  z.strictObject({
    ...supportStatementCommon,
    ...unknownVersionStatement,
    prefix: z.null(),
    alternativeName: z.null(),
  }),
]);

const prefixedSupportStatementSchema = z.union([
  z.strictObject({
    ...supportStatementCommon,
    ...knownVersionStatement,
    prefix: z.string().min(1),
    alternativeName: z.null(),
  }),
  z.strictObject({
    ...supportStatementCommon,
    ...unknownVersionStatement,
    prefix: z.string().min(1),
    alternativeName: z.null(),
  }),
]);

const alternativeNameSupportStatementSchema = z.union([
  z.strictObject({
    ...supportStatementCommon,
    ...knownVersionStatement,
    prefix: z.null(),
    alternativeName: z.string().min(1),
  }),
  z.strictObject({
    ...supportStatementCommon,
    ...unknownVersionStatement,
    prefix: z.null(),
    alternativeName: z.string().min(1),
  }),
]);

export const supportStatementSchema = z.union([
  canonicalSupportStatementSchema,
  prefixedSupportStatementSchema,
  alternativeNameSupportStatementSchema,
]);
export type SupportStatement = z.infer<typeof supportStatementSchema>;

const canonicalSupportBranchSchema = z.strictObject({
  canonical: z.literal(true),
  prefix: z.null(),
  alternativeName: z.null(),
  statements: z.array(canonicalSupportStatementSchema).min(1),
});

const prefixedSupportBranchSchema = z.strictObject({
  canonical: z.literal(false),
  prefix: z.string().min(1),
  alternativeName: z.null(),
  statements: z.array(prefixedSupportStatementSchema).min(1),
});

const alternativeNameSupportBranchSchema = z.strictObject({
  canonical: z.literal(false),
  prefix: z.null(),
  alternativeName: z.string().min(1),
  statements: z.array(alternativeNameSupportStatementSchema).min(1),
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

const supportSummaryCommon = {
  releaseDate: releaseDateSchema.nullable(),
  removalDate: releaseDateSchema.nullable(),
  behindFlag: z.boolean(),
  hasNotes: z.boolean(),
};

const summarySchemasForIdentity = <
  Prefix extends z.ZodType<string | null>,
  AlternativeName extends z.ZodType<string | null>,
>(
  prefix: Prefix,
  alternativeName: AlternativeName,
) =>
  z.union([
    z.strictObject({
      ...supportSummaryCommon,
      state: z.literal("unsupported"),
      versionAdded: z.literal(false),
      versionRemoved: z.string().min(1).nullable(),
      partialImplementation: z.boolean(),
      isPreview: z.boolean(),
      prefix,
      alternativeName,
    }),
    z.strictObject({
      ...supportSummaryCommon,
      state: z.literal("unsupported"),
      versionAdded: versionValueSchema,
      versionRemoved: z.string().min(1),
      partialImplementation: z.boolean(),
      isPreview: z.boolean(),
      prefix,
      alternativeName,
    }),
    z.strictObject({
      ...supportSummaryCommon,
      state: z.literal("unknown"),
      versionAdded: z.null(),
      versionRemoved: z.null(),
      partialImplementation: z.boolean(),
      isPreview: z.boolean(),
      prefix,
      alternativeName,
    }),
    z.strictObject({
      ...supportSummaryCommon,
      state: z.literal("preview"),
      versionAdded: normalizedVersionSchema,
      versionRemoved: z.null(),
      partialImplementation: z.boolean(),
      isPreview: z.literal(true),
      prefix,
      alternativeName,
    }),
    z.strictObject({
      ...supportSummaryCommon,
      state: z.literal("partial"),
      versionAdded: normalizedVersionSchema,
      versionRemoved: z.null(),
      partialImplementation: z.literal(true),
      isPreview: z.literal(false),
      prefix,
      alternativeName,
    }),
    z.strictObject({
      ...supportSummaryCommon,
      state: z.literal("supported"),
      versionAdded: normalizedVersionSchema,
      versionRemoved: z.null(),
      partialImplementation: z.literal(false),
      isPreview: z.literal(false),
      prefix,
      alternativeName,
    }),
  ]);

export const supportSummarySchema = z.union([
  summarySchemasForIdentity(z.null(), z.null()),
  summarySchemasForIdentity(z.string().min(1), z.null()),
  summarySchemasForIdentity(z.null(), z.string().min(1)),
]);
export type SupportSummary = z.infer<typeof supportSummarySchema>;

const supportStatementSelectionRank = (statement: SupportStatement): number => {
  const isActive = typeof statement.versionAdded === "string" && statement.versionRemoved === null;
  const hasImplementationIdentity = statement.prefix !== null || statement.alternativeName !== null;
  const isFullySupported = isActive && !statement.isPreview && !statement.partialImplementation;

  if (isFullySupported && !hasImplementationIdentity && statement.flags.length === 0) {
    return statement.notes.length === 0 ? 0 : 1;
  }
  if (isActive && hasImplementationIdentity) return 2;
  if (isActive && statement.partialImplementation) return 3;
  if (isActive && statement.flags.length > 0) return 4;
  return 5;
};

const summaryProjectsStatement = (summary: SupportSummary, statement: SupportStatement): boolean =>
  statement.versionAdded === summary.versionAdded &&
  statement.versionRemoved === summary.versionRemoved &&
  statement.releaseDate === summary.releaseDate &&
  statement.removalDate === summary.removalDate &&
  statement.partialImplementation === summary.partialImplementation &&
  statement.prefix === summary.prefix &&
  statement.alternativeName === summary.alternativeName &&
  statement.isPreview === summary.isPreview &&
  statement.flags.length > 0 === summary.behindFlag &&
  statement.notes.length > 0 === summary.hasNotes;

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

    const statements: SupportStatement[] = [];
    for (const branch of support.branches) {
      statements.push(...(branch.statements as SupportStatement[]));
    }
    const selectedStatement = statements.reduce((selected, candidate) =>
      supportStatementSelectionRank(candidate) < supportStatementSelectionRank(selected)
        ? candidate
        : selected,
    );
    if (!summaryProjectsStatement(support.summary, selectedStatement)) {
      context.addIssue({
        code: "custom",
        path: ["summary"],
        message: "Summary fields must project the highest-precedence branch statement.",
      });
      return;
    }

    const expectedState: SupportState =
      selectedStatement.versionAdded === false || selectedStatement.versionRemoved !== null
        ? "unsupported"
        : selectedStatement.versionAdded === null
          ? "unknown"
          : selectedStatement.isPreview
            ? "preview"
            : selectedStatement.partialImplementation
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
  error: z.discriminatedUnion("code", [
    z.strictObject({
      code: z.literal([
        "invalid_key",
        "feature_not_found",
        "namespace_not_queryable",
        "snapshot_not_found",
      ]),
      message: z.string().min(1),
      query: z.string().min(1),
    }),
    z.strictObject({
      code: z.literal(["rate_limited", "generation_in_progress"]),
      message: z.string().min(1),
      query: z.null(),
    }),
  ]),
});
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
