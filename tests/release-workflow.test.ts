import { execFileSync, spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  id?: string;
  "working-directory"?: string;
};
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
      expect(step.run ?? "").not.toMatch(/pnpm|npm ci|npm install|npm i |npx/);
    }
    const runs = stage?.steps.map((step) => step.run).filter(Boolean) ?? [];
    expect(runs).toHaveLength(2);
    expect(runs.at(-1)).toBe(
      'npm stage publish ./package/package.tgz --tag "$DIST_TAG" --access public',
    );
  });

  it("refuses a bundled npm older than 11.15.0 before it stages", async () => {
    const workflow = await readWorkflow();
    const step = workflow.jobs.stage?.steps.find((candidate) =>
      (candidate.run ?? "").includes("npm --version"),
    );
    const root = await mkdtemp(join(tmpdir(), "bcd-embed-npm-version-"));
    try {
      const bin = join(root, "bin");
      await mkdir(bin);
      const run = async (version: string) => {
        await writeFile(join(bin, "npm"), `#!/bin/sh\necho ${version}\n`);
        await chmod(join(bin, "npm"), 0o755);
        return spawnSync("bash", ["-e", "-c", step?.run ?? "exit 1"], {
          env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
          encoding: "utf8",
        }).status;
      };
      expect(await run("11.20.0")).toBe(0);
      expect(await run("11.15.0")).toBe(0);
      expect(await run("12.0.0")).toBe(0);
      expect(await run("11.14.9")).not.toBe(0);
      expect(await run("10.9.2")).not.toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("packs a manifest with no development dependencies, scripts, or workspace ranges", async () => {
    const workflow = await readWorkflow();
    const strip = workflow.jobs.build?.steps.find((step) =>
      (step.run ?? "").startsWith("npm pkg delete"),
    );
    const steps = workflow.jobs.build?.steps ?? [];
    const pack = steps.findIndex((step) => (step.run ?? "").includes(" pack "));
    expect(strip?.["working-directory"]).toBe("packages/element");
    // It runs after the build and the package check, which use the scripts, and before the pack.
    expect(steps.indexOf(strip ?? {})).toBeGreaterThan(
      steps.findIndex((step) => (step.run ?? "").endsWith("check:package")),
    );
    expect(steps.indexOf(strip ?? {})).toBeLessThan(pack);

    const root = await mkdtemp(join(tmpdir(), "bcd-embed-manifest-"));
    try {
      const element = join(root, "element");
      await mkdir(element);
      await copyFile(
        new URL("../packages/element/package.json", import.meta.url),
        join(element, "package.json"),
      );
      execFileSync("bash", ["-e", "-c", strip?.run ?? "exit 1"], { cwd: element });
      execFileSync("pnpm", ["pack", "--out", join(root, "package.tgz")], {
        cwd: element,
        stdio: "ignore",
      });
      execFileSync("tar", ["-xzf", join(root, "package.tgz"), "-C", root]);
      const packed = await readFile(join(root, "package/package.json"), "utf8");
      const manifest = JSON.parse(packed) as Record<string, unknown>;

      expect(manifest).not.toHaveProperty("devDependencies");
      expect(manifest).not.toHaveProperty("scripts");
      expect(packed).not.toContain("workspace:");
      expect(packed).not.toContain("@bcd-embed/");
      expect(manifest.dependencies).toEqual({ "@lit/task": "1.0.3", lit: "3.3.3" });
      expect(manifest.exports).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);

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
    await mkdir(join(root, "scripts"));
    await copyFile(
      new URL("../scripts/release-changesets.mjs", import.meta.url),
      join(root, "scripts/release-changesets.mjs"),
    );
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

  const element = '---\n"@schalkneethling/bcd-embed": minor\n---\n\nA change.\n';

  it("opens the release pull request while a changeset is pending", async () => {
    await setVersion("0.0.0");
    await enterPreMode("beta");
    await writeFile(join(root, ".changeset/first-beta.md"), element);

    expect(await plan()).toMatchObject({ mode: "version" });
  });

  // `changeset version` leaves a changeset that names a private package where it is, so counting
  // every file would keep the workflow in `version` mode forever. `pnpm check` rejects such a file.
  it("does not count a changeset that names only a private package", async () => {
    await setVersion("0.1.0-beta.0");
    await enterPreMode("beta");
    await writeFile(
      join(root, ".changeset/private.md"),
      '---\n"@bcd-embed/schema": patch\n---\n\nA change.\n',
    );

    expect(await plan()).toMatchObject({ mode: "stage" });
  });

  it("does not count the files Changesets ignores, or a changeset with no bump", async () => {
    await setVersion("0.1.0-beta.0");
    await enterPreMode("beta");
    for (const file of ["AGENTS.md", "CLAUDE.md", "GEMINI.md", "readme.md"]) {
      await writeFile(join(root, ".changeset", file), element);
    }
    await writeFile(join(root, ".changeset/empty.md"), "---\n---\n");
    await writeFile(
      join(root, ".changeset/none.md"),
      '---\n"@schalkneethling/bcd-embed": none\n---\n',
    );

    expect(await plan()).toMatchObject({ mode: "stage" });
  });

  it("ignores the changesets that pre-release mode has already used", async () => {
    await setVersion("0.1.0-beta.0");
    await enterPreMode("beta");
    await mkdir(join(root, ".changeset/pre"));
    await writeFile(join(root, ".changeset/pre/first-beta.md"), element);

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

describe("the release workflow's release step", () => {
  let root = "";

  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bcd-embed-release-step-"));
    await mkdir(join(root, "work/packages/element"), { recursive: true });
    await mkdir(join(root, "bin"));
    git(root, "init", "--quiet", "--bare", join(root, "origin.git"));
    git(root, "init", "--quiet", join(root, "work"));
    git(join(root, "work"), "remote", "add", "origin", join(root, "origin.git"));
    await writeFile(
      join(root, "work/packages/element/CHANGELOG.md"),
      "# @schalkneethling/bcd-embed\n\n## 0.1.0-beta.0\n\n### Minor Changes\n\n- First beta.\n",
    );
    await writeFile(join(root, "releases"), "");
    // A stand-in for the GitHub CLI: it records each call, and lists the tags in `releases` as
    // the existing releases.
    await writeFile(
      join(root, "bin/gh"),
      [
        "#!/bin/sh",
        `echo "$*" >> "${join(root, "calls")}"`,
        'case "$*" in',
        `  *"/releases --jq"*) cat "${join(root, "releases")}" ;;`,
        "esac",
        "",
      ].join("\n"),
    );
    await chmod(join(root, "bin/gh"), 0o755);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const runRelease = async () => {
    const workflow = await readWorkflow();
    const step = workflow.jobs.release?.steps.find((candidate) => candidate.run !== undefined);
    await writeFile(join(root, "calls"), "");
    const result = spawnSync("bash", ["-e", "-c", step?.run ?? "exit 1"], {
      cwd: join(root, "work"),
      env: {
        ...process.env,
        PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`,
        GITHUB_REPOSITORY: "owner/repo",
        GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
        VERSION: "0.1.0-beta.0",
        GIT_TAG: "@schalkneethling/bcd-embed@0.1.0-beta.0",
      },
      encoding: "utf8",
    });
    const calls = (await readFile(join(root, "calls"), "utf8")).trim().split("\n");
    return {
      status: result.status,
      calls,
      notes: await readFile(join(root, "work/release-notes.md"), "utf8"),
    };
  };

  it("creates the tag and a draft prerelease when neither exists", async () => {
    const { status, calls, notes } = await runRelease();

    expect(status).toBe(0);
    expect(notes).toBe("### Minor Changes\n\n- First beta.\n");
    expect(
      calls.some(
        (call) =>
          call.includes("git/refs") &&
          call.includes("refs/tags/@schalkneethling/bcd-embed@0.1.0-beta.0"),
      ),
    ).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.startsWith("release create @schalkneethling/bcd-embed@0.1.0-beta.0") &&
          call.includes("--draft") &&
          call.includes("--prerelease=true"),
      ),
    ).toBe(true);
  });

  it("creates neither again when a re-run finds both", async () => {
    git(
      join(root, "work"),
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
    git(join(root, "work"), "tag", "@schalkneethling/bcd-embed@0.1.0-beta.0");
    git(
      join(root, "work"),
      "push",
      "--quiet",
      "origin",
      "refs/tags/@schalkneethling/bcd-embed@0.1.0-beta.0",
    );
    await writeFile(join(root, "releases"), "@schalkneethling/bcd-embed@0.1.0-beta.0\n");

    const { status, calls } = await runRelease();

    expect(status).toBe(0);
    expect(calls.some((call) => call.includes("git/refs"))).toBe(false);
    expect(calls.some((call) => call.startsWith("release create"))).toBe(false);
  });

  it("creates only the release when the tag exists from an earlier attempt", async () => {
    git(
      join(root, "work"),
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
    git(join(root, "work"), "tag", "@schalkneethling/bcd-embed@0.1.0-beta.0");
    git(
      join(root, "work"),
      "push",
      "--quiet",
      "origin",
      "refs/tags/@schalkneethling/bcd-embed@0.1.0-beta.0",
    );

    const { status, calls } = await runRelease();

    expect(status).toBe(0);
    expect(calls.some((call) => call.includes("git/refs"))).toBe(false);
    expect(calls.some((call) => call.startsWith("release create"))).toBe(true);
  });
});
