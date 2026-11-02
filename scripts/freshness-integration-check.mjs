import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
  for (const [name, changes, generated] of [
    ["baseline", 0, "2026-10-01T00:00:00Z"],
    ["unchanged", 0, "2026-10-01T00:00:00Z"],
    ["routine", 1, "2026-10-01T00:00:00Z"],
    ["blocked", 20, "2026-10-01T00:00:00Z"],
    // The same content generated later, as a rebased or rerun PR would produce it.
    ["blocked-rerun", 20, "2026-10-02T00:00:00Z"],
  ]) {
    await emitGeneratedSnapshot({
      outputRoot: join(root, name),
      generatedSnapshot: generateSnapshot({
        generated,
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
  const compare = (name, approvals) => {
    const args = [script, "--baseline", baseline, "--candidate", join(root, name)];
    const result = spawnSync(process.execPath, [...args, "--approvals", approvals], {
      encoding: "utf8",
    });
    return { status: result.status, stderr: result.stderr, report: JSON.parse(result.stdout) };
  };
  const blocked = JSON.parse(
    spawnSync(
      process.execPath,
      [script, "--baseline", baseline, "--candidate", join(root, "blocked")],
      {
        encoding: "utf8",
      },
    ).stdout,
  );
  const approval = {
    baselineVersion: blocked.baselineVersion,
    candidateVersion: blocked.candidateVersion,
    baselineSemanticDigest: blocked.baselineSemanticDigest,
    candidateSemanticDigest: blocked.semanticDigest,
    reason: "Upstream removed these features.",
  };
  const approvals = join(root, "approvals.json");
  await writeFile(approvals, JSON.stringify([approval]));
  const approvedRerun = compare("blocked-rerun", approvals);
  assert.equal(approvedRerun.status, 0, approvedRerun.stderr);
  assert.notEqual(approvedRerun.report.candidateDigest, blocked.candidateDigest);
  assert.deepEqual(approvedRerun.report.reviewApproval, approval);
  // A stale approval neither passes a different blocked diff nor fails a routine one.
  await writeFile(
    approvals,
    JSON.stringify([{ ...approval, candidateSemanticDigest: blocked.baselineSemanticDigest }]),
  );
  assert.equal(compare("blocked", approvals).status, 2);
  const routine = compare("routine", approvals);
  assert.equal(routine.status, 0, routine.stderr);
  assert.equal(routine.report.reviewApproval, null);
  process.stdout.write(
    "Freshness CLI integration passed: unchanged, routine, excessive, and reviewed output diffs.\n",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
