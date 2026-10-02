import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { emitGeneratedSnapshot, generateSnapshot } from "../packages/generator/dist/index.js";

const require = createRequire(new URL("../packages/generator/package.json", import.meta.url));
const bcd = require("@mdn/browser-compat-data");
const fixture = (changes) => ({
  ...Object.fromEntries(
    Object.keys(bcd)
      .filter((key) => key !== "__meta" && key !== "browsers")
      .map((key) => [key, {}]),
  ),
  __meta: { version: bcd.__meta.version, timestamp: "2026-09-01T00:00:00Z" },
  browsers: {
    chrome: {
      name: "Chrome",
      type: "desktop",
      accepts_flags: true,
      accepts_webextensions: true,
      releases: { 1: { index: 0, status: "current" } },
    },
  },
  api: Object.fromEntries(
    Array.from({ length: 20 }, (_, index) => [
      `feature${index}`,
      {
        __compat: {
          source_file: `api/feature${index}.json`,
          support: { chrome: { version_added: index < changes ? "2" : "1" } },
        },
      },
    ]),
  ),
});

const root = await mkdtemp(join(tmpdir(), "bcd-freshness-cli-"));
try {
  const baseline = join(root, "baseline");
  for (const [name, changes] of [
    ["baseline", 0],
    ["unchanged", 0],
    ["routine", 1],
    ["blocked", 20],
  ]) {
    await emitGeneratedSnapshot({
      outputRoot: join(root, name),
      generatedSnapshot: generateSnapshot({
        generated: "2026-10-01T00:00:00Z",
        expires: "2026-12-30",
        data: fixture(changes),
      }),
    });
  }
  const script = fileURLToPath(new URL("./compare-freshness-output.mjs", import.meta.url));
  for (const [name, expectedStatus, semanticChanged] of [
    ["unchanged", 0, false],
    ["routine", 0, true],
    ["blocked", 2, true],
  ]) {
    const result = spawnSync(
      process.execPath,
      [script, "--baseline", baseline, "--candidate", join(root, name)],
      { encoding: "utf8" },
    );
    assert.equal(result.status, expectedStatus, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.semanticChanged, semanticChanged);
    assert.equal(report.blocked.length > 0, expectedStatus === 2);
  }
  process.stdout.write(
    "Freshness CLI integration passed: unchanged, routine, and excessive output diffs.\n",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
