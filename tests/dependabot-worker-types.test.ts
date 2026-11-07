import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

type Step = {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
};

describe("Dependabot Worker types workflow", () => {
  it("runs the updated dependencies only in a read-only job on Dependabot's own pull requests", async () => {
    const workflow = parse(await read("../.github/workflows/dependabot-worker-types.yml"));
    expect(workflow.on.pull_request.paths).toEqual(["pnpm-lock.yaml"]);
    expect(workflow.permissions).toEqual({ contents: "read" });
    const generate = workflow.jobs.generate;
    expect(generate.if).toContain("github.event.pull_request.user.login == 'dependabot[bot]'");
    expect(generate.if).toContain("head.repo.full_name == github.repository");
    expect(generate.permissions).toEqual({ contents: "read" });
    const checkout = generate.steps.find((step: Step) => step.id === "checkout");
    expect(checkout.with).toMatchObject({
      ref: "${{ github.event.pull_request.head.sha }}",
      "persist-credentials": false,
    });
  });

  it("gives the write token only to a job that never checks out or installs", async () => {
    const workflow = parse(await read("../.github/workflows/dependabot-worker-types.yml"));
    const commit = workflow.jobs.commit;
    expect(commit.permissions).toEqual({ contents: "write" });
    for (const step of commit.steps as Step[]) {
      expect(step.uses ?? "").not.toMatch(/checkout|setup-node|action-setup/);
      // Messages may name these tools; no line may run one.
      expect(step.run ?? "").not.toMatch(/^\s*(pnpm|npm|npx|node|wrangler)\b/m);
    }
    const commitStep = commit.steps.find(
      (step: Step) => step.name === "Commit the regenerated types",
    );
    expect(commitStep.run).toContain("[dependabot skip]");
    expect(commitStep.run).toContain("expectedHeadOid");
  });

  it("checks the artifact against the header of the committed types file", async () => {
    const workflow = parse(await read("../.github/workflows/dependabot-worker-types.yml"));
    const check = workflow.jobs.commit.steps.find(
      (step: Step) => step.name === "Check the artifact",
    );
    const prefix = /expected_prefix='([^']+)'/.exec(check.run)?.[1];
    const [firstLine, secondLine] = (await read("../apps/worker/worker-configuration.d.ts")).split(
      "\n",
    );
    expect(firstLine).toBe("/* eslint-disable */");
    expect(prefix).toBeDefined();
    expect(secondLine.startsWith(prefix!)).toBe(true);
    // The generate job runs the same script whose output the CI typecheck compares against.
    const worker = JSON.parse(await read("../apps/worker/package.json"));
    expect(worker.scripts.typecheck).toContain(`${worker.scripts["wrangler:types"]} --check`);
  });
});
