import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

describe("legacy snapshot cleanup workflow", () => {
  it("runs only by hand, from main, behind the production environment, and counts by default", async () => {
    const workflow = parse(await read("../.github/workflows/legacy-cleanup.yml"));
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(workflow.on.workflow_dispatch.inputs.execute).toMatchObject({
      default: false,
      type: "boolean",
    });
    expect(workflow.permissions).toEqual({ contents: "read" });
    const job = workflow.jobs.cleanup;
    expect(job.if).toBe("github.ref == 'refs/heads/main'");
    expect(job.environment).toEqual({ name: "bcd-embed-production" });
    // Inputs reach the shell as environment variables, never interpolated into the script.
    for (const step of job.steps) expect(step.run ?? "").not.toContain("${{");
  });

  it("passes --execute to the script only when execute is true", async () => {
    const workflow = parse(await read("../.github/workflows/legacy-cleanup.yml"));
    const step = workflow.jobs.cleanup.steps.at(-1);
    const root = await mkdtemp(join(tmpdir(), "bcd-embed-legacy-"));
    try {
      await mkdir(join(root, "scripts"));
      await writeFile(
        join(root, "scripts/delete-legacy-snapshot.mjs"),
        "process.stdout.write(JSON.stringify(process.argv.slice(2)));",
      );
      const run = (execute: string) =>
        JSON.parse(
          execFileSync("bash", ["-e", "-c", step.run], {
            cwd: root,
            env: { ...process.env, SNAPSHOT: "bcd-8.1.8-gen-0.0.0", EXECUTE: execute },
            encoding: "utf8",
          }),
        );
      expect(run("false")).toEqual(["bcd-8.1.8-gen-0.0.0"]);
      expect(run("true")).toEqual(["bcd-8.1.8-gen-0.0.0", "--execute"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
