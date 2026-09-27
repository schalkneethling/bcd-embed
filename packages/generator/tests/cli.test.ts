import { describe, expect, it } from "vitest";

import { parseGenerateCommand, usage } from "../src/cli.js";

const arguments_ = [
  "--out",
  "artifacts",
  "--generated",
  "2026-09-27T12:00:00Z",
  "--expires",
  "2026-12-26",
];

describe("parseGenerateCommand", () => {
  it("defines the documented option grammar", () => {
    expect(parseGenerateCommand(arguments_)).toEqual({
      type: "generate",
      outputRoot: "artifacts",
      generated: "2026-09-27T12:00:00Z",
      expires: "2026-12-26",
    });
    expect(usage).toContain("--out <directory> --generated <timestamp> --expires <date>");
  });

  it.each(["--help", "-h"])("accepts %s as the sole help argument", (help) => {
    expect(parseGenerateCommand([help])).toEqual({ type: "help" });
  });

  it.each([
    [[], "required"],
    [["--out", "artifacts", "--generated", "2026-09-27T12:00:00Z"], "required"],
    [["--out", "artifacts", "--generated", "not-a-date", "--expires", "2026-12-26"], "timestamp"],
    [
      ["--out", "artifacts", "--generated", "2026-09-27T12:00:00Z", "--expires", "tomorrow"],
      "calendar",
    ],
    [["--out", "", "--generated", "2026-09-27T12:00:00Z", "--expires", "2026-12-26"], "empty"],
    [[...arguments_, "--unknown", "value"], "Unknown"],
    [[...arguments_, "--out", "again"], "only"],
    [["--out", "--generated", "2026-09-27T12:00:00Z", "--expires", "2026-12-26"], "requires"],
    [["output", ...arguments_], "Unknown"],
  ])("rejects %j", (input, message) => {
    expect(() => parseGenerateCommand(input)).toThrow(message);
  });
});
