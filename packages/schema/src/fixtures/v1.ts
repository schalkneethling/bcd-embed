import sourceFixtureData from "./source-fragments.json" with { type: "json" };

import type {
  Feature,
  FeatureResponse,
  SupportBranch,
  SupportState,
  SupportStatement,
  SupportTargetSupport,
} from "../schemas.js";
import { CONTRACT_VERSION } from "../schemas.js";

const baseStatement: SupportStatement = {
  versionAdded: "1",
  versionAddedIsApproximate: false,
  versionRemoved: null,
  releaseDate: null,
  removalDate: null,
  isPreview: false,
  partialImplementation: false,
  prefix: null,
  alternativeName: null,
  flags: [],
  notes: [],
  implUrls: [],
};

const statement = (overrides: Partial<SupportStatement> = {}): SupportStatement =>
  ({ ...baseStatement, ...overrides }) as SupportStatement;

const branch = (
  statements: SupportStatement[],
  identity: { prefix: string | null; alternativeName: string | null } = {
    prefix: null,
    alternativeName: null,
  },
): SupportBranch =>
  ({
    canonical: identity.prefix === null && identity.alternativeName === null,
    ...identity,
    statements,
  }) as SupportBranch;

const targetSupport = (
  state: SupportState,
  selected: SupportStatement,
  branches: SupportBranch[] = [branch([selected])],
): SupportTargetSupport =>
  ({
    summary: {
      state,
      versionAdded: selected.versionAdded,
      versionRemoved: selected.versionRemoved,
      releaseDate: selected.releaseDate,
      removalDate: selected.removalDate,
      partialImplementation: selected.partialImplementation,
      behindFlag: selected.flags.length > 0,
      prefix: selected.prefix,
      alternativeName: selected.alternativeName,
      isPreview: selected.isPreview,
      hasNotes: selected.notes.length > 0,
    },
    branches,
  }) as SupportTargetSupport;

const feature = (key: string, depth: number, support: Feature["support"]): Feature => ({
  key,
  name: key.split(".").at(-1) ?? key,
  depth,
  description: null,
  mdnUrl: null,
  specUrls: [],
  status: {
    experimental: false,
    standardTrack: true,
    deprecated: false,
  },
  tags: [],
  support,
});

const canonicalFitContent = statement({ versionAdded: "46" });
const prefixedFitContent = statement({ versionAdded: "22", prefix: "-webkit-" });
const alternativeFitContent = statement({
  versionAdded: "1",
  versionRemoved: "48",
  alternativeName: "intrinsic",
});

const readded = statement({ versionAdded: "18" });
const flagOnly = statement({
  versionAdded: "37",
  flags: [
    {
      type: "preference",
      name: "enable-experimental-web-platform-features",
      valueToSet: "enabled",
    },
  ],
});
const previewPartial = statement({
  versionAdded: "25",
  isPreview: true,
  partialImplementation: true,
});
const removedPartial = statement({
  versionAdded: "11.1",
  versionRemoved: "12.1",
  partialImplementation: true,
  notes: ["The initial implementation did not abort fetch requests."],
});
const approximate = statement({
  versionAdded: "12.1",
  versionAddedIsApproximate: true,
});
const explicitUnknown = statement({ versionAdded: null });
const partialOnly = statement({ versionAdded: "17", partialImplementation: true });
const notesOnly = statement({
  versionAdded: "20",
  notes: ["Support is complete; this note records a historical implementation detail."],
});
const selectedPrefix = statement({ versionAdded: "10", prefix: "webkit" });

export const v1NormalizedFixture: FeatureResponse = {
  contract: CONTRACT_VERSION,
  generated: "2026-08-28T12:00:00Z",
  source: {
    package: "@mdn/browser-compat-data",
    version: "8.0.13",
  },
  query: "fixture.adversarial-v1",
  browsers: {
    chrome: { name: "Chrome", type: "desktop", previewName: "Canary" },
    nodejs: { name: "Node.js", type: "server", previewName: null },
    opera: { name: "Opera", type: "desktop", previewName: "Developer" },
  },
  features: [
    feature("css.properties.width.fit-content", 0, {
      chrome: targetSupport("supported", canonicalFitContent, [
        branch([canonicalFitContent]),
        branch([prefixedFitContent], { prefix: "-webkit-", alternativeName: null }),
        branch([alternativeFitContent], { prefix: null, alternativeName: "intrinsic" }),
      ]),
    }),
    feature("api.AbortController.abort", 0, {
      chrome: targetSupport("supported", readded, [
        branch([
          statement({
            versionAdded: "14",
            versionRemoved: "16",
            partialImplementation: true,
          }),
          statement({ versionAdded: "16", versionRemoved: "17" }),
          readded,
        ]),
      ]),
    }),
    feature("api.AudioTrackList", 0, {
      chrome: targetSupport("supported", flagOnly),
    }),
    feature("api.preview_partial", 0, {
      nodejs: targetSupport("preview", previewPartial),
    }),
    feature("api.removed_partial", 0, {
      chrome: targetSupport("unsupported", removedPartial),
    }),
    feature("api.Attr.localName", 0, {
      opera: targetSupport("supported", approximate),
    }),
    feature("api.missing_target", 0, {
      chrome: targetSupport("supported", statement()),
    }),
    feature("api.unknown_runtime", 0, {
      nodejs: targetSupport("unknown", explicitUnknown),
    }),
    feature("api.partial_only", 0, {
      chrome: targetSupport("partial", partialOnly),
    }),
    feature("api.notes_only", 0, {
      chrome: targetSupport("supported", notesOnly),
    }),
    feature("api.prefixed_only", 0, {
      chrome: targetSupport("supported", selectedPrefix, [
        branch([selectedPrefix], { prefix: "webkit", alternativeName: null }),
      ]),
    }),
    feature("javascript.builtins.Array", 0, {
      chrome: targetSupport("supported", statement({ versionAdded: "1" })),
    }),
    feature("javascript.builtins.Array.from", 1, {
      chrome: targetSupport("supported", statement({ versionAdded: "45" })),
    }),
    feature("javascript.builtins.Array.from.async_iterable", 2, {
      chrome: targetSupport("supported", statement({ versionAdded: "121" })),
    }),
  ],
};

export const v1FixtureCases = {
  branching: "css.properties.width.fit-content",
  addRemoveReadd: "api.AbortController.abort",
  flagOnly: "api.AudioTrackList",
  previewPartial: "api.preview_partial",
  removedPartial: "api.removed_partial",
  approximateVersion: "api.Attr.localName",
  missingTarget: "api.missing_target",
  explicitUnknownRuntime: "api.unknown_runtime",
  partialOnly: "api.partial_only",
  notesOnly: "api.notes_only",
  selectedPrefix: "api.prefixed_only",
  nested: [
    "javascript.builtins.Array",
    "javascript.builtins.Array.from",
    "javascript.builtins.Array.from.async_iterable",
  ],
} as const;

export const bcdSourceFixtures: Readonly<{
  source: { package: string; version: string };
  fragments: Record<string, unknown>;
  subtrees: Record<string, unknown>;
}> = sourceFixtureData;
