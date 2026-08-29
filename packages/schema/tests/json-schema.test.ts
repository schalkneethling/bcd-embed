import { readFile } from "node:fs/promises";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import {
  CONTRACT_VERSION,
  apiErrorResponseSchema,
  browsersResponseSchema,
  featureResponseSchema,
  indexResponseSchema,
  metaResponseSchema,
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

const featureResponse = {
  contract: CONTRACT_VERSION,
  generated: "2026-08-28T12:00:00Z",
  source,
  query: "css.properties.display",
  browsers: {
    chrome: { name: "Chrome", type: "desktop", previewName: "Canary" },
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
          summary: {
            state: "supported",
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
          },
          branches: [
            {
              canonical: true,
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
const feature = featureResponse.features[0]!;

const snapshot = {
  id: "bcd-8.0.13-gen-0.1.0",
  source,
  generatorVersion: "0.1.0",
  generated: "2026-08-28T12:00:00Z",
  expires: "2026-11-26",
};

const cases = [
  {
    name: "feature-response",
    zodSchema: featureResponseSchema,
    value: featureResponse,
  },
  {
    name: "browsers-response",
    zodSchema: browsersResponseSchema,
    value: {
      contract: CONTRACT_VERSION,
      generated: "2026-08-28T12:00:00Z",
      source,
      browsers: {
        nodejs: {
          name: "Node.js",
          type: "server",
          previewName: null,
          releases: [{ version: "24", releaseDate: "2025-05-06", status: "current" }],
        },
      },
    },
  },
  {
    name: "index-response",
    zodSchema: indexResponseSchema,
    value: {
      contract: CONTRACT_VERSION,
      generated: "2026-08-28T12:00:00Z",
      source,
      namespace: "css",
      keys: ["css.properties.display"],
    },
  },
  {
    name: "meta-response",
    zodSchema: metaResponseSchema,
    value: {
      contract: CONTRACT_VERSION,
      generated: "2026-08-28T12:00:00Z",
      current: snapshot.id,
      snapshots: [snapshot],
      namespaces: ["api", "css"],
    },
  },
  {
    name: "api-error-response",
    zodSchema: apiErrorResponseSchema,
    value: {
      error: {
        code: "feature_not_found",
        message: "No compatibility data for the requested key.",
        query: "css.properties.dispaly",
      },
    },
  },
] as const;

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);

const validators = new Map();
for (const contractCase of cases) {
  const contents = await readFile(
    new URL(`../json-schema/${contractCase.name}.schema.json`, import.meta.url),
    "utf8",
  );
  validators.set(contractCase.name, ajv.compile(JSON.parse(contents)));
}

describe("published JSON Schemas", () => {
  it.each(cases)("validates a $name example with Zod and JSON Schema", (contractCase) => {
    const validate = validators.get(contractCase.name);
    expect(contractCase.zodSchema.safeParse(contractCase.value).success).toBe(true);
    expect(validate?.(contractCase.value), JSON.stringify(validate?.errors)).toBe(true);
  });

  it.each([
    {
      name: "feature-response",
      zodSchema: featureResponseSchema,
      value: { ...featureResponse, query: "css/properties/display" },
    },
    {
      name: "feature-response",
      zodSchema: featureResponseSchema,
      value: { ...featureResponse, features: [] },
    },
    {
      name: "feature-response",
      zodSchema: featureResponseSchema,
      value: {
        ...featureResponse,
        features: [
          {
            ...feature,
            support: {
              chrome: {
                ...feature.support.chrome,
                summary: {
                  ...feature.support.chrome.summary,
                  state: "unsupported",
                },
              },
            },
          },
        ],
      },
    },
    {
      name: "feature-response",
      zodSchema: featureResponseSchema,
      value: {
        ...featureResponse,
        features: [
          {
            ...feature,
            support: {
              chrome: {
                summary: {
                  ...feature.support.chrome.summary,
                  prefix: "-webkit-",
                },
                branches: [
                  {
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
                  },
                ],
              },
            },
          },
        ],
      },
    },
    {
      name: "feature-response",
      zodSchema: featureResponseSchema,
      value: {
        ...featureResponse,
        features: [
          {
            ...feature,
            support: {
              chrome: {
                summary: {
                  ...feature.support.chrome.summary,
                  state: "unsupported",
                  versionAdded: false,
                  releaseDate: null,
                },
                branches: [
                  {
                    canonical: true,
                    prefix: null,
                    alternativeName: null,
                    statements: [
                      {
                        ...statement,
                        versionAdded: false,
                        versionAddedIsApproximate: true,
                        releaseDate: null,
                      },
                    ],
                  },
                ],
              },
            },
          },
        ],
      },
    },
    {
      name: "browsers-response",
      zodSchema: browsersResponseSchema,
      value: {
        ...cases[1].value,
        browsers: {
          nodejs: { ...cases[1].value.browsers.nodejs, releases: [] },
        },
      },
    },
    {
      name: "index-response",
      zodSchema: indexResponseSchema,
      value: { ...cases[2].value, keys: [] },
    },
    {
      name: "meta-response",
      zodSchema: metaResponseSchema,
      value: { ...cases[3].value, namespaces: [] },
    },
    {
      name: "meta-response",
      zodSchema: metaResponseSchema,
      value: { ...cases[3].value, namespaces: ["api", "api"] },
    },
    {
      name: "api-error-response",
      zodSchema: apiErrorResponseSchema,
      value: {
        error: { ...cases[4].value.error, code: "not_an_error" },
      },
    },
    {
      name: "api-error-response",
      zodSchema: apiErrorResponseSchema,
      value: {
        error: { ...cases[4].value.error, query: null },
      },
    },
    {
      name: "api-error-response",
      zodSchema: apiErrorResponseSchema,
      value: {
        error: { ...cases[4].value.error, code: "rate_limited" },
      },
    },
  ])("rejects a structurally invalid $name example in both validators", (contractCase) => {
    const validate = validators.get(contractCase.name);
    expect(contractCase.zodSchema.safeParse(contractCase.value).success).toBe(false);
    expect(validate?.(contractCase.value), JSON.stringify(validate?.errors)).toBe(false);
  });
});
