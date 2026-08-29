import { v1NormalizedFixture } from "../../../packages/schema/src/fixtures/v1.js";
import { CONTRACT_VERSION } from "../../../packages/schema/src/schemas.js";

import type { ContractKind } from "./contract-validation.js";

const source = {
  package: "@mdn/browser-compat-data",
  version: "8.0.13",
} as const;
const generated = "2026-08-28T12:00:00Z";
const snapshot = {
  id: "bcd-8.0.13-gen-0.1.0",
  source,
  generatorVersion: "0.1.0",
  generated,
  expires: "2026-11-26",
};

export const sampleDocuments: Record<ContractKind, unknown> = {
  "feature-response": v1NormalizedFixture,
  "browsers-response": {
    contract: CONTRACT_VERSION,
    generated,
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
  "index-response": {
    contract: CONTRACT_VERSION,
    generated,
    source,
    namespace: "css",
    keys: ["css.properties.display"],
  },
  "meta-response": {
    contract: CONTRACT_VERSION,
    generated,
    current: snapshot.id,
    snapshots: [snapshot],
    namespaces: ["api", "css"],
  },
  "api-error-response": {
    error: {
      code: "feature_not_found",
      message: "No compatibility data for the requested key.",
      query: "css.properties.dispaly",
    },
  },
};
