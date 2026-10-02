import { describe, expect, it } from "vitest";

import { enableAutoMerge } from "../scripts/enable-auto-merge.mjs";

const sha = "a".repeat(40);
const repository = "example/bcd-embed";
const pull = {
  user: { login: "dependabot[bot]", id: 49699333, type: "Bot" },
  head: { sha, repo: { full_name: repository } },
  base: { ref: "main", repo: { full_name: repository } },
  state: "open",
};
const job = {
  name: "check",
  workflow_name: "CI",
  head_sha: sha,
  status: "completed",
  conclusion: "success",
};
const env = { AUTO_MERGE_ENABLED: "true", GH_REPO: repository, PR_NUMBER: "123", PR_SHA: sha };

const transport = (candidatePull = pull, candidateJob = job) => {
  const calls: string[][] = [];
  let reads = 0;
  const execute = (_command: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "pr") return "";
    if (args[1].includes("/pulls/")) {
      reads += 1;
      return JSON.stringify([
        typeof candidatePull === "function" ? candidatePull(reads) : candidatePull,
      ]);
    }
    if (args[1].includes("/workflows/"))
      return JSON.stringify([
        { workflow_runs: [{ id: 42, head_sha: sha, event: "pull_request" }] },
      ]);
    return JSON.stringify([{ jobs: [candidateJob] }]);
  };
  return { calls, execute };
};

describe("exact-head auto-merge integration", () => {
  it("defaults disabled and performs no API call", () => {
    const fake = transport();
    expect(enableAutoMerge({ env: {}, execute: fake.execute })).toEqual({
      enabled: false,
      reason: "operator_disabled",
    });
    expect(fake.calls).toEqual([]);
  });

  it("checks successful exact-head CI before enabling without an admin bypass", () => {
    const fake = transport();
    expect(enableAutoMerge({ env, execute: fake.execute })).toEqual({ enabled: true, sha });
    expect(fake.calls.at(-1)).toEqual([
      "pr",
      "merge",
      "123",
      "--auto",
      "--squash",
      "--match-head-commit",
      sha,
    ]);
    expect(fake.calls.filter((call) => call[1].includes("/pulls/"))).toHaveLength(2);
  });

  it.each(["failure", "neutral", "skipped", null])("blocks a %s CI conclusion", (conclusion) => {
    const fake = transport(pull, { ...job, conclusion });
    expect(() => enableAutoMerge({ env, execute: fake.execute })).toThrow(
      "CI / check must be SUCCESS",
    );
    expect(fake.calls.some((call) => call[0] === "pr")).toBe(false);
  });

  it("blocks stale heads, fork repositories, impersonated bots, and head movement", () => {
    for (const candidate of [
      { ...pull, user: { ...pull.user, id: 1 } },
      { ...pull, head: { ...pull.head, repo: { full_name: "attacker/fork" } } },
      { ...pull, head: { ...pull.head, sha: "b".repeat(40) } },
    ]) {
      const fake = transport(candidate);
      expect(() => enableAutoMerge({ env, execute: fake.execute })).toThrow(
        "trusted Dependabot PR",
      );
      expect(fake.calls.some((call) => call[0] === "pr")).toBe(false);
    }
    const stale = transport(pull, { ...job, head_sha: "b".repeat(40) });
    expect(() => enableAutoMerge({ env, execute: stale.execute })).toThrow(
      "CI / check must be SUCCESS",
    );
    const moved = transport((read: number) =>
      read === 1 ? pull : { ...pull, head: { ...pull.head, sha: "b".repeat(40) } },
    );
    expect(() => enableAutoMerge({ env, execute: moved.execute })).toThrow("trusted Dependabot PR");
    expect(moved.calls.some((call) => call[0] === "pr")).toBe(false);
  });
});
