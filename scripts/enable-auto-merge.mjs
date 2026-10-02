import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const assertTrustedPullRequest = (pull, repository, sha) => {
  if (
    pull.user?.login !== "dependabot[bot]" ||
    pull.user?.id !== 49699333 ||
    pull.user?.type !== "Bot" ||
    pull.head?.repo?.full_name !== repository ||
    pull.base?.repo?.full_name !== repository ||
    pull.base?.ref !== "main" ||
    pull.head?.sha !== sha ||
    pull.state !== "open"
  ) {
    throw new Error("Auto-merge requires an open, trusted Dependabot PR at the checked head.");
  }
};

export const hasSuccessfulExactHeadCheck = (jobs, sha) =>
  jobs.some(
    (job) =>
      job.workflow_name === "CI" &&
      job.name === "check" &&
      job.head_sha === sha &&
      job.status === "completed" &&
      job.conclusion === "success",
  );

export const enableAutoMerge = ({ env = process.env, execute = execFileSync } = {}) => {
  if (env.AUTO_MERGE_ENABLED !== "true") {
    return { enabled: false, reason: "operator_disabled" };
  }
  const { GH_REPO: repository, PR_NUMBER: number, PR_SHA: sha } = env;
  if (!repository || !/^\d+$/.test(number ?? "") || !/^[a-f0-9]{40}$/.test(sha ?? "")) {
    throw new Error("Auto-merge requires repository, numeric PR number, and exact head SHA.");
  }
  const api = (endpoint) =>
    JSON.parse(execute("gh", ["api", endpoint, "--paginate", "--slurp"], { encoding: "utf8" }));
  const pullEndpoint = `repos/${repository}/pulls/${number}`;
  assertTrustedPullRequest(api(pullEndpoint)[0], repository, sha);
  const runs = api(`repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=100`)
    .flatMap((page) => page.workflow_runs)
    .filter((run) => run.head_sha === sha && run.event === "pull_request")
    .sort((left, right) => right.id - left.id);
  const [latestRun] = runs;
  if (!latestRun) throw new Error("No CI run exists at the exact checked PR head.");
  if (latestRun.status !== "completed") {
    execute(
      "gh",
      ["run", "watch", String(latestRun.id), "--exit-status", "--compact", "--interval", "15"],
      {
        encoding: "utf8",
        timeout: 12 * 60 * 1000,
      },
    );
  }
  const jobs = api(
    `repos/${repository}/actions/runs/${latestRun.id}/jobs?filter=latest&per_page=100`,
  ).flatMap((page) => page.jobs);
  if (!hasSuccessfulExactHeadCheck(jobs, sha)) {
    throw new Error("CI / check must be SUCCESS at the exact checked PR head before auto-merge.");
  }
  // Re-read immediately before the write; the merge command also enforces this SHA.
  assertTrustedPullRequest(api(pullEndpoint)[0], repository, sha);
  execute("gh", ["pr", "merge", number, "--auto", "--squash", "--match-head-commit", sha], {
    encoding: "utf8",
  });
  return { enabled: true, sha };
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${JSON.stringify(enableAutoMerge())}\n`);
}
