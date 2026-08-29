import { describe, expect, it } from "vitest";

import {
  CONTRACT_VERSION,
  apiErrorResponseSchema,
  browsersResponseSchema,
  featureKeySchema,
  featureResponseSchema,
  indexResponseSchema,
  metaResponseSchema,
  supportBranchSchema,
  supportFlagSchema,
  supportStateSchema,
  supportStatementSchema,
  supportTargetSupportSchema,
  supportTargetTypeSchema,
} from "../src/index.js";

const source = {
  package: "@mdn/browser-compat-data" as const,
  version: "8.0.13",
};

const statement = {
  versionAdded: "1",
  versionAddedIsApproximate: false,
  versionRemoved: null,
  versionRemovedIsApproximate: false,
  versionLast: null,
  versionLastIsApproximate: false,
  releaseDate: "2008-12-11",
  removalDate: null,
  isPreview: false,
  partialImplementation: false,
  prefix: null,
  alternativeName: null,
  flags: [],
  notes: [],
  implUrls: [],
};

const summary = {
  state: "supported" as const,
  versionAdded: "1",
  versionRemoved: null,
  versionRemovedIsApproximate: false,
  releaseDate: "2008-12-11",
  removalDate: null,
  partialImplementation: false,
  behindFlag: false,
  prefix: null,
  alternativeName: null,
  isPreview: false,
  hasNotes: false,
};

const featureResponse = {
  contract: CONTRACT_VERSION,
  generated: "2026-08-28T12:00:00Z",
  source,
  query: "css.properties.display",
  browsers: {
    chrome: {
      name: "Chrome",
      type: "desktop" as const,
      previewName: "Canary",
    },
  },
  features: [
    {
      key: "css.properties.display",
      name: "display",
      depth: 0,
      description: null,
      mdnUrl: "https://developer.mozilla.org/docs/Web/CSS/display",
      specUrls: ["https://drafts.csswg.org/css-display/"],
      status: {
        experimental: false,
        standardTrack: true,
        deprecated: false,
      },
      tags: ["web-features:display"],
      support: {
        chrome: {
          summary,
          branches: [
            {
              canonical: true as const,
              prefix: null,
              alternativeName: null,
              statements: [statement],
            },
          ],
        },
      },
    },
  ],
};

describe("contract package", () => {
  it("exposes the documented initial contract version", () => {
    expect(CONTRACT_VERSION).toBe("1.0.0");
  });

  it("parses a complete feature response", () => {
    expect(featureResponseSchema.parse(featureResponse)).toEqual(featureResponse);
  });

  it("accepts the complete BCD 8 feature-key vocabulary", () => {
    expect(featureKeySchema.parse("javascript.builtins.Array.@@iterator")).toBe(
      "javascript.builtins.Array.@@iterator",
    );
    expect(featureKeySchema.parse("webextensions.api.devtools.inspectedWindow.eval.$0")).toBe(
      "webextensions.api.devtools.inspectedWindow.eval.$0",
    );
  });

  it("preserves last-version and approximate-removal information", () => {
    expect(
      supportStatementSchema.parse({
        ...statement,
        versionRemoved: "62",
        versionRemovedIsApproximate: true,
        versionLast: "61",
        versionLastIsApproximate: false,
      }),
    ).toMatchObject({
      versionRemoved: "62",
      versionRemovedIsApproximate: true,
      versionLast: "61",
      versionLastIsApproximate: false,
    });
  });

  it("represents an omitted BCD status block without inventing booleans", () => {
    expect(
      featureResponseSchema.parse({
        ...featureResponse,
        features: [{ ...featureResponse.features[0], status: null }],
      }).features[0]?.status,
    ).toBeNull();
  });

  it("parses browser metadata, index, metadata, and errors", () => {
    expect(
      browsersResponseSchema.parse({
        contract: CONTRACT_VERSION,
        generated: "2026-08-28T12:00:00Z",
        source,
        browsers: {
          nodejs: {
            name: "Node.js",
            type: "server",
            previewName: null,
            releases: [
              {
                version: "24",
                releaseDate: "2025-05-06",
                status: "current",
              },
            ],
          },
        },
      }).browsers.nodejs?.type,
    ).toBe("server");

    expect(
      indexResponseSchema.parse({
        contract: CONTRACT_VERSION,
        generated: "2026-08-28T12:00:00Z",
        source,
        namespace: "css",
        keys: ["css.properties.display"],
      }).namespace,
    ).toBe("css");

    expect(
      metaResponseSchema.parse({
        contract: CONTRACT_VERSION,
        generated: "2026-08-28T12:00:00Z",
        current: "bcd-8.0.13-gen-0.1.0",
        snapshots: [
          {
            id: "bcd-8.0.13-gen-0.1.0",
            source,
            generatorVersion: "0.1.0",
            generated: "2026-08-28T12:00:00Z",
            expires: "2026-11-26",
          },
        ],
        namespaces: ["api", "css"],
      }).current,
    ).toBe("bcd-8.0.13-gen-0.1.0");

    expect(
      apiErrorResponseSchema.parse({
        error: {
          code: "feature_not_found",
          message: "No compatibility data for the requested key.",
          query: "css.properties.dispaly",
        },
      }).error.code,
    ).toBe("feature_not_found");
  });
});

describe("strict validation", () => {
  it.each(["unsupported", "unknown", "preview", "partial", "supported"] as const)(
    "accepts the %s support state",
    (state) => {
      expect(supportStateSchema.parse(state)).toBe(state);
    },
  );

  it("preserves XR targets and flags without explicit source values", () => {
    expect(supportTargetTypeSchema.parse("xr")).toBe("xr");
    expect(
      supportFlagSchema.parse({
        type: "runtime_flag",
        name: "--experimental-feature",
        valueToSet: null,
      }).valueToSet,
    ).toBeNull();
  });

  it("rejects unknown states, invalid keys, dates, and timestamps", () => {
    expect(supportStateSchema.safeParse("flagged").success).toBe(false);
    expect(
      featureResponseSchema.safeParse({
        ...featureResponse,
        query: "css/properties/display",
      }).success,
    ).toBe(false);
    expect(
      featureResponseSchema.safeParse({
        ...featureResponse,
        generated: "28 August 2026",
      }).success,
    ).toBe(false);
    expect(
      featureResponseSchema.safeParse({
        ...featureResponse,
        features: [
          {
            ...featureResponse.features[0],
            support: {
              chrome: {
                ...featureResponse.features[0]?.support.chrome,
                summary: { ...summary, releaseDate: "2026-02-30" },
              },
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects missing, unknown, non-nullable, and empty required fields", () => {
    const { query: _query, ...withoutQuery } = featureResponse;
    expect(featureResponseSchema.safeParse(withoutQuery).success).toBe(false);
    expect(featureResponseSchema.safeParse({ ...featureResponse, extra: true }).success).toBe(
      false,
    );
    expect(
      featureResponseSchema.safeParse({
        ...featureResponse,
        features: [{ ...featureResponse.features[0], description: undefined }],
      }).success,
    ).toBe(false);
    expect(featureResponseSchema.safeParse({ ...featureResponse, features: [] }).success).toBe(
      false,
    );
  });

  it("requires canonical branches to have no prefix or alternative name", () => {
    expect(
      supportBranchSchema.safeParse({
        canonical: true,
        prefix: "-webkit-",
        alternativeName: null,
        statements: [statement],
      }).success,
    ).toBe(false);
    expect(
      supportBranchSchema.safeParse({
        canonical: false,
        prefix: "-webkit-",
        alternativeName: null,
        statements: [
          {
            ...statement,
            versionAdded: "4≤",
            prefix: "-webkit-",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      supportBranchSchema.safeParse({
        canonical: false,
        prefix: null,
        alternativeName: null,
        statements: [statement],
      }).success,
    ).toBe(false);
    expect(
      supportBranchSchema.safeParse({
        canonical: false,
        prefix: "-webkit-",
        alternativeName: null,
        statements: [],
      }).success,
    ).toBe(false);
  });

  it("requires grouped branches and a projected summary", () => {
    const canonicalBranch = {
      canonical: true as const,
      prefix: null,
      alternativeName: null,
      statements: [statement],
    };
    expect(
      supportTargetSupportSchema.safeParse({
        summary,
        branches: [canonicalBranch, canonicalBranch],
      }).success,
    ).toBe(false);

    const prefixedBranch = {
      canonical: false as const,
      prefix: "-webkit-",
      alternativeName: null,
      statements: [{ ...statement, prefix: "-webkit-" }],
    };
    expect(
      supportTargetSupportSchema.safeParse({
        summary: { ...summary, prefix: "-webkit-" },
        branches: [prefixedBranch, prefixedBranch],
      }).success,
    ).toBe(false);
    expect(
      supportTargetSupportSchema.safeParse({
        summary: { ...summary, versionAdded: "999" },
        branches: [canonicalBranch],
      }).success,
    ).toBe(false);
    expect(
      supportTargetSupportSchema.safeParse({
        summary: { ...summary, state: "unsupported" },
        branches: [canonicalBranch],
      }).success,
    ).toBe(false);

    const competingPrefixedBranch = {
      canonical: false as const,
      prefix: "-webkit-",
      alternativeName: null,
      statements: [
        {
          ...statement,
          versionAdded: "22",
          partialImplementation: true,
          prefix: "-webkit-",
        },
      ],
    };
    const competingCanonicalBranch = {
      ...canonicalBranch,
      statements: [{ ...statement, versionAdded: "46" }],
    };
    expect(
      supportTargetSupportSchema.safeParse({
        summary: {
          ...summary,
          state: "partial",
          versionAdded: "22",
          partialImplementation: true,
          prefix: "-webkit-",
        },
        branches: [competingPrefixedBranch, competingCanonicalBranch],
      }).success,
    ).toBe(false);
    expect(
      supportTargetSupportSchema.safeParse({
        summary: { ...summary, versionAdded: "46" },
        branches: [competingPrefixedBranch, competingCanonicalBranch],
      }).success,
    ).toBe(true);
  });

  it.each([
    "invalid_key",
    "feature_not_found",
    "namespace_not_queryable",
    "snapshot_not_found",
  ] as const)("requires an identifier for the %s error", (code) => {
    const error = { error: { code, message: "Request failed.", query: "api.Example" } };
    expect(apiErrorResponseSchema.safeParse(error).success).toBe(true);
    expect(
      apiErrorResponseSchema.safeParse({ ...error, error: { ...error.error, query: "" } }).success,
    ).toBe(false);
    expect(
      apiErrorResponseSchema.safeParse({ ...error, error: { ...error.error, query: null } })
        .success,
    ).toBe(false);
  });

  it.each(["rate_limited", "generation_in_progress"] as const)(
    "forbids an identifier for the %s error",
    (code) => {
      const error = { error: { code, message: "Request failed.", query: null } };
      expect(apiErrorResponseSchema.safeParse(error).success).toBe(true);
      expect(
        apiErrorResponseSchema.safeParse({
          ...error,
          error: { ...error.error, query: "api.Example" },
        }).success,
      ).toBe(false);
    },
  );

  it("requires normalized version and implementation identities", () => {
    expect(
      supportBranchSchema.safeParse({
        canonical: false,
        prefix: "-webkit-",
        alternativeName: null,
        statements: [
          {
            ...statement,
            versionAdded: "≤4",
            prefix: "-webkit-",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      supportBranchSchema.safeParse({
        canonical: true,
        prefix: null,
        alternativeName: null,
        statements: [
          {
            ...statement,
            versionRemovedIsApproximate: true,
            versionLastIsApproximate: true,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      supportBranchSchema.safeParse({
        canonical: true,
        prefix: null,
        alternativeName: null,
        statements: [
          {
            ...statement,
            versionAdded: false,
            versionAddedIsApproximate: true,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      supportBranchSchema.safeParse({
        canonical: false,
        prefix: "-webkit-",
        alternativeName: null,
        statements: [
          {
            ...statement,
            prefix: "-webkit-",
            alternativeName: "oldDisplay",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      supportBranchSchema.safeParse({
        canonical: false,
        prefix: "-webkit-",
        alternativeName: null,
        statements: [{ ...statement, prefix: "-moz-" }],
      }).success,
    ).toBe(false);
  });

  it("requires browser metadata to exactly cover referenced targets", () => {
    expect(featureResponseSchema.safeParse({ ...featureResponse, browsers: {} }).success).toBe(
      false,
    );
    expect(
      featureResponseSchema.safeParse({
        ...featureResponse,
        browsers: {
          ...featureResponse.browsers,
          firefox: {
            name: "Firefox",
            type: "desktop",
            previewName: "Nightly",
          },
        },
      }).success,
    ).toBe(false);
  });

  it("requires unique metadata entries and a current available snapshot", () => {
    const snapshot = {
      id: "bcd-8.0.13-gen-0.1.0",
      source,
      generatorVersion: "0.1.0",
      generated: "2026-08-28T12:00:00Z",
      expires: "2026-11-26",
    };
    const metadata = {
      contract: CONTRACT_VERSION,
      generated: "2026-08-28T12:00:00Z",
      current: snapshot.id,
      snapshots: [snapshot],
      namespaces: ["api", "css"],
    };

    expect(
      metaResponseSchema.safeParse({
        ...metadata,
        current: "bcd-8.0.12-gen-0.1.0",
      }).success,
    ).toBe(false);
    expect(
      metaResponseSchema.safeParse({
        ...metadata,
        current: "bcd-8.0.12-gen-0.1.0",
        snapshots: [
          {
            ...snapshot,
            id: "bcd-8.0.12-gen-0.1.0",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      metaResponseSchema.safeParse({
        ...metadata,
        snapshots: [snapshot, snapshot],
      }).success,
    ).toBe(false);
    expect(
      metaResponseSchema.safeParse({
        ...metadata,
        namespaces: ["css", "css"],
      }).success,
    ).toBe(false);
  });
});
