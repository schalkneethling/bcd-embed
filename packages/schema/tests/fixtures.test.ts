import { readFile } from "node:fs/promises";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import { bcdSourceFixtures, v1FixtureCases, v1NormalizedFixture } from "../src/fixtures/v1.js";
import { featureResponseSchema } from "../src/index.js";
import type { FeatureResponse, SupportBranch, SupportStatement } from "../src/index.js";

const schema = JSON.parse(
  await readFile(new URL("../json-schema/feature-response.schema.json", import.meta.url), "utf8"),
);
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const validateJsonSchema = ajv.compile(schema);

const fixtureFeature = (key: string) => {
  const found = v1NormalizedFixture.features.find((candidate) => candidate.key === key);
  if (found === undefined) throw new Error(`Missing normalized fixture feature: ${key}`);
  return found;
};

// An independent restatement of the ordering rules in Document 1, section 5.1.
// It deliberately does not import `core`. The comparison cases below pin the
// edge cases where it must agree with core's dotted-version comparison.
const dottedVersionPattern = /^\d+(?:\.\d+)*$/;

/** Compares numeric components left to right; a missing component counts as 0. */
const compareDottedVersions = (left: string, right: string): number => {
  const leftParts = left.split(".").map(BigInt);
  const rightParts = right.split(".").map(BigInt);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index++) {
    const leftPart = leftParts[index] ?? 0n;
    const rightPart = rightParts[index] ?? 0n;
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1;
  }
  return 0;
};

/**
 * 2 for a preview statement, 1 for a released dotted-decimal version, and 0
 * when `versionAdded` is unresolved. The fixture's browser metadata has no
 * release map, so every dotted-decimal version counts as released here.
 */
const statementTier = (statement: SupportStatement): number => {
  if (statement.isPreview) return 2;
  return typeof statement.versionAdded === "string" &&
    dottedVersionPattern.test(statement.versionAdded)
    ? 1
    : 0;
};

/** Negative when `first` belongs before `second`, 0 when source order decides. */
const compareStatementOrder = (first: SupportStatement, second: SupportStatement): number => {
  const tierDifference = statementTier(second) - statementTier(first);
  if (tierDifference !== 0) return tierDifference;
  if (statementTier(first) === 1) {
    return compareDottedVersions(second.versionAdded as string, first.versionAdded as string);
  }
  return 0;
};

const branchIdentityKey = ({ alternativeName, prefix }: SupportBranch): string =>
  `${alternativeName ?? ""}\0${prefix ?? ""}`;

/** Canonical branch first, then by `(alternativeName, prefix)`. */
const compareBranchOrder = (first: SupportBranch, second: SupportBranch): number => {
  if (first.canonical !== second.canonical) return first.canonical ? -1 : 1;
  const [firstKey, secondKey] = [branchIdentityKey(first), branchIdentityKey(second)];
  return firstKey < secondKey ? -1 : firstKey > secondKey ? 1 : 0;
};

const orderViolations = (response: FeatureResponse): string[] =>
  response.features.flatMap(({ key, support }) =>
    Object.entries(support).flatMap(([target, { branches }]) => {
      const violations: string[] = [];
      branches.forEach((branch, branchIndex) => {
        const location = `${key} (${target}), branch ${branchIndex}`;
        const previousBranch = branches[branchIndex - 1];
        if (previousBranch !== undefined && compareBranchOrder(previousBranch, branch) > 0) {
          violations.push(`${location} is out of order`);
        }
        branch.statements.forEach((statement, statementIndex) => {
          const previousStatement = branch.statements[statementIndex - 1];
          if (
            previousStatement !== undefined &&
            compareStatementOrder(previousStatement, statement) > 0
          ) {
            violations.push(`${location}, statement ${statementIndex} is out of order`);
          }
        });
      });
      return violations;
    }),
  );

const countCompatBlocks = (value: unknown): number => {
  if (value === null || typeof value !== "object") return 0;
  return Object.entries(value).reduce(
    (count, [key, child]) => count + (key === "__compat" ? 1 : countCompatBlocks(child)),
    0,
  );
};

describe("published v1 fixtures", () => {
  it("records the frozen BCD 8.1.3 snapshot and keeps it internally consistent", () => {
    expect(bcdSourceFixtures.source).toEqual({
      package: "@mdn/browser-compat-data",
      version: "8.1.3",
    });

    const fragments = Object.entries(bcdSourceFixtures.fragments);
    expect(fragments.length).toBeGreaterThan(0);
    for (const [path, fragment] of fragments) {
      expect(path, "fragment paths are dotted BCD feature identifiers").toMatch(
        /^[\w-]+(\.[\w-]+)+$/,
      );
      expect(fragment, path).toHaveProperty("support");
      expect(fragment, path).not.toHaveProperty("__compat");
    }

    const subtrees = Object.entries(bcdSourceFixtures.subtrees);
    expect(subtrees.length).toBeGreaterThan(0);
    for (const [path, subtree] of subtrees) {
      expect(subtree, path).toHaveProperty("__compat.support");
      expect(countCompatBlocks(subtree), path).toBeGreaterThan(0);
    }
  });

  it("validates every normalized resource through Zod and published JSON Schema", () => {
    expect(featureResponseSchema.safeParse(v1NormalizedFixture).success).toBe(true);
    expect(validateJsonSchema(v1NormalizedFixture), JSON.stringify(validateJsonSchema.errors)).toBe(
      true,
    );
  });

  it("contains three interleaved identities with prefixed support predating canonical", () => {
    const support = fixtureFeature(v1FixtureCases.branching).support.chrome!;
    expect(
      support.branches.map(({ prefix, alternativeName }) => [prefix, alternativeName]),
    ).toEqual([
      [null, null],
      ["-webkit-", null],
      [null, "intrinsic"],
    ]);
    expect(support.branches[1]!.statements[0]!.versionAdded).toBe("22");
    expect(support.branches[0]!.statements[0]!.versionAdded).toBe("46");

    const rawChrome = (
      bcdSourceFixtures.fragments[v1FixtureCases.branching] as {
        support: { chrome: Array<Record<string, unknown>> };
      }
    ).support.chrome;
    expect(
      rawChrome.map(({ prefix, alternative_name: alternativeName }) => [prefix, alternativeName]),
    ).toEqual([
      [undefined, undefined],
      ["-webkit-", undefined],
      [undefined, "intrinsic"],
    ]);
  });

  it("contains add/remove/re-add and every five-state precedence branch", () => {
    const history = fixtureFeature(v1FixtureCases.addRemoveReadd).support.chrome!;
    expect(history.branches[0]!.statements.map((item) => item.versionRemoved)).toEqual([
      null,
      "17",
      "16",
    ]);

    const states = new Set(
      v1NormalizedFixture.features.flatMap((item) =>
        Object.values(item.support).map((support) => support.summary.state),
      ),
    );
    expect(states).toEqual(new Set(["unsupported", "unknown", "preview", "partial", "supported"]));
  });

  it("orders every branch and its statements as the contract requires", () => {
    expect(orderViolations(v1NormalizedFixture)).toEqual([]);
  });

  it("compares dotted versions by numeric component, not as text", () => {
    expect(compareDottedVersions("1.39", "1.8")).toBeGreaterThan(0);
    expect(compareDottedVersions("10", "9")).toBeGreaterThan(0);
    expect(compareDottedVersions("17.2.0", "17.0.0")).toBeGreaterThan(0);
    expect(compareDottedVersions("1", "1.0")).toBe(0);
  });

  it("detects statements and branches that are out of contract order", () => {
    const oldestFirst = structuredClone(v1NormalizedFixture);
    oldestFirst.features
      .find(({ key }) => key === v1FixtureCases.addRemoveReadd)!
      .support.chrome!.branches[0]!.statements.reverse();
    expect(orderViolations(oldestFirst)).toHaveLength(2);

    const prefixedFirst = structuredClone(v1NormalizedFixture);
    prefixedFirst.features
      .find(({ key }) => key === v1FixtureCases.branching)!
      .support.chrome!.branches.reverse();
    expect(orderViolations(prefixedFirst)).not.toEqual([]);
  });

  it("isolates every summary-selection precedence branch", () => {
    expect(fixtureFeature(v1FixtureCases.missingTarget).support.chrome!.summary).toMatchObject({
      state: "supported",
      hasNotes: false,
      prefix: null,
      partialImplementation: false,
      behindFlag: false,
    });
    expect(fixtureFeature(v1FixtureCases.notesOnly).support.chrome!.summary).toMatchObject({
      state: "supported",
      hasNotes: true,
      prefix: null,
      partialImplementation: false,
      behindFlag: false,
    });
    expect(fixtureFeature(v1FixtureCases.selectedPrefix).support.chrome!.summary).toMatchObject({
      state: "supported",
      prefix: "webkit",
      alternativeName: null,
    });
    expect(fixtureFeature(v1FixtureCases.partialOnly).support.chrome!.summary).toMatchObject({
      state: "partial",
      partialImplementation: true,
    });
    expect(fixtureFeature(v1FixtureCases.flagOnly).support.chrome!.summary).toMatchObject({
      state: "supported",
      behindFlag: true,
    });
    expect(fixtureFeature(v1FixtureCases.removedPartial).support.chrome!.summary).toMatchObject({
      state: "unsupported",
      versionRemoved: "12.1",
    });
  });

  it("contains flag-only, overlapping modifiers, and normalized approximate versions", () => {
    expect(fixtureFeature(v1FixtureCases.flagOnly).support.chrome!.summary).toMatchObject({
      state: "supported",
      behindFlag: true,
    });
    expect(fixtureFeature(v1FixtureCases.previewPartial).support.nodejs!.summary).toMatchObject({
      state: "preview",
      isPreview: true,
      partialImplementation: true,
    });
    expect(fixtureFeature(v1FixtureCases.removedPartial).support.chrome!.summary).toMatchObject({
      state: "unsupported",
      versionRemoved: "12.1",
      partialImplementation: true,
    });

    const approximateStatement = fixtureFeature(v1FixtureCases.approximateVersion).support.opera!
      .branches[0]!.statements[0]!;
    expect(approximateStatement).toMatchObject({
      versionAdded: "12.1",
      versionAddedIsApproximate: true,
    });
    expect(String(approximateStatement.versionAdded)).not.toContain("≤");
    const rawApproximate = bcdSourceFixtures.fragments["css.properties.min-width.min-content"] as {
      support: { opera: Array<{ version_added: string }> };
    };
    expect(
      rawApproximate.support.opera.some(({ version_added: version }) => version.startsWith("≤")),
    ).toBe(true);
  });

  it("distinguishes an absent target from explicit unknown runtime support", () => {
    expect(fixtureFeature(v1FixtureCases.missingTarget).support.nodejs).toBeUndefined();
    expect(
      fixtureFeature(v1FixtureCases.explicitUnknownRuntime).support.nodejs!.summary,
    ).toMatchObject({
      state: "unknown",
      versionAdded: null,
    });
  });

  it("preserves nested flattening depth and an Array-scale source subtree", () => {
    expect(v1FixtureCases.nested.map((key) => fixtureFeature(key).depth)).toEqual([0, 1, 2]);
    const arraySubtree = bcdSourceFixtures.subtrees["javascript.builtins.Array"];
    expect(countCompatBlocks(arraySubtree)).toBe(51);
    expect(Buffer.byteLength(JSON.stringify(arraySubtree))).toBe(54_217);
  });

  it("rejects malformed controls through both normalized validators", () => {
    const badState = structuredClone(v1NormalizedFixture);
    const removed = badState.features.find(({ key }) => key === v1FixtureCases.removedPartial)!;
    removed.support.chrome!.summary.state = "supported";

    const unknownField = structuredClone(v1NormalizedFixture) as FeatureResponseWithExtra;
    unknownField.features[0]!.unexpected = true;

    for (const malformed of [badState, unknownField]) {
      expect(featureResponseSchema.safeParse(malformed).success).toBe(false);
      expect(validateJsonSchema(malformed)).toBe(false);
    }
  });
});

type FeatureResponseWithExtra = typeof v1NormalizedFixture & {
  features: Array<(typeof v1NormalizedFixture.features)[number] & { unexpected?: boolean }>;
};
