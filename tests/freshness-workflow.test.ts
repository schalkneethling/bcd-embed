import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

describe("freshness automation policy", () => {
  it("groups exact BCD pins without changing existing cooldowns", async () => {
    const dependabot = await read("../.github/dependabot.yml");
    expect(dependabot).toContain("bcd-pins:");
    expect(dependabot).toContain('group-by: "dependency-name"');
    expect(dependabot).toContain('"/apps/worker"');
    expect(dependabot).toContain('"/packages/core"');
    expect(dependabot).toContain('"/packages/generator"');
    expect(dependabot).toContain("semver-patch-days: 2");
  });

  it("uses a trusted base checkout and never grants an administrative merge bypass", async () => {
    const workflow = parse(await read("../.github/workflows/freshness.yml"));
    expect(workflow.on.pull_request_target.branches).toEqual(["main"]);
    expect(workflow.on.pull_request).toBeUndefined();
    const freshness = workflow.jobs.freshness;
    expect(freshness.if).toContain("user.id == 49699333");
    expect(freshness.if).toContain("head.repo.full_name == github.repository");
    expect(freshness.steps[0].with.ref).toBe("${{ github.event.pull_request.base.sha }}");
    expect(freshness.steps[1].with.ref).toBe("${{ github.event.pull_request.head.sha }}");
    const setup = freshness.steps.find((step) => step.name === "Install pnpm");
    expect(setup.with.package_json_file).toBe("base/package.json");
    const gate = freshness.steps.find((step) => step.id === "input");
    expect(gate.run.indexOf("install --frozen-lockfile --ignore-scripts")).toBeLessThan(
      gate.run.indexOf("node base/scripts/freshness-gate.mjs"),
    );
    for (const step of freshness.steps.filter((step) => step.name.startsWith("Generate "))) {
      expect(step.if).toBe("steps.input.outputs.kind == 'bcd'");
    }
    const merge = workflow.jobs["enable-auto-merge"];
    expect(merge.if).toContain("vars.BCD_EMBED_AUTO_MERGE_ENABLED == 'true'");
    expect(merge.if).toContain("needs.freshness.outputs.kind == 'bcd'");
    expect(merge.permissions).toEqual({
      actions: "read",
      checks: "read",
      contents: "read",
      "pull-requests": "write",
    });
    expect(merge.steps.at(-1).run).toBe("node scripts/enable-auto-merge.mjs");
  });

  it("keeps scheduled preparation local until a reviewed remote-write approval exists", async () => {
    const workflow = parse(await read("../.github/workflows/freshness-backstop.yml"));
    expect(workflow.on.schedule).toEqual([{ cron: "17 4 * * 1" }]);
    const publisher = workflow.jobs.publish;
    expect(workflow.jobs["prepare-artifacts"].if).toBe("github.ref == 'refs/heads/main'");
    expect(publisher.if).toContain("github.event_name == 'workflow_dispatch'");
    expect(publisher.if).toContain("github.ref == 'refs/heads/main'");
    expect(publisher.environment.name).toBe("bcd-embed-production");
    const publication = publisher.steps.at(-1);
    expect(publication.run).toContain("--execute-remote-write");
    expect(publication.env.APPROVAL).toBe("${{ secrets.BCD_EMBED_DIFF_APPROVAL }}");
    expect(workflow.jobs["notify-failure"].needs).toEqual(["prepare-artifacts", "publish"]);
    expect(workflow.jobs["notify-failure"].if).toContain("github.ref == 'refs/heads/main'");
    expect(
      publisher.steps.some((step) => step.uses?.startsWith("actions/download-artifact@")),
    ).toBe(false);
    for (const job of [workflow.jobs["prepare-artifacts"], publisher]) {
      for (const step of job.steps.filter((step) =>
        step.uses?.startsWith("actions/upload-artifact@"),
      )) {
        expect(step.with["include-hidden-files"]).toBe(true);
        expect(step.with.name).toContain("${{ github.run_attempt }}");
      }
    }
  });

  it("builds schema/core transitively on fresh generator and publisher runners", async () => {
    for (const path of [
      "../.github/workflows/freshness.yml",
      "../.github/workflows/freshness-backstop.yml",
    ]) {
      const workflow = parse(await read(path));
      for (const job of Object.values(workflow.jobs)) {
        for (const step of job.steps ?? []) {
          for (const line of (step.run ?? "").split("\n")) {
            if (line.includes("--filter @bcd-embed/")) {
              expect(line).toMatch(
                /--recursive --filter @bcd-embed\/(generator|publisher)\.\.\. run build$/,
              );
            }
          }
        }
      }
    }
    const names = (filter: string) =>
      execFileSync(
        process.env.npm_execpath ?? "pnpm",
        [
          "--recursive",
          "--filter",
          filter,
          "exec",
          process.execPath,
          "-e",
          "console.log(JSON.parse(require('node:fs').readFileSync('package.json', 'utf8')).name)",
        ],
        { encoding: "utf8", timeout: 20_000 },
      )
        .trim()
        .split("\n")
        .sort();
    expect(names("@bcd-embed/generator...")).toEqual([
      "@bcd-embed/core",
      "@bcd-embed/generator",
      "@bcd-embed/schema",
    ]);
    expect(names("@bcd-embed/publisher...")).toEqual([
      "@bcd-embed/core",
      "@bcd-embed/generator",
      "@bcd-embed/publisher",
      "@bcd-embed/schema",
    ]);
  }, 60_000);

  it("reproduces the reviewed candidate window on repeated runs of one commit", async () => {
    const workflow = parse(await read("../.github/workflows/freshness-backstop.yml"));
    const run = workflow.jobs["prepare-artifacts"].steps.find(
      (step) => step.id === "candidate",
    ).run;
    const block = run.slice(
      run.indexOf('eval "$('),
      run.indexOf("node packages/generator/dist/bin.js"),
    );
    const root = await mkdtemp(join(tmpdir(), "bcd-reviewed-window-"));
    try {
      const results: string[] = [];
      for (const attempt of [1, 2]) {
        const path = join(root, String(attempt));
        execFileSync("bash", ["-e", "-c", block], {
          env: { ...process.env, GITHUB_SHA: "HEAD", GITHUB_OUTPUT: path },
        });
        results.push(await readFile(path, "utf8"));
      }
      expect(results[0]).toBe(results[1]);
      expect(results[0]).toMatch(
        /^generated=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\nexpires=\d{4}-\d{2}-\d{2}\n$/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("exports reservation timestamps explicitly and keeps builds and generation free of R2 secrets", async () => {
    const workflow = parse(await read("../.github/workflows/freshness-backstop.yml"));
    const steps = workflow.jobs.publish.steps;
    const reservation = steps.find((step) => step.id === "reservation");
    const block = reservation.run.slice(reservation.run.indexOf("node - <<'NODE'"));
    const generation = steps.find(
      (step) =>
        step.name ===
        "Generate the exact reviewed or reserved candidate without remote credentials",
    );
    expect(generation.env).toEqual({
      GENERATED: "${{ steps.reservation.outputs.generated }}",
      EXPIRES: "${{ steps.reservation.outputs.expires }}",
    });
    for (const step of steps.filter((step) => step.run?.includes("pnpm ") || step === generation)) {
      expect(Object.keys(step.env ?? {}).some((key) => key.startsWith("R2_"))).toBe(false);
    }
    const root = await mkdtemp(join(tmpdir(), "bcd-window-"));
    try {
      await writeFile(
        join(root, "publication.json"),
        JSON.stringify({ generated: "2026-10-01T00:00:00Z", expires: "2026-12-30" }),
      );
      const outputPath = join(root, "output");
      execFileSync("bash", ["-e", "-c", block], {
        encoding: "utf8",
        env: { ...process.env, RUNNER_TEMP: root, GITHUB_OUTPUT: outputPath },
      });
      expect(await readFile(outputPath, "utf8")).toBe(
        "generated=2026-10-01T00:00:00Z\nexpires=2026-12-30\n",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
