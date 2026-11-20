import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { FeatureResponse, SupportStatement, SupportTargetSupport } from "@bcd-embed/schema";
import { describe, expect, it } from "vitest";

import { v1FixtureCases, v1NormalizedFixture } from "../../schema/src/fixtures/v1.js";
import { en } from "../src/strings/en.js";
import { buildTableModel, TablePayloadError } from "../src/model/table-model.js";
import type { TableCell, TableModel, TableModelOptions } from "../src/model/table-model.js";
import { messageCases } from "./fixtures/message-cases.js";

// A deep copy, so a test can change a fixture without touching the schema package's object.
const copy = <Value>(value: Value): Value => structuredClone(value);

const rowFor = (model: TableModel, key: string) => {
  const row = model.rows.find((candidate) => candidate.key === key);
  if (row === undefined) throw new Error(`No row ${key}`);
  return row;
};

const cellFor = (model: TableModel, key: string, target: string): TableCell => {
  const index = model.columns.findIndex((column) => column.id === target);
  const cell = rowFor(model, key).cells[index];
  if (cell === undefined) throw new Error(`No cell ${key} ${target}`);
  return cell;
};

const phase1Options: TableModelOptions = { browsers: "chrome opera nodejs" };

describe("the columns", () => {
  it("groups chrome opera nodejs into Desktop (Chrome, Opera) and Server (Node.js), with 14 rows", () => {
    const model = buildTableModel(v1NormalizedFixture, phase1Options);

    expect(model.groups.map((group) => group.label.text)).toEqual(["Desktop", "Server"]);
    expect(model.groups.map((group) => group.columns.map((column) => column.name))).toEqual([
      ["Chrome", "Opera"],
      ["Node.js"],
    ]);
    expect(model.columns.map((column) => column.id)).toEqual(["chrome", "opera", "nodejs"]);
    expect(model.rows).toHaveLength(14);
    for (const row of model.rows) expect(row.cells).toHaveLength(3);
  });

  it("intersects the default set with the payload, so the fixture shows Chrome and Node.js only", () => {
    const model = buildTableModel(v1NormalizedFixture, { browsers: null });

    expect(model.columns.map((column) => column.name)).toEqual(["Chrome", "Node.js"]);
    expect(buildTableModel(v1NormalizedFixture).columns).toEqual(model.columns);
  });

  it("shows the payload's own targets when the default set matches none of them", () => {
    const payload = copy(messageCases.mobileTarget);
    const support = payload.features[0]!.support.chrome_android!;
    payload.browsers = {
      webview_android: { name: "WebView Android", type: "mobile", previewName: null },
    };
    payload.features[0]!.support = { webview_android: support };

    const model = buildTableModel(payload, { browsers: null });

    expect(model.columns.map((column) => column.id)).toEqual(["webview_android"]);
    expect(model.groups.map((group) => group.label.text)).toEqual(["Mobile"]);
    expect(model.rows[0]!.cells[0]!.name.text).toBe("Supported since WebView Android 18");
  });

  it("puts an explicitly named target absent from the payload in an Other group with no data", () => {
    const model = buildTableModel(v1NormalizedFixture, { browsers: "chrome deno" });

    expect(model.groups.map((group) => [group.id, group.label.text])).toEqual([
      ["desktop", "Desktop"],
      ["other", "Other"],
    ]);
    const other = model.groups[1]!;
    expect(other.columns.map((column) => column.name)).toEqual(["deno"]);
    for (const row of model.rows) {
      const cell = row.cells[1]!;
      expect(cell.state).toBe("no-data");
      expect(cell.name).toEqual({
        id: "no-data",
        values: { target: "deno" },
        text: "No data for deno",
      });
      expect(cell.disclosure).toBeNull();
    }
  });

  it("orders groups Desktop, Mobile, Server, XR, Other, whatever order the author lists them in", () => {
    const payload = copy(v1NormalizedFixture);
    payload.browsers = {
      ...payload.browsers,
      oculus: { name: "Meta Quest Browser", type: "xr", previewName: null },
      chrome_android: { name: "Chrome Android", type: "mobile", previewName: "Canary" },
    };

    const model = buildTableModel(payload, {
      browsers: "deno oculus nodejs chrome_android opera chrome",
    });

    expect(model.groups.map((group) => group.label.text)).toEqual([
      "Desktop",
      "Mobile",
      "Server",
      "Extended reality",
      "Other",
    ]);
    // Within a group, the author's order is kept.
    expect(model.columns.map((column) => column.id)).toEqual([
      "opera",
      "chrome",
      "chrome_android",
      "nodejs",
      "oculus",
      "deno",
    ]);
  });

  it("ignores repeated targets, and treats an attribute with no target names as not set", () => {
    expect(
      buildTableModel(v1NormalizedFixture, { browsers: "  chrome   chrome opera " }).columns.map(
        (column) => column.id,
      ),
    ).toEqual(["chrome", "opera"]);
    expect(buildTableModel(v1NormalizedFixture, { browsers: "   " }).columns).toEqual(
      buildTableModel(v1NormalizedFixture).columns,
    );
  });

  it("names the extended reality and mobile groups from the named fixtures", () => {
    expect(buildTableModel(messageCases.xrTarget).groups[0]!.label.text).toBe("Extended reality");
    expect(buildTableModel(messageCases.mobileTarget).groups[0]!.label.text).toBe("Mobile");
  });
});

describe("the cells of the Phase 1 fixture", () => {
  const model = buildTableModel(v1NormalizedFixture, phase1Options);

  it("gives fit-content in Chrome supported-since with Chrome 46 and three history items", () => {
    const cell = cellFor(model, v1FixtureCases.branching, "chrome");

    expect(cell.name.id).toBe("supported-since");
    expect(cell.name.values).toEqual({ target: "Chrome", version: "46" });
    expect(cell.disclosure?.items).toHaveLength(3);
    expect(cell.disclosure?.label.id).toBe("disclosure-history");
  });

  it("gives missing_target in Opera no-data and unknown_runtime in Node.js unknown, which differ", () => {
    const missing = cellFor(model, v1FixtureCases.missingTarget, "opera");
    const unknown = cellFor(model, v1FixtureCases.explicitUnknownRuntime, "nodejs");

    expect(missing.name.id).toBe("no-data");
    expect(missing.state).toBe("no-data");
    expect(unknown.name.id).toBe("unknown");
    expect(unknown.state).toBe("unknown");
    expect(missing.name.text).not.toBe(unknown.name.text);
  });

  it("says behind a flag for AudioTrackList, and names the flag and its value in the disclosure", () => {
    const cell = cellFor(model, v1FixtureCases.flagOnly, "chrome");

    expect(cell.name.text).toContain("behind a flag");
    expect(cell.behindFlag).toBe(true);
    expect(cell.disclosure?.label.id).toBe("disclosure-flag");
    const flagItem = cell.disclosure?.items.find((item) => item.message.id === "flag-preference");
    expect(flagItem?.message.values).toEqual({
      name: "enable-experimental-web-platform-features",
      value: "enabled",
    });
  });

  it("gives a nested row the qualified name of its parent for the part-of message", () => {
    const [array, from, asyncIterable] = v1FixtureCases.nested.map((key) => rowFor(model, key));

    expect(array?.partOf).toBeNull();
    expect(from?.partOf?.text).toBe("(part of Array)");
    expect(asyncIterable?.depth).toBe(2);
    expect(asyncIterable?.partOf).toEqual({
      id: "part-of",
      values: { parent: "Array.from" },
      text: "(part of Array.from)",
    });
  });

  it("states the cell's fact and the label that names it in the summary", () => {
    const cell = cellFor(model, v1FixtureCases.removedPartial, "chrome");

    expect(cell.disclosure?.summary.text).toBe(
      "Supported from Chrome 11.1, then removed in Chrome 12.1. History and notes for removed_partial in Chrome",
    );
    expect(cell.compact.text).toBe("11.1 – 12.1");
  });

  it("keeps a note's segments beside its plain text", () => {
    const payload = copy(v1NormalizedFixture);
    const support = payload.features[9]!.support.chrome!;
    (support.branches[0]!.statements[0] as { notes: string[] }).notes = [
      "Use <code>abort()</code> instead.",
    ];

    const cell = cellFor(buildTableModel(payload), v1FixtureCases.notesOnly, "chrome");
    const note = cell.disclosure?.items.at(-1);

    expect(note?.message.text).toBe("Note: Use abort() instead.");
    expect(note?.note).toEqual([
      { kind: "text", text: "Use " },
      { kind: "code", text: "abort()" },
      { kind: "text", text: " instead." },
    ]);
  });
});

describe("an approximate version", () => {
  const localName = (summaryChange: (summary: Record<string, unknown>) => void) => {
    const payload = copy(v1NormalizedFixture);
    const feature = payload.features.find((f) => f.key === v1FixtureCases.approximateVersion)!;
    summaryChange(feature.support.opera!.summary as unknown as Record<string, unknown>);
    return cellFor(buildTableModel(payload, phase1Options), feature.key, "opera");
  };

  it("reads or earlier, with a compact ≤, when versionAddedIsApproximate is true", () => {
    const cell = localName((summary) => {
      summary.versionAddedIsApproximate = true;
    });

    expect(cell.name.id).toBe("supported-since-or-earlier");
    expect(cell.name.text).toBe("Supported since Opera 12.1 or earlier");
    expect(cell.compact.text?.startsWith("≤")).toBe(true);
    expect(cell.compact.text).toBe("≤12.1");
  });

  it("reads as exact when the field is absent or false, although the branch is approximate", () => {
    const absent = localName((summary) => {
      delete summary.versionAddedIsApproximate;
    });
    const isFalse = localName((summary) => {
      summary.versionAddedIsApproximate = false;
    });

    for (const cell of [absent, isFalse]) {
      expect(cell.name.id).toBe("supported-since");
      expect(cell.name.text).toBe("Supported since Opera 12.1");
      expect(cell.compact.text).toBe("12.1");
      // The statement's own "or earlier" stays reachable in the history, without changing the name.
      expect(cell.disclosure?.items.map((item) => item.message.text)).toEqual([
        "Supported since Opera 12.1 or earlier.",
      ]);
    }
    // The branch still says approximate, and nothing was derived from it.
    const feature = v1NormalizedFixture.features.find(
      (f) => f.key === v1FixtureCases.approximateVersion,
    )!;
    expect(feature.support.opera!.branches[0]!.statements[0]!.versionAddedIsApproximate).toBe(true);
  });
});

describe("the payload guard", () => {
  const rejects = (value: unknown, reason: string) => {
    let thrown: unknown;
    try {
      buildTableModel(value);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TablePayloadError);
    expect(thrown).toMatchObject({ name: "TablePayloadError", reason });
  };

  it("throws the typed payload error for null, an array, contract 2.0.0, and empty features", () => {
    rejects(null, "not-an-object");
    rejects([], "not-an-object");
    rejects({ ...v1NormalizedFixture, contract: "2.0.0" }, "unsupported-contract");
    rejects({ ...v1NormalizedFixture, features: [] }, "no-features");
  });

  it("throws the typed payload error for other values the model cannot read", () => {
    rejects(undefined, "not-an-object");
    rejects("{}", "not-an-object");
    rejects({ ...v1NormalizedFixture, contract: 1 }, "unsupported-contract");
    rejects({ ...v1NormalizedFixture, query: undefined }, "missing-query");
    rejects({ ...v1NormalizedFixture, browsers: [] }, "missing-browsers");
    rejects({ ...v1NormalizedFixture, features: [null] }, "invalid-feature");
    rejects(
      { ...v1NormalizedFixture, features: [{ key: "a", name: "a", depth: -1, support: {} }] },
      "invalid-feature",
    );
    const badSupport = copy(v1NormalizedFixture);
    (badSupport.features[0]!.support as Record<string, unknown>).chrome = { summary: {} };
    rejects(badSupport, "invalid-support");
  });

  it("accepts only a full 1.minor.patch contract version", () => {
    for (const contract of [
      "1.",
      "1.x",
      "1.0",
      "1.0.0.0",
      "1.0.0-rc.1",
      "1.01.0",
      "1.0.0 ",
      "1.-1.0",
    ]) {
      rejects({ ...v1NormalizedFixture, contract }, "unsupported-contract");
    }
    for (const contract of ["1.0.0", "1.1.0", "1.12.34"]) {
      expect(() => buildTableModel({ ...v1NormalizedFixture, contract })).not.toThrow();
    }
  });

  it("rejects a displayed browsers entry the model could not format", () => {
    const withBrowser = (entry: unknown) => {
      const payload = copy(v1NormalizedFixture) as unknown as { browsers: Record<string, unknown> };
      payload.browsers.chrome = entry;
      return payload;
    };
    for (const entry of [
      null,
      "Chrome",
      [],
      {},
      { name: "", type: "desktop", previewName: null },
      { name: 5, type: "desktop", previewName: null },
      { name: "Chrome", type: "desktop", previewName: 5 },
      { name: "Chrome", type: "desktop", previewName: "" },
    ]) {
      rejects(withBrowser(entry), "invalid-browser");
    }
  });

  it("checks a browsers entry only when its target is displayed", () => {
    const payload = copy(v1NormalizedFixture) as unknown as { browsers: Record<string, unknown> };
    payload.browsers.opera = null;

    expect(() => buildTableModel(payload, { browsers: "chrome nodejs" })).not.toThrow();
    expect(() => buildTableModel(payload, { browsers: "chrome opera" })).toThrow(TablePayloadError);
  });

  it("rejects a feature with an empty name or key", () => {
    for (const patch of [{ name: "" }, { key: "" }]) {
      const payload = copy(v1NormalizedFixture);
      Object.assign(payload.features[0]!, patch);
      rejects(payload, "invalid-feature");
    }
  });

  it("rejects a feature whose name is not the last segment of its key", () => {
    for (const [key, name] of [
      ["a.b.c", "b"],
      ["a.b.c", "xc"],
      ["a.b.c", "a.b.c.d"],
      ["a.b.c", "b.c"],
    ] as const) {
      const payload = copy(v1NormalizedFixture);
      Object.assign(payload.features[0]!, { key, name });
      rejects(payload, "invalid-feature");
    }
    const single = copy(v1NormalizedFixture);
    Object.assign(single.features[0]!, { key: "solo", name: "solo" });
    expect(() => buildTableModel(single)).not.toThrow();
  });

  it("rejects a feature key that an earlier feature already has", () => {
    const payload = copy(v1NormalizedFixture);
    payload.features.push(copy(payload.features[0]!));
    rejects(payload, "invalid-feature");
    expect(() => buildTableModel(payload)).toThrow(/features\[14\]\.key/);

    // Keys that differ only by a suffix are different keys.
    const distinct = copy(v1NormalizedFixture);
    Object.assign(distinct.features[0]!, { key: "a", name: "a" });
    Object.assign(distinct.features[1]!, { key: "a 1", name: "a 1" });
    expect(() => buildTableModel(distinct)).not.toThrow();
  });

  it("rejects a depth that skips a level, because its parent is not on the stack", () => {
    const payload = copy(v1NormalizedFixture) as unknown as { features: { depth: number }[] };
    payload.features[1]!.depth = 2;
    rejects(payload, "invalid-feature");
    payload.features[1]!.depth = 2 ** 32;
    rejects(payload, "invalid-feature");
  });

  it("rethrows an error from a malformed field below the support entry as the payload error", () => {
    const malformations: ((support: Record<string, unknown>) => void)[] = [
      (support) => {
        (support.branches as Record<string, unknown>[])[0]!.statements = undefined;
      },
      (support) => {
        support.branches = [null];
      },
      (support) => {
        const statement = (support.branches as { statements: Record<string, unknown>[] }[])[0]!
          .statements[0]!;
        statement.flags = undefined;
      },
      (support) => {
        const statement = (support.branches as { statements: Record<string, unknown>[] }[])[0]!
          .statements[0]!;
        statement.notes = [5];
      },
    ];
    for (const malform of malformations) {
      const payload = copy(v1NormalizedFixture);
      malform(payload.features[0]!.support.chrome as unknown as Record<string, unknown>);
      let thrown: unknown;
      try {
        buildTableModel(payload, { browsers: "chrome" });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(TablePayloadError);
      expect(thrown).toMatchObject({ reason: "invalid-content" });
      expect((thrown as Error).cause).toBeInstanceOf(Error);
    }
  });

  it("accepts a contract 1.1.0 payload and a contract 1.0.0 payload that share a feature", () => {
    const current = copy(v1NormalizedFixture);
    const older = copy(v1NormalizedFixture) as unknown as {
      contract: string;
      features: { support: Record<string, { summary: Record<string, unknown> }> }[];
    };
    older.contract = "1.0.0";
    for (const feature of older.features) {
      for (const support of Object.values(feature.support)) {
        delete support.summary.versionAddedIsApproximate;
      }
    }

    expect(current.contract).toBe("1.1.0");
    const currentModel = buildTableModel(current, phase1Options);
    const olderModel = buildTableModel(older, phase1Options);
    expect(cellFor(olderModel, v1FixtureCases.branching, "chrome")).toEqual(
      cellFor(currentModel, v1FixtureCases.branching, "chrome"),
    );
  });
});

describe("the named message fixtures", () => {
  const onlyCell = (payload: FeatureResponse): TableCell => {
    const cell = buildTableModel(payload).rows[0]?.cells[0];
    if (cell === undefined) throw new Error("No cell");
    return cell;
  };
  const itemTexts = (cell: TableCell) => cell.disclosure?.items.map((item) => item.message.text);

  it("names the target in a runtime flag on Node.js and on a browser", () => {
    expect(itemTexts(onlyCell(messageCases.runtimeFlag))).toEqual([
      "Supported since Node.js 12.16 behind a flag.",
      "To enable it, start Node.js with the command-line flag --experimental-vm-modules.",
    ]);
    expect(itemTexts(onlyCell(messageCases.browserRuntimeFlag))).toContain(
      "To enable it, start Chrome with the command-line flag --enable-blink-features set to AudioSession.",
    );
  });

  it("uses the preference message without a value when BCD gives none", () => {
    expect(itemTexts(onlyCell(messageCases.preferenceWithoutValue))).toContain(
      "To enable it, set the preference #enable-tls13-early-data.",
    );
  });

  it("reads full support in a preview, with and without a version", () => {
    const versioned = onlyCell(messageCases.fullSupportPreview);
    const unversioned = onlyCell(messageCases.previewWithoutVersion);

    expect(versioned.name.text).toBe("Supported in Firefox 151, a preview release");
    expect(versioned.compact.text).toBe("151 (preview)");
    expect(unversioned.name.id).toBe("supported-preview-unversioned");
    expect(unversioned.name.text).toBe("Supported in a preview release of Safari");
    expect(unversioned.compact.text).toBe("preview");
    expect(unversioned.disclosure).toBeNull();
  });

  it("adds the last-supported version after a removal", () => {
    const cell = onlyCell(messageCases.versionLast);

    expect(cell.name.text).toBe("Supported from Safari 3, then removed in Safari 11");
    expect(itemTexts(cell)).toEqual([
      "Supported from Safari 3, removed in Safari 11.",
      "Last supported in Safari 10.1.",
    ]);
  });
});

describe("statements that combine modifiers", () => {
  const baseStatement: SupportStatement =
    v1NormalizedFixture.features[0]!.support.chrome!.branches[0]!.statements[0]!;
  const withStatements = (
    summary: Partial<SupportTargetSupport["summary"]>,
    branches: {
      prefix: string | null;
      alternativeName: string | null;
      statements: Partial<SupportStatement>[];
    }[],
  ): TableCell => {
    const payload = copy(v1NormalizedFixture);
    const support = payload.features[0]!.support.chrome!;
    Object.assign(support.summary, summary);
    (support as { branches: unknown[] }).branches = branches.map((branch) => ({
      canonical: branch.prefix === null && branch.alternativeName === null,
      prefix: branch.prefix,
      alternativeName: branch.alternativeName,
      statements: branch.statements.map((statement) => ({
        ...baseStatement,
        prefix: branch.prefix,
        alternativeName: branch.alternativeName,
        ...statement,
      })),
    }));
    return cellFor(
      buildTableModel(payload, { browsers: "chrome" }),
      payload.features[0]!.key,
      "chrome",
    );
  };

  it("names a removal in the cell, so the name agrees with the compact range", () => {
    const cell = withStatements(
      { state: "unsupported", versionAdded: "40", versionRemoved: "50" },
      [
        {
          prefix: null,
          alternativeName: null,
          statements: [{ versionAdded: "40", versionRemoved: "50" }],
        },
      ],
    );

    expect(cell.name.id).toBe("supported-removed");
    expect(cell.name.text).toBe("Supported from Chrome 40, then removed in Chrome 50");
    expect(cell.compact.text).toBe("40 – 50");
    expect(cell.disclosure).not.toBeNull();
  });

  it("puts an approximate added or removed version inside the removal name", () => {
    const summary = {
      state: "unsupported",
      versionAdded: "40",
      versionAddedIsApproximate: true,
      versionRemoved: "50",
      versionRemovedIsApproximate: true,
    } as const;
    const cell = withStatements(summary, [
      {
        prefix: null,
        alternativeName: null,
        statements: [
          {
            versionAdded: "40",
            versionAddedIsApproximate: true,
            versionRemoved: "50",
            versionRemovedIsApproximate: true,
          },
        ],
      },
    ]);

    expect(cell.name.text).toBe(
      "Supported from Chrome 40 or earlier, then removed in Chrome 50 or earlier",
    );
    expect(cell.compact.text).toBe("≤40 – ≤50");
  });

  it("names a removal in BCD's literal preview as the target's preview release", () => {
    const cell = withStatements(
      { state: "unsupported", versionAdded: "40", versionRemoved: "preview" },
      [
        {
          prefix: null,
          alternativeName: null,
          statements: [{ versionAdded: "40", versionRemoved: "preview" }],
        },
      ],
    );

    expect(cell.name.text).toBe("Supported from Chrome 40, then removed in Chrome Canary");
  });

  it("keeps the no-support name when nothing was ever added, or no removal is recorded", () => {
    const neverAdded = withStatements(
      { state: "unsupported", versionAdded: false, versionRemoved: "50" },
      [{ prefix: null, alternativeName: null, statements: [{ versionAdded: false }] }],
    );
    // The schema does not allow this summary, so the cast stands in for a payload that breaks it.
    const noRemoval = withStatements(
      { state: "unsupported", versionAdded: "40", versionRemoved: null } as never,
      [{ prefix: null, alternativeName: null, statements: [{ versionAdded: "40" }] }],
    );

    expect(neverAdded.name.text).toBe("No support in Chrome");
    expect(noRemoval.name.text).toBe("No support in Chrome");
  });

  it("names an alternative name in the cell and needs no disclosure for it", () => {
    const cell = withStatements({ alternativeName: "intrinsic" }, [
      { prefix: null, alternativeName: "intrinsic", statements: [{}] },
    ]);

    expect(cell.name.text).toBe("Supported since Chrome 46 under the name intrinsic");
    expect(cell.disclosure).toBeNull();
  });

  it("puts an approximate version inside a modifier sentence with version-or-earlier", () => {
    const cell = withStatements(
      {
        state: "partial",
        partialImplementation: true,
        prefix: "-webkit-",
        versionAddedIsApproximate: true,
      },
      [
        {
          prefix: "-webkit-",
          alternativeName: null,
          statements: [{ partialImplementation: true, versionAddedIsApproximate: true }],
        },
      ],
    );

    expect(cell.name.text).toBe(
      "Partial support since Chrome 46 or earlier with the prefix -webkit-",
    );
    expect(cell.compact.text).toBe("≤46");
  });

  it("keeps the prefix of a preview statement in the history, where no prefixed sentence exists", () => {
    const cell = withStatements(
      { state: "preview", isPreview: true, behindFlag: false, prefix: "-moz-" },
      [{ prefix: "-moz-", alternativeName: null, statements: [{ isPreview: true }] }],
    );

    expect(cell.name.text).toBe("Supported in Chrome 46, a preview release");
    expect(cell.disclosure?.items.map((item) => item.message.text)).toEqual([
      "Supported in Chrome 46, a preview release.",
      "This uses the prefix -moz-.",
    ]);
  });

  it("writes a removal in BCD's literal preview as the target's preview release", () => {
    const cell = withStatements({ state: "unsupported", versionRemoved: "preview" }, [
      {
        prefix: null,
        alternativeName: "calendars",
        statements: [{ versionAdded: "15.4", versionRemoved: "preview", versionLast: "preview" }],
      },
    ]);

    expect(cell.disclosure?.items.map((item) => item.message.text)).toEqual([
      "Under the name calendars: supported from Chrome 15.4, removed in Chrome Canary.",
      "Last supported in Chrome Canary.",
    ]);
    expect(cell.compact.text).toBe("46 – preview");
  });

  it("writes an approximate removal and a partial prefixed removal", () => {
    const cell = withStatements({}, [
      {
        prefix: null,
        alternativeName: null,
        statements: [
          {},
          { versionAdded: "4", versionRemoved: "12", versionRemovedIsApproximate: true },
        ],
      },
      {
        prefix: "-webkit-",
        alternativeName: null,
        statements: [{ versionAdded: "2", versionRemoved: "4", partialImplementation: true }],
      },
    ]);

    expect(cell.disclosure?.items.map((item) => item.message.text)).toEqual([
      "Supported since Chrome 46.",
      "Supported from Chrome 4, removed in Chrome 12 or earlier.",
      "With the prefix -webkit-: partially supported from Chrome 2, removed in Chrome 4.",
    ]);
  });
});

describe("the Phase 1 page", () => {
  const pagePath = fileURLToPath(
    new URL("../../../docs/planning/phase1-markup/index.html", import.meta.url),
  );
  const collapse = (html: string): string =>
    html
      .replaceAll(/<[^>]+>/g, "")
      .replaceAll(/\s+/g, " ")
      .trim();
  const hiddenText = (html: string): string =>
    collapse(/class="visually-hidden"\s*>([\s\S]*?)<\/span/.exec(html)?.[1] ?? "");

  const page = readFileSync(pagePath, "utf8");
  const body = page.split("<tbody>")[1]?.split("</tbody>")[0] ?? "";
  const pageRows = body
    .split("<tr>")
    .slice(1)
    .map((row) => {
      const header = /<th[^>]*>([\s\S]*?)<\/th>/.exec(row)?.[1] ?? "";
      return {
        name: /<code>(.*?)<\/code>/.exec(header)?.[1],
        partOf: header.includes("visually-hidden") ? hiddenText(header) : null,
        cells: [...row.matchAll(/<td>([\s\S]*?)<\/td>/g)].map(([, cell = ""]) => {
          const summary = /<summary>([\s\S]*?)<\/summary>/.exec(cell)?.[1];
          return summary === undefined
            ? { sentence: hiddenText(cell), items: null }
            : {
                sentence: hiddenText(summary),
                items: [...cell.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(([, item = ""]) =>
                  collapse(item),
                ),
              };
        }),
      };
    });

  it("has the 14 rows of three cells that the comparison reads", () => {
    expect(pageRows).toHaveLength(14);
    for (const row of pageRows) expect(row.cells).toHaveLength(3);
  });

  it("shows the sentences the model builds, row by row and cell by cell", () => {
    const model = buildTableModel(v1NormalizedFixture, phase1Options);

    expect(model.caption.text).toBe(
      collapse(/<caption[^>]*>([\s\S]*?)<\/caption>/.exec(page)?.[1] ?? ""),
    );
    const modelRows = model.rows.map((row) => ({
      name: row.name,
      partOf: row.partOf?.text ?? null,
      cells: row.cells.map((cell) => ({
        sentence: cell.disclosure?.summary.text ?? cell.name.text,
        items: cell.disclosure?.items.map((item) => item.message.text) ?? null,
      })),
    }));
    expect(modelRows).toEqual(pageRows);
  });
});

describe("the cost of building the model", () => {
  // The model reports nothing about its own work, so the test measures it from outside. Every
  // object of the payload is wrapped in a Proxy that counts each property read, each own-property
  // check, and each key listing. A hidden second scan of the features, the targets, or the
  // statements adds reads that the model cannot hide.
  type Reads = { count: number };

  const counting = <Value>(value: Value, reads: Reads): Value => {
    if (typeof value !== "object" || value === null) return value;
    return new Proxy(value, {
      get(target, property) {
        reads.count += 1;
        return counting(Reflect.get(target, property), reads);
      },
      has(target, property) {
        reads.count += 1;
        return Reflect.has(target, property);
      },
      getOwnPropertyDescriptor(target, property) {
        reads.count += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      ownKeys(target) {
        reads.count += 1;
        return Reflect.ownKeys(target);
      },
    });
  };

  const baseStatement =
    v1NormalizedFixture.features[0]!.support.chrome!.branches[0]!.statements[0]!;
  const baseSummary = v1NormalizedFixture.features[0]!.support.chrome!.summary;

  // Every cell gets its own support object, branch, and statements, so no cell shares work with
  // another. `chain` makes each feature one level deeper than the one before it, the deepest
  // possible nesting. `mixed` cycles through depths 0 to 3.
  const syntheticPayload = (
    featureCount: number,
    targetCount: number,
    statementsPerCell: number,
    shape: "chain" | "mixed",
  ): { payload: FeatureResponse; browsers: string } => {
    const targets = Array.from({ length: targetCount }, (_, index) => `target_${index}`);
    const supportFor = (): SupportTargetSupport =>
      ({
        summary: { ...baseSummary },
        branches: [
          {
            canonical: true,
            prefix: null,
            alternativeName: null,
            statements: Array.from(
              { length: statementsPerCell },
              (_, index): SupportStatement =>
                ({
                  ...baseStatement,
                  flags: [],
                  notes: [],
                  versionAdded: String(index + 1),
                  versionRemoved: index % 2 === 0 ? null : String(index + 2),
                }) as SupportStatement,
            ),
          },
        ],
      }) as SupportTargetSupport;
    const payload: FeatureResponse = {
      contract: "1.1.0",
      query: "synthetic.root",
      browsers: Object.fromEntries(
        targets.map((id) => [id, { name: id, type: "desktop", previewName: null }]),
      ),
      features: Array.from({ length: featureCount }, (_, index) => ({
        key: `synthetic.root.f${index}`,
        name: `f${index}`,
        depth: shape === "chain" ? index : index === 0 ? 0 : Math.min(1 + (index % 3), index),
        description: null,
        mdnUrl: null,
        specUrls: [],
        status: null,
        tags: [],
        support: Object.fromEntries(targets.map((id) => [id, supportFor()])),
      })),
    };
    return { payload, browsers: targets.join(" ") };
  };

  const reads = (
    featureCount: number,
    targetCount: number,
    statementsPerCell: number,
    shape: "chain" | "mixed" = "chain",
  ): number => {
    const { payload, browsers } = syntheticPayload(
      featureCount,
      targetCount,
      statementsPerCell,
      shape,
    );
    const counter: Reads = { count: 0 };
    buildTableModel(counting(payload, counter), { browsers });
    return counter.count;
  };

  const PER_STATEMENT_READS = 25;
  const PER_CELL_READS = 45;
  const PER_FEATURE_READS = 18;

  // Equal steps in the input give equal steps in the reads when the cost is linear. A quadratic
  // cost makes each step larger than the one before it.
  const expectLinear = (measure: (size: number) => number, unit: number) => {
    const [one, two, four] = [measure(unit), measure(2 * unit), measure(4 * unit)];

    expect(four - two).toBe(2 * (two - one));
    expect(two).toBeGreaterThan(one);
  };

  it("grows the reads linearly when the features double, in a deep chain and in a mixed shape", () => {
    expectLinear((size) => reads(size, 6, 2, "chain"), 250);
    expectLinear((size) => reads(size, 6, 2, "mixed"), 250);
  });

  it("grows the reads linearly when the displayed targets double", () => {
    expectLinear((size) => reads(120, size, 2), 5);
  });

  it("grows the reads linearly when the statements in each cell double", () => {
    expectLinear((size) => reads(60, 6, size), 3);
  });

  it("reads each statement, cell, and feature a fixed number of times, so no second scan is hidden", () => {
    // Each cost is a difference between two sizes, which cancels the envelope's constant reads.
    // The ceilings sit a little above the measured values, so one more pass over the statements,
    // the targets, or the features pushes the model past them.
    const perStatement = (reads(60, 6, 4) - reads(60, 6, 2)) / (60 * 6 * 2);
    const perCell = (reads(60, 12, 1) - reads(60, 6, 1)) / (60 * 6) - perStatement;
    const perFeature = (reads(120, 6, 1) - reads(60, 6, 1)) / 60 - 6 * (perCell + perStatement);

    expect(perStatement).toBeLessThanOrEqual(PER_STATEMENT_READS);
    expect(perCell).toBeLessThanOrEqual(PER_CELL_READS);
    expect(perFeature).toBeLessThanOrEqual(PER_FEATURE_READS);
  });

  it("states its time and space complexity in the module's header comment", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/model/table-model.ts", import.meta.url)),
      "utf8",
    );
    const header = source.split("*/")[0] ?? "";

    expect(header).toContain("Time is O(F × T + S + C)");
    expect(header).toContain("Space is O(F × T + S + C)");
  });
});

describe("the model's source", () => {
  const modelDirectory = fileURLToPath(new URL("../src/model/", import.meta.url));
  const stripComments = (source: string): string =>
    source
      .replaceAll(/\/\*[\s\S]*?\*\//g, "")
      .replaceAll(/^\s*\/\/.*$/gm, "")
      .replaceAll(/\s\/\/\s.*$/gm, "");
  const stringLiterals = (source: string): string[] =>
    source.match(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g) ?? [];
  // Two words in a row inside a string literal: the start of a sentence a reader would see.
  const sentenceLiterals = (source: string): string[] =>
    stringLiterals(stripComments(source)).filter((literal) =>
      /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(literal),
    );

  it("detects a sentence literal, so the check below can fail", () => {
    expect(sentenceLiterals('const name = "Supported since " + target;')).toEqual([
      '"Supported since "',
    ]);
    expect(sentenceLiterals('const id = "supported-since"; // Supported since')).toEqual([]);
  });

  it("holds message ids, never a sentence literal or a piece of a message", () => {
    const files = readdirSync(modelDirectory).filter((file) => file.endsWith(".ts"));
    // The words of every message, between its placeholders, wherever there are two or more.
    const fragments = Object.values(en).flatMap((text) =>
      text
        .split(/\{[A-Za-z]+\}/)
        .map((fragment) => fragment.trim())
        .filter((fragment) => /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(fragment)),
    );

    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const file of files) {
      const source = readFileSync(`${modelDirectory}${file}`, "utf8");
      expect(sentenceLiterals(source), file).toEqual([]);
      const code = stripComments(source);
      for (const fragment of fragments)
        expect(code.includes(fragment), `${file}: ${fragment}`).toBe(false);
    }
  });
});
