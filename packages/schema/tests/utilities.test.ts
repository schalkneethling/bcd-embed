import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { bcdSourceFixtures, v1FixtureCases, v1NormalizedFixture } from "../src/fixtures/v1.js";
import { validateContract } from "../scripts/lib/contract-validation.mjs";
import { createFixtureReport, formatFixtureReport } from "../scripts/lib/fixture-report.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const validateScript = join(packageRoot, "scripts/validate-contract.mjs");
const reportScript = join(packageRoot, "scripts/report-fixtures.mjs");

const runNode = (arguments_: string[], input?: string) =>
  new Promise<{ status: number | null; stderr: string; stdout: string }>((resolvePromise) => {
    const child = spawn(process.execPath, arguments_, {
      cwd: packageRoot,
      stdio: "pipe",
    });
    let stderr = "";
    let stdout = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.on("close", (status) => resolvePromise({ status, stderr, stdout }));
    child.stdin.end(input);
  });

describe("contract validator utility", () => {
  it("accepts the golden feature fixture in both validators", () => {
    const result = validateContract("feature-response", v1NormalizedFixture);

    expect(result.valid).toBe(true);
    expect(result.zod.valid).toBe(true);
    expect(result.jsonSchema.valid).toBe(true);
  });

  it("reports paths from both validators for malformed input", () => {
    const malformed = structuredClone(v1NormalizedFixture);
    malformed.features = [];
    const result = validateContract("feature-response", malformed);

    expect(result.valid).toBe(false);
    expect(result.zod.errors.some(({ path }: { path: string }) => path === "/features")).toBe(true);
    expect(
      result.jsonSchema.errors.some(({ path }: { path: string }) => path === "/features"),
    ).toBe(true);
  });

  it("documents its terminal interface", async () => {
    const result = await runNode([validateScript, "--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: pnpm schema:validate");
    expect(result.stderr).toBe("");
  });

  it("validates a file and standard input through the terminal interface", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "bcd-embed-contract-"));
    const fixturePath = join(temporaryDirectory, "feature-response.json");
    writeFileSync(fixturePath, JSON.stringify(v1NormalizedFixture));

    try {
      const fromFile = await runNode([validateScript, "--kind", "feature-response", fixturePath]);
      const fromStdin = await runNode(
        [validateScript, "--kind", "feature-response", "-"],
        JSON.stringify(v1NormalizedFixture),
      );

      for (const result of [fromFile, fromStdin]) {
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("PASS Zod");
        expect(result.stdout).toContain("PASS JSON Schema");
        expect(result.stderr).toBe("");
      }
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  it("returns a failure status for a rejected contract", async () => {
    const malformed = structuredClone(v1NormalizedFixture);
    malformed.features = [];

    const result = await runNode(
      [validateScript, "--kind", "feature-response", "-"],
      JSON.stringify(malformed),
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL Zod");
    expect(result.stdout).toContain("FAIL JSON Schema");
  });
});

describe("fixture report utility", () => {
  it("catalogues named cases and measures the Array subtree", () => {
    const report = createFixtureReport({
      normalized: v1NormalizedFixture,
      cases: v1FixtureCases,
      source: bcdSourceFixtures,
    });

    expect(report.source.version).toBe("8.0.13");
    expect(report.namedCases.some(({ name }) => name === "branching")).toBe(true);
    expect(report.subtrees).toEqual([
      expect.objectContaining({
        key: "javascript.builtins.Array",
        compatibilityFeatures: expect.any(Number),
        bytes: expect.any(Number),
      }),
    ]);
    expect(report.subtrees[0]!.compatibilityFeatures).toBe(51);
    expect(formatFixtureReport(report)).toContain("Named cases");
  });

  it("emits machine-readable JSON through the terminal interface", async () => {
    const result = await runNode(["--import", "tsx", reportScript, "--json"]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        source: expect.objectContaining({ version: "8.0.13" }),
      }),
    );
    expect(result.stderr).toBe("");
  });
});
