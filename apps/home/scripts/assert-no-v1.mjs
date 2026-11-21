// The zone's rate limiting rule matches `/v1/` on every hostname of browser-compat.dev, so a
// top-level `v1` entry in the site would be answered by the rule, not by the site. The build script
// runs this file against `dist/` after `astro build`, and `tests/home-page.test.ts` imports it.
//
//   node scripts/assert-no-v1.mjs dist
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Rejects when the directory has a top-level entry named `v1`, file or folder.
 * @param {string} directory
 * @returns {Promise<void>}
 */
export const assertNoTopLevelV1 = async (directory) => {
  const entries = await readdir(directory);
  if (entries.includes("v1")) {
    throw new Error(
      `${directory} has a top-level "v1" entry. The zone's rate limiting rule matches /v1/ on every hostname.`,
    );
  }
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2];
  if (directory === undefined) {
    console.error("Usage: node scripts/assert-no-v1.mjs <directory>");
    process.exit(2);
  }
  try {
    await assertNoTopLevelV1(directory);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
