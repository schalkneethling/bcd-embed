import type { Browsers, CompatStatement, Identifier } from "@mdn/browser-compat-data/types";
import type { SupportStatement } from "@bcd-embed/schema";
import type { NormalizedFeatureSubtree } from "../../src/index.js";

export const goldenKey = "api.Golden";

/**
 * A deliberately small BCD-shaped input whose expected normalized output is
 * authored below rather than derived from the implementation under test.
 */
export const goldenRawSubtree = {
  __compat: {
    description: "A synthetic feature that exercises every core normalization field.",
    mdn_url: "https://developer.mozilla.org/docs/Web/API/Golden",
    spec_url: ["https://example.test/spec/golden", "https://example.test/spec/golden#history"],
    source_file: "api/Golden.json",
    status: {
      deprecated: true,
      experimental: true,
      standard_track: false,
    },
    support: {
      chrome: [
        {
          version_added: "1",
          version_removed: "2",
          version_last: "1",
        },
        {
          version_added: "1",
          prefix: "-x-",
          notes: "The prefixed implementation predates the canonical one.",
          impl_url: "https://example.test/bugs/golden-prefixed",
        },
        {
          version_added: "1",
          version_removed: "2",
          version_last: "1",
          alternative_name: "legacyGolden",
          notes: ["The old name was removed.", "Use the canonical name instead."],
          impl_url: [
            "https://example.test/bugs/golden-legacy",
            "https://example.test/issues/golden-legacy",
          ],
        },
        {
          version_added: "4",
          partial_implementation: true,
          flags: [
            {
              type: "preference",
              name: "golden.enabled",
              value_to_set: "true",
            },
          ],
          notes: "The canonical implementation is partial in version 4.",
          impl_url: "https://example.test/bugs/golden-partial",
        },
        {
          version_added: "3",
        },
      ],
    },
    tags: ["web-features:golden"],
  } satisfies CompatStatement,
  runtime: {
    __compat: {
      description: "A runtime-flagged child.",
      mdn_url: "https://developer.mozilla.org/docs/Web/API/Golden/runtime",
      spec_url: "https://example.test/spec/golden#runtime",
      source_file: "api/Golden.json",
      status: {
        deprecated: false,
        experimental: false,
        standard_track: true,
      },
      support: {
        chrome: {
          version_added: false,
        },
        nodejs: {
          version_added: "2",
          flags: [
            {
              type: "runtime_flag",
              name: "--experimental-golden",
              value_to_set: "on",
            },
          ],
          notes: "Enable the runtime flag before using this child.",
          impl_url: "https://example.test/issues/golden-runtime",
        },
      },
      tags: ["web-features:golden-runtime"],
    } satisfies CompatStatement,
  },
  states: {
    // BCD 8's published type excludes null, while the contract preserves
    // explicit unknown support. Keep this compatibility case isolated here.
    __compat: {
      source_file: "api/Golden.json",
      support: {
        nodejs: {
          version_added: null,
        },
      },
    } as unknown as CompatStatement,
  },
} as unknown as Identifier;

export const goldenBrowsers = {
  chrome: {
    name: "Chrome",
    type: "desktop",
    preview_name: "Canary",
    accepts_flags: true,
    accepts_webextensions: true,
    releases: {
      "1": { release_date: "2020-01-01", status: "retired" },
      "2": { release_date: "2021-01-01", status: "retired" },
      "3": { release_date: "2022-01-01", status: "current" },
      "4": { release_date: "2023-01-01", status: "current" },
    },
  },
  nodejs: {
    name: "Node.js",
    type: "server",
    preview_name: "Nightly",
    accepts_flags: true,
    accepts_webextensions: false,
    releases: {
      "1": { release_date: "2021-02-01", status: "retired" },
      "2": { release_date: "2022-02-01", status: "current" },
    },
  },
} satisfies Pick<Browsers, "chrome" | "nodejs">;

const canonicalV4 = {
  versionAdded: "4",
  versionAddedIsApproximate: false,
  versionRemoved: null,
  versionRemovedIsApproximate: false,
  versionLast: null,
  versionLastIsApproximate: false,
  releaseDate: "2023-01-01",
  removalDate: null,
  isPreview: false,
  partialImplementation: true,
  prefix: null,
  alternativeName: null,
  flags: [{ type: "preference" as const, name: "golden.enabled", valueToSet: "true" }],
  notes: ["The canonical implementation is partial in version 4."],
  implUrls: ["https://example.test/bugs/golden-partial"],
} satisfies SupportStatement;

const canonicalV3 = {
  versionAdded: "3",
  versionAddedIsApproximate: false,
  versionRemoved: null,
  versionRemovedIsApproximate: false,
  versionLast: null,
  versionLastIsApproximate: false,
  releaseDate: "2022-01-01",
  removalDate: null,
  isPreview: false,
  partialImplementation: false,
  prefix: null,
  alternativeName: null,
  flags: [],
  notes: [],
  implUrls: [],
} satisfies SupportStatement;

const canonicalV1 = {
  versionAdded: "1",
  versionAddedIsApproximate: false,
  versionRemoved: "2",
  versionRemovedIsApproximate: false,
  versionLast: "1",
  versionLastIsApproximate: false,
  releaseDate: "2020-01-01",
  removalDate: "2021-01-01",
  isPreview: false,
  partialImplementation: false,
  prefix: null,
  alternativeName: null,
  flags: [],
  notes: [],
  implUrls: [],
} satisfies SupportStatement;

const prefixedV1 = {
  versionAdded: "1",
  versionAddedIsApproximate: false,
  versionRemoved: null,
  versionRemovedIsApproximate: false,
  versionLast: null,
  versionLastIsApproximate: false,
  releaseDate: "2020-01-01",
  removalDate: null,
  isPreview: false,
  partialImplementation: false,
  prefix: "-x-",
  alternativeName: null,
  flags: [],
  notes: ["The prefixed implementation predates the canonical one."],
  implUrls: ["https://example.test/bugs/golden-prefixed"],
} satisfies SupportStatement;

const legacyV1 = {
  versionAdded: "1",
  versionAddedIsApproximate: false,
  versionRemoved: "2",
  versionRemovedIsApproximate: false,
  versionLast: "1",
  versionLastIsApproximate: false,
  releaseDate: "2020-01-01",
  removalDate: "2021-01-01",
  isPreview: false,
  partialImplementation: false,
  prefix: null,
  alternativeName: "legacyGolden",
  flags: [],
  notes: ["The old name was removed.", "Use the canonical name instead."],
  implUrls: [
    "https://example.test/bugs/golden-legacy",
    "https://example.test/issues/golden-legacy",
  ],
} satisfies SupportStatement;

const unsupported = {
  versionAdded: false,
  versionAddedIsApproximate: false,
  versionRemoved: null,
  versionRemovedIsApproximate: false,
  versionLast: null,
  versionLastIsApproximate: false,
  releaseDate: null,
  removalDate: null,
  isPreview: false,
  partialImplementation: false,
  prefix: null,
  alternativeName: null,
  flags: [],
  notes: [],
  implUrls: [],
} satisfies SupportStatement;

const runtimeFlagged = {
  versionAdded: "2",
  versionAddedIsApproximate: false,
  versionRemoved: null,
  versionRemovedIsApproximate: false,
  versionLast: null,
  versionLastIsApproximate: false,
  releaseDate: "2022-02-01",
  removalDate: null,
  isPreview: false,
  partialImplementation: false,
  prefix: null,
  alternativeName: null,
  flags: [{ type: "runtime_flag" as const, name: "--experimental-golden", valueToSet: "on" }],
  notes: ["Enable the runtime flag before using this child."],
  implUrls: ["https://example.test/issues/golden-runtime"],
} satisfies SupportStatement;

const unknown = {
  versionAdded: null,
  versionAddedIsApproximate: false,
  versionRemoved: null,
  versionRemovedIsApproximate: false,
  versionLast: null,
  versionLastIsApproximate: false,
  releaseDate: null,
  removalDate: null,
  isPreview: false,
  partialImplementation: false,
  prefix: null,
  alternativeName: null,
  flags: [],
  notes: [],
  implUrls: [],
} satisfies SupportStatement;

export const goldenExpected: NormalizedFeatureSubtree = {
  features: [
    {
      key: "api.Golden",
      name: "Golden",
      depth: 0,
      description: "A synthetic feature that exercises every core normalization field.",
      mdnUrl: "https://developer.mozilla.org/docs/Web/API/Golden",
      specUrls: ["https://example.test/spec/golden", "https://example.test/spec/golden#history"],
      status: {
        experimental: true,
        standardTrack: false,
        deprecated: true,
      },
      tags: ["web-features:golden"],
      support: {
        chrome: {
          summary: {
            state: "supported",
            versionAdded: "3",
            versionRemoved: null,
            versionRemovedIsApproximate: false,
            releaseDate: "2022-01-01",
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
              statements: [canonicalV4, canonicalV3, canonicalV1],
            },
            {
              canonical: false,
              prefix: "-x-",
              alternativeName: null,
              statements: [prefixedV1],
            },
            {
              canonical: false,
              prefix: null,
              alternativeName: "legacyGolden",
              statements: [legacyV1],
            },
          ],
        },
      },
    },
    {
      key: "api.Golden.runtime",
      name: "runtime",
      depth: 1,
      description: "A runtime-flagged child.",
      mdnUrl: "https://developer.mozilla.org/docs/Web/API/Golden/runtime",
      specUrls: ["https://example.test/spec/golden#runtime"],
      status: {
        experimental: false,
        standardTrack: true,
        deprecated: false,
      },
      tags: ["web-features:golden-runtime"],
      support: {
        chrome: {
          summary: {
            state: "unsupported",
            versionAdded: false,
            versionRemoved: null,
            versionRemovedIsApproximate: false,
            releaseDate: null,
            removalDate: null,
            partialImplementation: false,
            behindFlag: false,
            prefix: null,
            alternativeName: null,
            isPreview: false,
            hasNotes: false,
          },
          branches: [
            { canonical: true, prefix: null, alternativeName: null, statements: [unsupported] },
          ],
        },
        nodejs: {
          summary: {
            state: "supported",
            versionAdded: "2",
            versionRemoved: null,
            versionRemovedIsApproximate: false,
            releaseDate: "2022-02-01",
            removalDate: null,
            partialImplementation: false,
            behindFlag: true,
            prefix: null,
            alternativeName: null,
            isPreview: false,
            hasNotes: true,
          },
          branches: [
            { canonical: true, prefix: null, alternativeName: null, statements: [runtimeFlagged] },
          ],
        },
      },
    },
    {
      key: "api.Golden.states",
      name: "states",
      depth: 1,
      description: null,
      mdnUrl: null,
      specUrls: [],
      status: null,
      tags: [],
      support: {
        nodejs: {
          summary: {
            state: "unknown",
            versionAdded: null,
            versionRemoved: null,
            versionRemovedIsApproximate: false,
            releaseDate: null,
            removalDate: null,
            partialImplementation: false,
            behindFlag: false,
            prefix: null,
            alternativeName: null,
            isPreview: false,
            hasNotes: false,
          },
          branches: [
            { canonical: true, prefix: null, alternativeName: null, statements: [unknown] },
          ],
        },
      },
    },
  ],
  browsers: {
    chrome: {
      name: "Chrome",
      type: "desktop",
      previewName: "Canary",
    },
    nodejs: {
      name: "Node.js",
      type: "server",
      previewName: "Nightly",
    },
  },
};
