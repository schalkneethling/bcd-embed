import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { en, formatMessage, MissingPlaceholderError, selectStrings } from "../src/index.js";
import type { MessageId } from "../src/index.js";

const inventoryPath = fileURLToPath(
  new URL("../../../docs/planning/07-component-phase1-markup.md", import.meta.url),
);

// Reads the message ids and texts from the "String inventory" table in Document 7.
const readInventory = (): Map<string, string> => {
  const document = readFileSync(inventoryPath, "utf8");
  const section = document.split("## String inventory")[1]?.split("\n## ")[0] ?? "";
  const rows = [...section.matchAll(/^\| `([a-z-]+)`\s*\| (.+?)\s*\|$/gm)];
  return new Map(rows.map((row) => [row[1] ?? "", row[2] ?? ""]));
};

describe("the English message table", () => {
  it("holds exactly the messages in Document 7's string inventory, with the same text", () => {
    const inventory = readInventory();

    expect(inventory.size).toBeGreaterThan(0);
    expect(Object.keys(en).toSorted()).toEqual([...inventory.keys()].toSorted());
    for (const [id, text] of inventory) {
      expect(en[id as MessageId], id).toBe(text);
    }
  });

  it("holds the messages that the Phase 1 fixture could not exercise", () => {
    const ids: MessageId[] = [
      "platform-mobile",
      "platform-xr",
      "platform-other",
      "supported-preview",
      "history-last-supported",
      "flag-runtime",
      "flag-runtime-value",
      "loading",
      "error",
    ];

    for (const id of ids) expect(en[id], id).toBeTypeOf("string");
  });

  it("keeps every placeholder to a plain name", () => {
    for (const [id, text] of Object.entries(en)) {
      const braces = text.match(/[{}]/g) ?? [];
      const placeholders = text.match(/\{[A-Za-z][A-Za-z0-9]*\}/g) ?? [];
      expect(braces.length, id).toBe(placeholders.length * 2);
    }
  });
});

describe("formatMessage", () => {
  it("substitutes every placeholder in a message with {target} and {version}", () => {
    const table = selectStrings("en");

    expect(formatMessage(table, "supported-since", { target: "Chrome", version: "46" })).toBe(
      "Supported since Chrome 46",
    );
  });

  it("substitutes a placeholder that appears more than once", () => {
    const table = selectStrings("en");

    expect(
      formatMessage(table, "history-removed", { target: "Chrome", added: "11", removed: "12" }),
    ).toBe("Supported from Chrome 11, removed in Chrome 12.");
  });

  it("throws a typed error that names the missing placeholder", () => {
    const table = selectStrings("en");
    // The cast stands in for a caller that the type checker cannot see, such as a translation
    // whose placeholder the English message does not have.
    const values = { target: "Chrome" } as unknown as { target: string; version: string };

    const thrown = (() => {
      try {
        formatMessage(table, "supported-since", values);
      } catch (error) {
        return error;
      }
      return undefined;
    })();

    expect(thrown).toBeInstanceOf(MissingPlaceholderError);
    expect(thrown).toMatchObject({ messageId: "supported-since", placeholder: "version" });
    expect((thrown as Error).message).toContain("{version}");
  });

  it("does not take a placeholder value from the object's prototype", () => {
    const table = selectStrings("en");
    const values = { target: "Chrome" } as unknown as { target: string; version: string };

    expect(() => formatMessage(table, "supported-since", values)).toThrow(MissingPlaceholderError);
    expect(() =>
      formatMessage(table, "note", { toString: "x" } as unknown as { text: string }),
    ).toThrow(MissingPlaceholderError);
  });

  it("keeps braces that sit inside a value", () => {
    expect(formatMessage(en, "note", { text: "use {target} here" })).toBe(
      "Note: use {target} here",
    );
  });
});

describe("selectStrings", () => {
  it("selects English for an unknown locale tag such as xx", () => {
    expect(selectStrings("xx")).toBe(en);
  });

  it("selects English when the locale is missing or empty", () => {
    expect(selectStrings(null)).toBe(en);
    expect(selectStrings(undefined)).toBe(en);
    expect(selectStrings("")).toBe(en);
  });

  it("selects English for en and for a regional variant of it", () => {
    expect(selectStrings("en")).toBe(en);
    expect(selectStrings("en-GB")).toBe(en);
    expect(selectStrings("EN-gb")).toBe(en);
  });

  it("treats names from Object.prototype as unknown locales", () => {
    expect(selectStrings("constructor")).toBe(en);
    expect(selectStrings("__proto__")).toBe(en);
  });
});
