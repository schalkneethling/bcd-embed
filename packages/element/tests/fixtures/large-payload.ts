// A relative import of the schema's source, not of the package, because the fixture page of the
// three-engine tests loads this file through a dev server, where the schema package is not built.
import { CONTRACT_VERSION } from "../../../schema/src/schemas.js";
import type {
  Feature,
  FeatureResponse,
  SupportStatement,
  SupportTargetSupport,
} from "@bcd-embed/schema";

// A payload the size of a large BCD subtree, built in memory, for the tests that bound and time the
// rendered table. Issue #198 sets the size to measure: 2,000 features by four targets. Building
// it costs O(F) time and space for F features, because each feature gets a fixed number of
// targets and statements.

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

const support = (
  state: SupportTargetSupport["summary"]["state"],
  statements: readonly SupportStatement[],
): SupportTargetSupport => {
  const selected = statements[0] ?? statement({});
  return {
    summary: {
      state,
      versionAdded: selected.versionAdded,
      versionAddedIsApproximate: selected.versionAddedIsApproximate,
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
    branches: [{ canonical: true, prefix: null, alternativeName: null, statements }],
  } as SupportTargetSupport;
};

/** The targets of the large payload: the default set, so the table shows all four. */
export const LARGE_PAYLOAD_TARGETS = ["chrome", "firefox", "safari", "nodejs"] as const;

/** How many rows of each family of five are nested under the family's first row. */
const FAMILY_SIZE = 5;

/**
 * What one feature of the large payload adds, so a test can state the totals without reading
 * them back from the rendered table:
 *
 * - Chrome has two statements, and the first carries a note with one `<code>` element.
 * - Firefox has one statement behind a runtime flag with a value.
 * - Safari has one plain statement, so its cell has no disclosure.
 * - Node.js has no entry, so its cell reads "No data".
 */
export const LARGE_PAYLOAD_PER_FEATURE = {
  statements: 4,
  flags: 1,
  notes: 1,
  noteElements: 1,
} as const;

/**
 * Builds a feature response with `featureCount` features. The features come in families of five:
 * one top-level row and four rows nested under it, so the table also renders `part-of` texts.
 */
export const buildLargePayload = (featureCount: number): FeatureResponse => {
  const features: Feature[] = [];
  for (let index = 0; index < featureCount; index += 1) {
    const family = `api.Large${Math.floor(index / FAMILY_SIZE)}`;
    const member = index % FAMILY_SIZE;
    features.push({
      key: member === 0 ? family : `${family}.member${member}`,
      name: member === 0 ? family.slice("api.".length) : `member${member}`,
      depth: member === 0 ? 0 : 1,
      description: null,
      mdnUrl: null,
      specUrls: [],
      status: { experimental: false, standardTrack: true, deprecated: false },
      tags: [],
      support: {
        chrome: support("supported", [
          statement({
            versionAdded: "60",
            notes: ["Before Chrome 62, <code>member</code> returned a number."],
          }),
          statement({ versionAdded: "40", versionRemoved: "50", partialImplementation: true }),
        ]),
        firefox: support("supported", [
          statement({
            versionAdded: "70",
            flags: [{ type: "runtime_flag", name: "--enable-large", valueToSet: "true" }],
          }),
        ]),
        safari: support("supported", [statement({ versionAdded: "15" })]),
      },
    } as Feature);
  }
  return {
    contract: CONTRACT_VERSION,
    query: "api.Large",
    browsers: {
      chrome: { name: "Chrome", type: "desktop", previewName: "Canary" },
      firefox: { name: "Firefox", type: "desktop", previewName: "Nightly" },
      safari: { name: "Safari", type: "desktop", previewName: "Technology Preview" },
      nodejs: { name: "Node.js", type: "server", previewName: null },
    },
    features,
  };
};
