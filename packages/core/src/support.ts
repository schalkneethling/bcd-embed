import type {
  BrowserStatement,
  SimpleSupportStatement,
  SupportStatement as BcdSupportStatement,
} from "@mdn/browser-compat-data/types";
import type {
  SupportBranch,
  SupportState,
  SupportStatement,
  SupportSummary,
  SupportTargetSupport,
} from "@bcd-embed/schema";

import { normalizeVersion } from "./version.js";

type RawSimpleSupportStatement = Omit<SimpleSupportStatement, "version_added"> & {
  version_added: string | false | null;
};

const asArray = <Value>(value: Value | Value[]): Value[] =>
  Array.isArray(value) ? value : [value];

const releaseDate = (browser: BrowserStatement, version: string | false | null) =>
  typeof version === "string" ? (browser.releases[version]?.release_date ?? null) : null;

const normalizeStatement = (
  raw: RawSimpleSupportStatement,
  browser: BrowserStatement,
): SupportStatement => {
  if (raw.prefix !== undefined && raw.alternative_name !== undefined) {
    throw new Error("A BCD support statement cannot have both prefix and alternative_name.");
  }

  const added = normalizeVersion(raw.version_added);
  const removed = normalizeVersion(raw.version_removed ?? null);
  const last = normalizeVersion(raw.version_last ?? null);
  if (removed.value === false || last.value === false) {
    throw new Error("BCD removal and last-supported versions must be strings when present.");
  }

  const addedRelease = typeof added.value === "string" ? browser.releases[added.value] : undefined;
  const isPreview =
    added.preview ||
    addedRelease?.status === "beta" ||
    addedRelease?.status === "nightly" ||
    addedRelease?.status === "planned";

  return {
    versionAdded: added.value,
    versionAddedIsApproximate: added.approximate,
    versionRemoved: removed.value,
    versionRemovedIsApproximate: removed.approximate,
    versionLast: last.value,
    versionLastIsApproximate: last.approximate,
    releaseDate: releaseDate(browser, added.value),
    removalDate: releaseDate(browser, removed.value),
    isPreview,
    partialImplementation: raw.partial_implementation ?? false,
    prefix: raw.prefix ?? null,
    alternativeName: raw.alternative_name ?? null,
    flags: (raw.flags ?? []).map((flag) => ({
      type: flag.type,
      name: flag.name,
      valueToSet: flag.value_to_set ?? null,
    })),
    notes: raw.notes === undefined ? [] : asArray(raw.notes),
    implUrls: raw.impl_url === undefined ? [] : asArray(raw.impl_url),
  } as SupportStatement;
};

const identityKey = (statement: SupportStatement) =>
  JSON.stringify([statement.prefix, statement.alternativeName]);

const codeUnitCompare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

const statementRecency = (
  statement: SupportStatement,
  releaseOrder: ReadonlyMap<string, number>,
) => {
  if (statement.isPreview) return Number.POSITIVE_INFINITY;
  return typeof statement.versionAdded === "string"
    ? (releaseOrder.get(statement.versionAdded) ?? Number.NEGATIVE_INFINITY)
    : Number.NEGATIVE_INFINITY;
};

const groupBranches = (
  statements: SupportStatement[],
  browser: BrowserStatement,
): SupportBranch[] => {
  const groups = new Map<string, SupportStatement[]>();
  for (const statement of statements) {
    const key = identityKey(statement);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [statement]);
    else group.push(statement);
  }

  const releaseOrder = new Map(
    Object.keys(browser.releases).map((version, index) => [version, index] as const),
  );
  const branches = [...groups.values()].map((group) => {
    const { prefix, alternativeName } = group[0]!;
    return {
      canonical: prefix === null && alternativeName === null,
      prefix,
      alternativeName,
      statements: group.toSorted(
        (left, right) =>
          statementRecency(right, releaseOrder) - statementRecency(left, releaseOrder),
      ),
    } as SupportBranch;
  });

  return branches.toSorted((left, right) => {
    if (left.canonical !== right.canonical) return left.canonical ? -1 : 1;
    return codeUnitCompare(
      `${left.alternativeName ?? ""}\0${left.prefix ?? ""}`,
      `${right.alternativeName ?? ""}\0${right.prefix ?? ""}`,
    );
  });
};

const selectionRank = (statement: SupportStatement) => {
  const active = typeof statement.versionAdded === "string" && statement.versionRemoved === null;
  const identified = statement.prefix !== null || statement.alternativeName !== null;
  const full = active && !statement.isPreview && !statement.partialImplementation;

  if (full && !identified && statement.flags.length === 0) {
    return statement.notes.length === 0 ? 0 : 1;
  }
  if (active && identified) return 2;
  if (active && statement.partialImplementation) return 3;
  if (active && statement.flags.length > 0) return 4;
  return 5;
};

const supportState = (statement: SupportStatement): SupportState =>
  statement.versionAdded === false || statement.versionRemoved !== null
    ? "unsupported"
    : statement.versionAdded === null
      ? "unknown"
      : statement.isPreview
        ? "preview"
        : statement.partialImplementation
          ? "partial"
          : "supported";

const summarize = (branches: SupportBranch[]): SupportSummary => {
  const statements = branches.flatMap((branch) => branch.statements as SupportStatement[]);
  const selected = statements.reduce((current, candidate) =>
    selectionRank(candidate) < selectionRank(current) ? candidate : current,
  );

  return {
    state: supportState(selected),
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
  } as SupportSummary;
};

/** Normalize one support target without filtering modifiers or source statements. */
export const normalizeTargetSupport = (
  support: BcdSupportStatement,
  browser: BrowserStatement,
): SupportTargetSupport => {
  const rawStatements = (
    Array.isArray(support) ? support : [support]
  ) as RawSimpleSupportStatement[];
  if (rawStatements.length === 0) throw new Error("BCD support arrays must be non-empty.");
  const branches = groupBranches(
    rawStatements.map((statement) => normalizeStatement(statement, browser)),
    browser,
  );
  return { summary: summarize(branches), branches };
};
