// Reads the changesets in `.changeset/` the way the release workflow needs, with no installed
// dependency, because the workflow's `plan` job installs nothing.
//
//   node scripts/release-changesets.mjs pending   prints how many changesets release the package
//   node scripts/release-changesets.mjs check     fails for a changeset this repository cannot release
//
// Which files count follows `@changesets/read` 1.0.1: top-level `.md` files that do not start with
// a dot, except `README.md` (any case), `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`. Files under
// `.changeset/pre/` are changesets that pre-release mode has already used.
//
// Only `@schalkneethling/bcd-embed` publishes. `changeset version` leaves a changeset in place
// when it names any package it skips, such as a private workspace (`@changesets/apply-release-plan`
// 8.1.1), so such a changeset would stay pending forever and block every release. `check`, which
// `pnpm check` runs, rejects it before it merges.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const IGNORED = new Set(["AGENTS.md", "CLAUDE.md", "GEMINI.md"]);
const BUMPS = new Set(["major", "minor", "patch", "none"]);

/** The top-level changeset files in `directory`, sorted by name. */
export const changesetFiles = async (directory) =>
  (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter(
      (name) =>
        !name.startsWith(".") &&
        name.endsWith(".md") &&
        name.toLowerCase() !== "readme.md" &&
        !IGNORED.has(name),
    )
    .toSorted();

/**
 * The releases a changeset's front matter names, as `{ name, bump }`. It accepts the one form that
 * `changeset add` writes, a `"package": bump` line per package, and throws on anything else, so
 * that this reader and Changesets' YAML parser can never disagree about a file `check` accepted.
 */
export const parseReleases = (text) => {
  const match = /^\s*---\r?\n([^]*?)\r?\n?---/.exec(text);
  if (match === null) throw new Error("it has no front matter between two --- lines");
  const releases = [];
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const release = /^\s*(?:"([^"]+)"|'([^']+)'|([^\s"'#:][^:]*?))\s*:\s*(\w+)\s*$/.exec(line);
    const bump = release?.[4] ?? "";
    if (release === null || !BUMPS.has(bump)) {
      throw new Error(`its front matter line ${JSON.stringify(line)} is not "package": bump`);
    }
    releases.push({ name: release[1] ?? release[2] ?? release[3] ?? "", bump });
  }
  return releases;
};

/** Every top-level changeset with its releases, or the reason it could not be read. */
export const readChangesets = async (root) => {
  const directory = join(root, ".changeset");
  const changesets = [];
  for (const file of await changesetFiles(directory)) {
    const text = await readFile(join(directory, file), "utf8");
    try {
      changesets.push({ file, releases: parseReleases(text), error: null });
    } catch (error) {
      changesets.push({ file, releases: [], error: error.message });
    }
  }
  return changesets;
};

/** The changesets that bump `packageName`. */
export const pendingChangesets = async (root, packageName) =>
  (await readChangesets(root)).filter(({ releases }) =>
    releases.some(({ name, bump }) => name === packageName && bump !== "none"),
  );

/** One sentence per changeset that this repository cannot release. */
export const changesetProblems = async (root, packageName) => {
  const problems = [];
  for (const { file, releases, error } of await readChangesets(root)) {
    if (error !== null) {
      problems.push(`.changeset/${file} cannot be read, because ${error}.`);
      continue;
    }
    for (const { name } of releases) {
      if (name !== packageName) {
        problems.push(
          `.changeset/${file} names ${name}, but only ${packageName} publishes, so changeset version would leave this file pending forever.`,
        );
      }
    }
  }
  return problems;
};

const readPackageName = async (root) =>
  JSON.parse(await readFile(join(root, "packages/element/package.json"), "utf8")).name;

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = process.cwd();
  const packageName = await readPackageName(root);
  const command = process.argv[2];
  if (command === "pending") {
    process.stdout.write(`${(await pendingChangesets(root, packageName)).length}\n`);
  } else if (command === "check") {
    const problems = await changesetProblems(root, packageName);
    for (const problem of problems) process.stderr.write(`${problem}\n`);
    if (problems.length > 0) process.exit(1);
    process.stdout.write("Every changeset names only the published package.\n");
  } else {
    process.stderr.write("Usage: node scripts/release-changesets.mjs pending|check\n");
    process.exit(2);
  }
}
