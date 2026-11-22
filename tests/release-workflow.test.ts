import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

type Step = { uses?: string; run?: string; with?: Record<string, unknown>; id?: string };
type Job = {
  permissions?: Record<string, string>;
  environment?: unknown;
  steps: Step[];
};
type Workflow = {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: Record<string, Job>;
};

const readWorkflow = async (): Promise<Workflow> =>
  parse(await read("../.github/workflows/release.yml")) as Workflow;

describe("release workflow", () => {
  it("runs on pushes to main, with read-only contents by default", async () => {
    const workflow = await readWorkflow();

    expect(workflow.on).toEqual({ push: { branches: ["main"] } });
    expect(workflow.permissions).toEqual({ contents: "read" });
  });

  it("matches the trusted publisher that the fledgling block in package.json configures", async () => {
    const workflow = await readWorkflow();
    const manifest = JSON.parse(await read("../package.json")) as {
      fledgling: Record<string, unknown>;
    };

    expect(manifest.fledgling).toEqual({
      provider: "github",
      workflow: "release.yml",
      environment: "publish",
      publish: false,
    });
    expect(workflow.jobs.stage?.environment).toBe(manifest.fledgling.environment);
  });

  it("grants an OIDC token to the stage job only, which checks out and installs nothing", async () => {
    const workflow = await readWorkflow();

    for (const [name, job] of Object.entries(workflow.jobs)) {
      const hasToken = job.permissions?.["id-token"] === "write";
      expect(hasToken, name).toBe(name === "stage");
    }
    const stage = workflow.jobs.stage;
    expect(stage?.permissions).toEqual({ contents: "read", "id-token": "write" });
    for (const step of stage?.steps ?? []) {
      expect(step.uses ?? "").not.toMatch(/^actions\/checkout@|^pnpm\//);
      expect(step.run ?? "").not.toMatch(
        /pnpm|npm ci|npm install(?! --global --ignore-scripts npm@\d)/,
      );
    }
    expect(stage?.steps.map((step) => step.run).filter(Boolean)).toEqual([
      "npm install --global --ignore-scripts npm@12.2.3",
      'npm stage publish ./package/package.tgz --tag "$DIST_TAG" --access public',
    ]);
  });

  it("pins every action to a commit, keeps no checkout credentials, and installs without scripts", async () => {
    const workflow = await readWorkflow();

    for (const [name, job] of Object.entries(workflow.jobs)) {
      for (const step of job.steps) {
        if (step.uses !== undefined) {
          expect(step.uses, name).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
        }
        if (step.uses?.startsWith("actions/checkout@")) {
          expect(step.with?.["persist-credentials"], name).toBe(false);
        }
        if (/\bpnpm install\b/.test(step.run ?? "")) {
          expect(step.run, name).toBe("pnpm install --frozen-lockfile --ignore-scripts");
        }
        // Values reach the shell as environment variables, never interpolated into the script.
        expect(step.run ?? "", name).not.toContain("${{");
      }
    }
  });
});

describe("the release workflow's plan step", () => {
  let root = "";
  let origin = "";

  // The throwaway repositories ignore the developer's own Git configuration, such as commit
  // signing, so the test behaves the same on every machine.
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    });

  beforeEach(async () => {
    const base = await mkdtemp(join(tmpdir(), "bcd-embed-release-"));
    root = join(base, "work");
    origin = join(base, "origin.git");
    await mkdir(join(root, ".changeset"), { recursive: true });
    await mkdir(join(root, "packages/element"), { recursive: true });
    git(base, "init", "--quiet", "--bare", origin);
    git(base, "init", "--quiet", root);
    git(root, "remote", "add", "origin", origin);
    await writeFile(join(root, ".changeset/README.md"), "# Changesets\n");
  });
  afterEach(async () => {
    await rm(join(root, ".."), { recursive: true, force: true });
  });

  const setVersion = (version: string) =>
    writeFile(
      join(root, "packages/element/package.json"),
      JSON.stringify({ name: "@schalkneethling/bcd-embed", version }),
    );
  const enterPreMode = (tag: string) =>
    writeFile(join(root, ".changeset/pre.json"), JSON.stringify({ mode: "pre", tag }));
  const pushTag = (tag: string) => {
    git(
      root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "x",
    );
    git(root, "tag", tag);
    git(root, "push", "--quiet", "origin", `refs/tags/${tag}`);
  };

  /** Runs the step's script and returns its outputs, or its exit status and stdout on failure. */
  const plan = async (): Promise<
    Record<string, string> | { status: number | null; stdout: string }
  > => {
    const workflow = await readWorkflow();
    const step = workflow.jobs.plan?.steps.find((candidate) => candidate.id === "plan");
    const output = join(root, "..", "github-output");
    await writeFile(output, "");
    const result = spawnSync("bash", ["-e", "-c", step?.run ?? "exit 1"], {
      cwd: root,
      env: { ...process.env, GITHUB_OUTPUT: output },
      encoding: "utf8",
    });
    if (result.status !== 0) return { status: result.status, stdout: result.stdout };
    const text = await readFile(output, "utf8");
    return Object.fromEntries(
      text
        .trim()
        .split("\n")
        .map((line) => line.split(/=(.*)/s).slice(0, 2) as [string, string]),
    );
  };

  it("opens the release pull request while a changeset is pending", async () => {
    await setVersion("0.0.0");
    await enterPreMode("beta");
    await writeFile(join(root, ".changeset/first-beta.md"), "---\n---\n");

    expect(await plan()).toMatchObject({ mode: "version" });
  });

  it("ignores the changesets that pre-release mode has already used", async () => {
    await setVersion("0.1.0-beta.0");
    await enterPreMode("beta");
    await mkdir(join(root, ".changeset/pre"));
    await writeFile(join(root, ".changeset/pre/first-beta.md"), "---\n---\n");

    expect(await plan()).toMatchObject({ mode: "stage" });
  });

  it("stages an untagged prerelease with the pre-release mode's dist-tag", async () => {
    await setVersion("0.1.0-beta.0");
    await enterPreMode("beta");

    expect(await plan()).toEqual({
      mode: "stage",
      version: "0.1.0-beta.0",
      git_tag: "@schalkneethling/bcd-embed@0.1.0-beta.0",
      dist_tag: "beta",
    });
  });

  it("stages a stable version with the latest dist-tag", async () => {
    await setVersion("1.0.0");

    expect(await plan()).toMatchObject({ mode: "stage", dist_tag: "latest" });
  });

  it("does nothing when the version's git tag already exists", async () => {
    await setVersion("0.1.0-beta.0");
    await enterPreMode("beta");
    pushTag("@schalkneethling/bcd-embed@0.1.0-beta.0");

    expect(await plan()).toMatchObject({ mode: "none" });
  });

  it("does nothing for the unreleased version 0.0.0", async () => {
    await setVersion("0.0.0");

    expect(await plan()).toMatchObject({ mode: "none" });
  });

  it("fails for a prerelease outside pre-release mode, which would otherwise go to latest", async () => {
    await setVersion("0.2.0-beta.0");

    expect(await plan()).toMatchObject({ status: 1 });
  });
});
