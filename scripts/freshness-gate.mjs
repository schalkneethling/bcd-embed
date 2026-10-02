#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { BCD_PACKAGE, classifyBcdCandidate, validateBcdCandidate } from "./freshness-policy.mjs";

const usage = "Usage: freshness-gate --base <directory> --base-sha <sha> --candidate <directory>";
const values = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const option = process.argv[index];
  const value = process.argv[index + 1];
  if (option === undefined || value === undefined || !option.startsWith("--"))
    throw new Error(usage);
  values.set(option, value);
}
const baseRoot = values.get("--base");
const baseSha = values.get("--base-sha");
const candidateRoot = values.get("--candidate");
if (
  baseRoot === undefined ||
  baseSha === undefined ||
  candidateRoot === undefined ||
  values.size !== 3
)
  throw new Error(usage);

const base = resolve(baseRoot);
const candidate = resolve(candidateRoot);
const changed = spawnSync("git", ["-C", candidate, "diff", "--name-only", baseSha, "HEAD"], {
  encoding: "utf8",
});
if (changed.status !== 0 && changed.status !== 1)
  throw new Error(changed.stderr || "Could not inspect candidate diff.");
const changedPaths = changed.stdout.split("\n").filter(Boolean);
const classification = await classifyBcdCandidate({ baseRoot: base, candidateRoot: candidate });
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `kind=${classification.kind}\n`);
}
if (classification.kind === "non_bcd") {
  process.stdout.write(`${JSON.stringify({ kind: "non_bcd" })}\n`);
  process.exit();
}
const manifest = JSON.parse(
  await readFile(resolve(candidate, "packages/generator/package.json"), "utf8"),
);
const version = manifest.dependencies?.[BCD_PACKAGE];
if (typeof version !== "string") throw new Error("Candidate generator manifest has no BCD pin.");
const metadata = JSON.parse(
  execFileSync(
    "pnpm",
    [
      "view",
      `${BCD_PACKAGE}@${version}`,
      "version",
      "dist.integrity",
      "--json",
      "--registry=https://registry.npmjs.org",
    ],
    { encoding: "utf8" },
  ),
);
const result = await validateBcdCandidate({
  baseRoot: base,
  candidateRoot: candidate,
  changedPaths,
  registryMetadata: metadata,
});
process.stdout.write(`${JSON.stringify({ kind: "bcd", ...result })}\n`);
