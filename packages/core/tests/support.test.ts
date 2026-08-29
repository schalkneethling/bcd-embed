import bcd from "@mdn/browser-compat-data" with { type: "json" };
import type {
  BrowserStatement,
  CompatStatement,
  SimpleSupportStatement,
  SupportStatement as BcdSupportStatement,
} from "@mdn/browser-compat-data/types";
import { supportTargetSupportSchema } from "@bcd-embed/schema";
import { describe, expect, it } from "vitest";

import { normalizeTargetSupport } from "../src/support.js";

const compatAt = (path: string): CompatStatement => {
  const node = path.split(".").reduce<unknown>((value, segment) => {
    if (value === null || typeof value !== "object" || !(segment in value)) {
      throw new Error(`Missing BCD test path: ${path}`);
    }
    return (value as Record<string, unknown>)[segment];
  }, bcd);
  return (node as { __compat: CompatStatement }).__compat;
};

const supportAt = (path: string, target: string) => {
  const support = compatAt(path).support[target as keyof CompatStatement["support"]];
  if (support === undefined) throw new Error(`Missing ${target} support at ${path}`);
  return support;
};

const browser = (target: keyof typeof bcd.browsers): BrowserStatement => bcd.browsers[target];

describe("normalizeTargetSupport", () => {
  it("groups real canonical, prefixed, and alternative branches deterministically", () => {
    const normalized = normalizeTargetSupport(
      supportAt("css.properties.width.fit-content", "chrome"),
      browser("chrome"),
    );

    expect(
      normalized.branches.map(({ prefix, alternativeName }) => [prefix, alternativeName]),
    ).toEqual([
      [null, null],
      ["-webkit-", null],
      [null, "intrinsic"],
    ]);
    expect(normalized.branches[0]!.statements[0]).toMatchObject({
      versionAdded: "46",
      releaseDate: "2015-10-13",
    });
    expect(normalized.branches[2]!.statements[0]).toMatchObject({
      versionLast: "47",
      versionRemoved: "48",
    });
    expect(normalized.summary).toMatchObject({ state: "supported", versionAdded: "46" });
  });

  it("preserves the real Node.js add/remove/re-add history and joins release dates", () => {
    const normalized = normalizeTargetSupport(
      supportAt("api.AbortController.abort", "nodejs"),
      browser("nodejs"),
    );
    const statements = normalized.branches[0]!.statements;

    expect(statements.map(({ versionAdded }) => versionAdded)).toEqual([
      "17.2.0",
      "17.0.0",
      "16.14.0",
      "14.17.0",
    ]);
    expect(statements[1]).toMatchObject({
      versionLast: "17.0.0",
      versionRemoved: "17.2.0",
      releaseDate: "2021-10-19",
      removalDate: "2021-11-30",
      partialImplementation: true,
    });
  });

  it("normalizes approximate versions, flags, and literal preview support", () => {
    const approximate = normalizeTargetSupport(
      supportAt("css.properties.min-width.min-content", "opera"),
      browser("opera"),
    );
    expect(approximate.branches[1]!.statements[0]).toMatchObject({
      versionAdded: "15",
      versionAddedIsApproximate: true,
      releaseDate: "2013-07-02",
    });

    const flagged = normalizeTargetSupport(
      supportAt("api.AudioTrackList", "chrome"),
      browser("chrome"),
    );
    expect(flagged.summary).toMatchObject({ state: "supported", behindFlag: true });
    expect(flagged.branches[0]!.statements[0]!.flags).toEqual([
      {
        type: "preference",
        name: "enable-experimental-web-platform-features",
        valueToSet: "enabled",
      },
    ]);

    const preview = normalizeTargetSupport(
      supportAt("api.AnimationTimeline.duration", "firefox"),
      browser("firefox"),
    );
    expect(preview.summary).toMatchObject({
      state: "preview",
      versionAdded: "preview",
      releaseDate: null,
      isPreview: true,
    });
  });

  it("preserves real approximate last and removal boundaries before joining dates", () => {
    const normalized = normalizeTargetSupport(
      supportAt("html.elements.object.codebase", "chrome"),
      browser("chrome"),
    );
    const approximateRemoval = normalized.branches
      .flatMap(({ statements }) => statements)
      .find(({ versionRemoved }) => versionRemoved === "62");

    expect(approximateRemoval).toMatchObject({
      versionLast: "62",
      versionLastIsApproximate: true,
      versionRemoved: "62",
      versionRemovedIsApproximate: true,
      removalDate: "2017-10-17",
    });
  });

  it("orders statements by published release order with stable unresolved ties", () => {
    const releases = {
      "9": { status: "retired" as const },
      "10": { status: "retired" as const },
      "9.5": { status: "retired" as const },
    };
    const target = { ...browser("chrome"), releases };
    const statements = [
      { version_added: "unlisted-a" },
      { version_added: false },
      { version_added: "9" },
      { version_added: "10" },
      { version_added: "9.5" },
    ] as unknown as BcdSupportStatement;

    expect(
      normalizeTargetSupport(statements, target).branches[0]!.statements.map(
        ({ versionAdded }) => versionAdded,
      ),
    ).toEqual(["9.5", "10", "9", "unlisted-a", false]);
  });

  it("recognizes real notes-only and active-partial statements", () => {
    const notesOnly = normalizeTargetSupport(
      supportAt("api.Animation.pending", "firefox"),
      browser("firefox"),
    );
    expect(notesOnly.summary).toMatchObject({
      state: "supported",
      versionAdded: "59",
      hasNotes: true,
    });

    const activePartial = normalizeTargetSupport(
      supportAt("api.AudioParam.cancelScheduledValues", "firefox"),
      browser("firefox"),
    );
    expect(activePartial.summary).toMatchObject({
      state: "partial",
      versionAdded: "25",
      partialImplementation: true,
    });
  });

  it("selects summaries using every documented precedence rank", () => {
    const raw = (
      statements: Array<Partial<SimpleSupportStatement> & { version_added: string | false | null }>,
    ) => statements as unknown as BcdSupportStatement;
    const target = browser("chrome");
    const cases = [
      [
        raw([{ version_added: "46" }, { version_added: "45", notes: "note" }]),
        { versionAdded: "46", state: "supported" },
      ],
      [
        raw([
          { version_added: "45", notes: "note" },
          { version_added: "44", flags: [{ type: "preference", name: "flag" }] },
        ]),
        { versionAdded: "45", state: "supported", hasNotes: true },
      ],
      [
        raw([
          { version_added: "43", prefix: "-webkit-" },
          { version_added: "44", partial_implementation: true },
        ]),
        { versionAdded: "43", state: "supported", prefix: "-webkit-" },
      ],
      [
        raw([
          { version_added: "44", partial_implementation: true },
          { version_added: "43", flags: [{ type: "preference", name: "flag" }] },
        ]),
        { versionAdded: "44", state: "partial" },
      ],
      [
        raw([
          { version_added: "43", flags: [{ type: "preference", name: "flag" }] },
          { version_added: "42", version_removed: "43" },
        ]),
        { versionAdded: "43", state: "supported", behindFlag: true },
      ],
      [
        raw([{ version_added: "42", version_removed: "43", partial_implementation: true }]),
        { state: "unsupported", partialImplementation: true },
      ],
    ] as const;

    for (const [statements, expected] of cases) {
      expect(normalizeTargetSupport(statements, target).summary).toMatchObject(expected);
    }
  });

  it("keeps explicit unknown support distinct from unsupported", () => {
    const unknown = { version_added: null } as unknown as BcdSupportStatement;
    expect(normalizeTargetSupport(unknown, browser("nodejs")).summary).toMatchObject({
      state: "unknown",
      versionAdded: null,
    });
    expect(
      normalizeTargetSupport({ version_added: false }, browser("nodejs")).summary,
    ).toMatchObject({ state: "unsupported", versionAdded: false });
  });

  it("produces the canonical contracted target shape", () => {
    const normalized = normalizeTargetSupport(
      supportAt("api.AbortController.abort", "safari"),
      browser("safari"),
    );

    expect(supportTargetSupportSchema.safeParse(normalized).success).toBe(true);
  });
});
