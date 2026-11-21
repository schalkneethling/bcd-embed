// Builds the documentation site for a test. Two test files build it; `astro-build.ts` explains why
// the builds take turns.
import { fileURLToPath } from "node:url";

import { buildAstroSite } from "./astro-build.js";

export const websiteDirectory = fileURLToPath(new URL("../apps/website/", import.meta.url));

/** Runs `astro build` into `outDirectory`, one build at a time across test files. */
export const buildWebsite = (
  outDirectory: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> => buildAstroSite(websiteDirectory, outDirectory, env);
