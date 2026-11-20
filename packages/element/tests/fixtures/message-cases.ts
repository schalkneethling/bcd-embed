import { CONTRACT_VERSION } from "@bcd-embed/schema";
import type {
  FeatureResponse,
  SupportFlag,
  SupportState,
  SupportStatement,
  SupportTarget,
  SupportTargetSupport,
} from "@bcd-embed/schema";

// The schema package's fixture (`v1NormalizedFixture`) has a desktop and a server target but no
// mobile or extended reality (XR) target, no runtime flag, no full-support preview, and no
// `versionLast` value. Each fixture here supplies one of those cases, as a complete feature
// response, so the table model and the templates can use them. A test checks that each parses
// against the contract.

const statement = (overrides: Partial<SupportStatement>): SupportStatement =>
  ({
    versionAdded: "1",
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
    ...overrides,
  }) as SupportStatement;

const support = (state: SupportState, selected: SupportStatement): SupportTargetSupport =>
  ({
    summary: {
      state,
      versionAdded: selected.versionAdded,
      versionRemoved: selected.versionRemoved,
      versionRemovedIsApproximate: selected.versionRemovedIsApproximate,
      releaseDate: selected.releaseDate,
      removalDate: selected.removalDate,
      partialImplementation: selected.partialImplementation,
      behindFlag: selected.flags.length > 0,
      prefix: selected.prefix,
      alternativeName: selected.alternativeName,
      isPreview: selected.isPreview,
      hasNotes: selected.notes.length > 0,
    },
    branches: [{ canonical: true, prefix: null, alternativeName: null, statements: [selected] }],
  }) as SupportTargetSupport;

const response = (
  query: string,
  browsers: Record<string, SupportTarget>,
  supportByTarget: Record<string, SupportTargetSupport>,
): FeatureResponse => ({
  contract: CONTRACT_VERSION,
  query,
  browsers,
  features: [
    {
      key: query,
      name: query.split(".").at(-1) ?? query,
      depth: 0,
      description: null,
      mdnUrl: null,
      specUrls: [],
      status: { experimental: false, standardTrack: true, deprecated: false },
      tags: [],
      support: supportByTarget,
    },
  ],
});

const runtimeFlag: SupportFlag = {
  type: "runtime_flag",
  name: "--experimental-vm-modules",
  valueToSet: null,
};

/** A mobile support target, which gets the "Mobile" group name. */
export const mobileTarget: FeatureResponse = response(
  "fixture.mobile-target",
  { chrome_android: { name: "Chrome Android", type: "mobile", previewName: "Canary" } },
  { chrome_android: support("supported", statement({ versionAdded: "18" })) },
);

/** An XR support target, which gets the "Extended reality" group name. */
export const xrTarget: FeatureResponse = response(
  "fixture.xr-target",
  { oculus: { name: "Meta Quest Browser", type: "xr", previewName: null } },
  { oculus: support("supported", statement({ versionAdded: "5.0" })) },
);

/** Support behind a runtime flag, which needs the runtime flag messages. */
export const runtimeFlagCase: FeatureResponse = response(
  "fixture.runtime-flag",
  { nodejs: { name: "Node.js", type: "server", previewName: null } },
  { nodejs: support("supported", statement({ versionAdded: "12.16", flags: [runtimeFlag] })) },
);

/** Full support that exists only in a preview release, which needs the full-support preview. */
export const fullSupportPreview: FeatureResponse = response(
  "fixture.full-support-preview",
  { firefox: { name: "Firefox", type: "desktop", previewName: "Nightly" } },
  { firefox: support("preview", statement({ versionAdded: "151", isPreview: true })) },
);

/**
 * Full support in BCD's literal `version_added: "preview"`. Core turns it into
 * `versionAdded: "preview"` with `isPreview: true`, so there is no version to name.
 */
export const previewWithoutVersion: FeatureResponse = response(
  "fixture.preview-without-version",
  { safari: { name: "Safari", type: "desktop", previewName: "Technology Preview" } },
  { safari: support("preview", statement({ versionAdded: "preview", isPreview: true })) },
);

/** A runtime flag on a browser, as BCD records for Chrome's `--enable-blink-features`. */
export const browserRuntimeFlag: FeatureResponse = response(
  "fixture.browser-runtime-flag",
  { chrome: { name: "Chrome", type: "desktop", previewName: "Canary" } },
  {
    chrome: support(
      "supported",
      statement({
        versionAdded: "130",
        flags: [
          { type: "runtime_flag", name: "--enable-blink-features", valueToSet: "AudioSession" },
        ],
      }),
    ),
  },
);

/** A preference without a `value_to_set`, as BCD records for Opera's `#enable-tls13-early-data`. */
export const preferenceWithoutValue: FeatureResponse = response(
  "fixture.preference-without-value",
  { opera: { name: "Opera", type: "desktop", previewName: "Developer" } },
  {
    opera: support(
      "supported",
      statement({
        versionAdded: "50",
        flags: [{ type: "preference", name: "#enable-tls13-early-data", valueToSet: null }],
      }),
    ),
  },
);

/** A statement with a `versionLast` value, which needs the last-supported message. */
export const versionLastCase: FeatureResponse = response(
  "fixture.version-last",
  { safari: { name: "Safari", type: "desktop", previewName: "Technology Preview" } },
  {
    safari: support(
      "unsupported",
      statement({ versionAdded: "3", versionRemoved: "11", versionLast: "10.1" }),
    ),
  },
);

/** The fixtures by name, for tests that walk every case. */
export const messageCases = {
  mobileTarget,
  xrTarget,
  runtimeFlag: runtimeFlagCase,
  fullSupportPreview,
  previewWithoutVersion,
  browserRuntimeFlag,
  preferenceWithoutValue,
  versionLast: versionLastCase,
} as const;
