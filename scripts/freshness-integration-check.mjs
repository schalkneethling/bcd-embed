import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { emitContentTree, generateSnapshot } from "../packages/generator/dist/index.js";

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
    await emitContentTree({
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
  // The digest is the hash of the root, which holds no timestamp, so a rerun keeps it.
  assert.equal(approvedRerun.report.candidateDigest, blocked.candidateDigest);
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

  // A baseline published under an earlier contract. Only `meta.json` names the contract among
  // the files the pointer comparison reads, so changing it there is enough for both checks.
  const earlier = join(root, "earlier-contract");
  await cp(baseline, earlier, { recursive: true });
  const earlierMeta = join(earlier, "v1/meta.json");
  const meta = JSON.parse(await readFile(earlierMeta, "utf8"));
  await writeFile(earlierMeta, `${JSON.stringify({ ...meta, contract: "1.0.0" })}\n`);
  // A normal freshness run still rejects it before the magnitude gate.
  const strict = spawnSync(
    process.execPath,
    [script, "--baseline", earlier, "--candidate", join(root, "blocked")],
    { encoding: "utf8" },
  );
  assert.equal(strict.status, 1, strict.stderr);
  assert.match(strict.stderr, /Invalid artifact 'v1\/meta\.json'/);
  // The contract-change comparison reads its pointers and blocks on magnitude alone.
  const contractChange = fileURLToPath(new URL("./compare-contract-change.mjs", import.meta.url));
  const crossed = spawnSync(
    process.execPath,
    [contractChange, "--baseline", earlier, "--candidate", join(root, "blocked")],
    { encoding: "utf8" },
  );
  assert.equal(crossed.status, 2, crossed.stderr);
  const crossedReport = JSON.parse(crossed.stdout);
  assert.equal(crossedReport.baselineContract, "1.0.0");
  assert.deepEqual(crossedReport.blocked, [blocked.blocked[0]]);
  assert.equal(crossedReport.baselineSemanticDigest, blocked.baselineSemanticDigest);
  assert.equal(crossedReport.semanticDigest, blocked.semanticDigest);
  // It refuses a baseline at the current contract, which the full comparison must check instead.
  const sameContract = spawnSync(
    process.execPath,
    [contractChange, "--baseline", baseline, "--candidate", join(root, "blocked")],
    { encoding: "utf8" },
  );
  assert.equal(sameContract.status, 1);
  assert.match(sameContract.stderr, /already at contract/);
  process.stdout.write(
    "Freshness CLI integration passed: unchanged, routine, excessive, reviewed, and contract-change output diffs.\n",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
