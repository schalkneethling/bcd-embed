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

const dottedVersionPattern = /^\d+(?:\.\d+)*$/;

/** Compare BCD's currently published dotted-decimal release identifiers without integer overflow. */
const compareDottedVersions = (left: string, right: string): number => {
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index++) {
    const leftPart = (leftParts[index] ?? "0").replace(/^0+(?=\d)/, "");
    const rightPart = (rightParts[index] ?? "0").replace(/^0+(?=\d)/, "");
    if (leftPart.length !== rightPart.length) return leftPart.length - rightPart.length;
    const difference = codeUnitCompare(leftPart, rightPart);
    if (difference !== 0) return difference;
  }
  return 0;
};

const statementRecency = (statement: SupportStatement, browser: BrowserStatement): number => {
  if (statement.isPreview) return 2;
  return typeof statement.versionAdded === "string" &&
    dottedVersionPattern.test(statement.versionAdded) &&
    Object.hasOwn(browser.releases, statement.versionAdded)
    ? 1
    : 0;
};

const compareStatementsByRecency = (
  left: SupportStatement,
  right: SupportStatement,
  browser: BrowserStatement,
): number => {
  const leftCategory = statementRecency(left, browser);
  const rightCategory = statementRecency(right, browser);
  const categoryDifference = rightCategory - leftCategory;
  if (categoryDifference !== 0) return categoryDifference;
  if (
    leftCategory === 1 &&
    typeof left.versionAdded === "string" &&
    typeof right.versionAdded === "string"
  ) {
    return compareDottedVersions(right.versionAdded, left.versionAdded);
  }
  return 0;
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

  const branches = [...groups.values()].map((group) => {
    const { prefix, alternativeName } = group[0]!;
    return {
      canonical: prefix === null && alternativeName === null,
      prefix,
      alternativeName,
      statements: group.toSorted((left, right) => compareStatementsByRecency(left, right, browser)),
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
  const stable = active && !statement.isPreview;
  const full = stable && !statement.partialImplementation && statement.flags.length === 0;

  if (full && !identified) {
    return statement.notes.length === 0 ? 0 : 1;
  }
  if (full && identified) return 2;
  if (stable && statement.partialImplementation) return 3;
  if (stable && statement.flags.length > 0) return 4;
  if (active) return 5;
  return 6;
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
