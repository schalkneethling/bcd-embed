// Builds an Astro site for a test. Several test files build the same site, and Vitest runs files in
// parallel, but Astro keeps its intermediate files in `<site>/.astro/` whatever the `--outDir`, so
// two builds of one site at once delete each other's files. A lock directory per site makes the
// builds take turns. `mkdir` either creates the directory or fails because it exists, so only one
// test holds a site's lock at a time.
import { execFile } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * A lock older than this was left by a run that ended without removing it. The shortest hook that
 * waits for a build has a 120 second timeout, so a threshold above that would let a hook time out
 * behind a dead lock before anyone stole it. A build takes a few seconds, so 90 seconds does not
 * steal a live lock.
 */
const STALE_AFTER_MS = 90_000;

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const acquire = async (lockDirectory: string, cacheDirectory: string): Promise<void> => {
  await mkdir(cacheDirectory, { recursive: true });
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

/**
 * Runs `astro build` for the site in `siteDirectory` into `outDirectory`, one build of that site at
 * a time across test files.
 */
export const buildAstroSite = async (
  siteDirectory: string,
  outDirectory: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> => {
  const cacheDirectory = join(siteDirectory, "node_modules/.cache");
  const lockDirectory = join(cacheDirectory, "bcd-embed-build.lock");
  await acquire(lockDirectory, cacheDirectory);
  try {
    await run("pnpm", ["exec", "astro", "build", "--outDir", outDirectory], {
      cwd: siteDirectory,
      env,
    });
  } finally {
    await rm(lockDirectory, { recursive: true, force: true });
  }
};
