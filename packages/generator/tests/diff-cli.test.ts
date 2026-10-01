import { describe, expect, it } from "vitest";

import { diffUsage, parseDiffCommand } from "../src/diff-cli.js";

const arguments_ = ["--baseline", "previous", "--candidate", "next"];

describe("parseDiffCommand", () => {
  it("defines the documented output-diff CLI grammar", () => {
    expect(parseDiffCommand(arguments_)).toEqual({
      type: "diff",
      baselineRoot: "previous",
      candidateRoot: "next",
    });
    expect(parseDiffCommand([...arguments_, "--approval", "approval.json"])).toEqual({
      type: "diff",
      baselineRoot: "previous",
      candidateRoot: "next",
      approvalPath: "approval.json",
    });
    expect(diffUsage).toContain("--baseline <directory> --candidate <directory>");
  });

  it.each(["--help", "-h"])("accepts %s as the sole help argument", (help) => {
    expect(parseDiffCommand([help])).toEqual({ type: "help" });
  });

  it.each([
    [[], "required"],
    [["--baseline", "previous"], "required"],
    [[...arguments_, "--unknown", "value"], "Unknown"],
    [[...arguments_, "--candidate", "duplicate"], "only"],
    [["--baseline", "--candidate", "next"], "requires"],
    [["--baseline", "", "--candidate", "next"], "empty"],
    [[...arguments_, "--approval", ""], "empty"],
  ])("rejects %j", (input, message) => {
    expect(() => parseDiffCommand(input)).toThrow(message);
  });
});
