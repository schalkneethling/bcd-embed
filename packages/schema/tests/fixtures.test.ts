import { readFile } from "node:fs/promises";

import bcd from "@mdn/browser-compat-data" with { type: "json" };
import type { CompatData } from "@mdn/browser-compat-data/types";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import { bcdSourceFixtures, v1FixtureCases, v1NormalizedFixture } from "../src/fixtures/v1.js";
import { featureResponseSchema } from "../src/index.js";

const schema = JSON.parse(
  await readFile(new URL("../json-schema/feature-response.schema.json", import.meta.url), "utf8"),
);
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const validateJsonSchema = ajv.compile(schema);

const installedBcd: CompatData = bcd;

const atPath = (root: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((value, segment) => {
    if (value === null || typeof value !== "object" || !(segment in value)) {
      throw new Error(`Missing fixture path: ${path}`);
    }
    return (value as Record<string, unknown>)[segment];
  }, root);

const fixtureFeature = (key: string) => {
  const found = v1NormalizedFixture.features.find((candidate) => candidate.key === key);
  if (found === undefined) throw new Error(`Missing normalized fixture feature: ${key}`);
  return found;
};

const countCompatBlocks = (value: unknown): number => {
  if (value === null || typeof value !== "object") return 0;
  return Object.entries(value).reduce(
    (count, [key, child]) => count + (key === "__compat" ? 1 : countCompatBlocks(child)),
    0,
  );
};

describe("published v1 fixtures", () => {
  it("matches every source fragment and subtree to installed BCD 8.0.13", () => {
    expect(installedBcd.__meta.version).toBe("8.0.13");
    expect(bcdSourceFixtures.source).toEqual({
      package: "@mdn/browser-compat-data",
      version: "8.0.13",
    });

    for (const [path, fragment] of Object.entries(bcdSourceFixtures.fragments)) {
      expect(fragment).toEqual((atPath(installedBcd, path) as { __compat: unknown }).__compat);
    }
    for (const [path, subtree] of Object.entries(bcdSourceFixtures.subtrees)) {
      expect(subtree).toEqual(atPath(installedBcd, path));
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
      "16",
      "17",
      null,
    ]);

    const states = new Set(
      v1NormalizedFixture.features.flatMap((item) =>
        Object.values(item.support).map((support) => support.summary.state),
      ),
    );
    expect(states).toEqual(new Set(["unsupported", "unknown", "preview", "partial", "supported"]));
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
