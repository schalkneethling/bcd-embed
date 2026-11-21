// Builds the documentation site for a test. Two test files build it, and Vitest runs files in
// parallel, but Astro keeps its intermediate files in `apps/website/.astro/` whatever the
// `--outDir`, so two builds at once delete each other's files. A lock directory makes the builds
// take turns. `mkdir` either creates the directory or fails because it exists, so only one test
// holds the lock at a time.
import { execFile } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

export const websiteDirectory = fileURLToPath(new URL("../apps/website/", import.meta.url));

const lockDirectory = join(websiteDirectory, "node_modules/.cache/bcd-embed-build.lock");

/** A lock older than this was left by a run that ended without removing it. */
const STALE_AFTER_MS = 5 * 60_000;

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const acquire = async (): Promise<void> => {
  await mkdir(join(websiteDirectory, "node_modules/.cache"), { recursive: true });
  for (;;) {
    try {
      await mkdir(lockDirectory);
      return;
    } catch {
      const held = await stat(lockDirectory).catch(() => null);
      if (held !== null && Date.now() - held.mtimeMs > STALE_AFTER_MS) {
        await rm(lockDirectory, { recursive: true, force: true });
      } else {
        await wait(250);
      }
    }
  }
};

/** Runs `astro build` into `outDirectory`, one build at a time across test files. */
export const buildWebsite = async (
  outDirectory: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> => {
  await acquire();
  try {
    await run("pnpm", ["exec", "astro", "build", "--outDir", outDirectory], {
      cwd: websiteDirectory,
      env,
    });
  } finally {
    await rm(lockDirectory, { recursive: true, force: true });
  }
};
