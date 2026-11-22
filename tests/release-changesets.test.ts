import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  changesetProblems,
  parseReleases,
  pendingChangesets,
} from "../scripts/release-changesets.mjs";

const PACKAGE = "@schalkneethling/bcd-embed";
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

describe("parseReleases", () => {
  it("reads the lines changeset add writes, quoted or not", () => {
    expect(
      parseReleases(`---\n"${PACKAGE}": minor\n'other': patch\nbare: major\n---\n\nSummary.\n`),
    ).toEqual([
      { name: PACKAGE, bump: "minor" },
      { name: "other", bump: "patch" },
      { name: "bare", bump: "major" },
    ]);
    expect(parseReleases("---\n---\n")).toEqual([]);
  });

  it("throws on front matter it cannot read the same way Changesets does", () => {
    expect(() => parseReleases("No front matter.\n")).toThrow(/no front matter/);
    expect(() => parseReleases(`---\n"${PACKAGE}": huge\n---\n`)).toThrow(/is not "package": bump/);
    expect(() => parseReleases(`---\n{ "${PACKAGE}": minor }\n---\n`)).toThrow();
  });
});

describe("the changesets of a repository", () => {
  let root = "";
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bcd-embed-changesets-"));
    await mkdir(join(root, ".changeset/pre"), { recursive: true });
    await writeFile(join(root, ".changeset/README.md"), "# Changesets\n");
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const write = (file: string, text: string) => writeFile(join(root, ".changeset", file), text);

  it("rejects a changeset that names a private package, alone or beside the published one", async () => {
    await write("private.md", '---\n"@bcd-embed/schema": patch\n---\n');
    await write("both.md", `---\n"${PACKAGE}": patch\n"@bcd-embed/core": patch\n---\n`);
    await write("fine.md", `---\n"${PACKAGE}": patch\n---\n`);

    const problems = await changesetProblems(root, PACKAGE);

    expect(problems).toHaveLength(2);
    expect(problems.join("\n")).toContain(".changeset/both.md names @bcd-embed/core");
    expect(problems.join("\n")).toContain(".changeset/private.md names @bcd-embed/schema");
  });

  it("rejects a changeset it cannot read", async () => {
    await write("broken.md", "No front matter.\n");

    expect(await changesetProblems(root, PACKAGE)).toEqual([
      ".changeset/broken.md cannot be read, because it has no front matter between two --- lines.",
    ]);
  });

  it("counts only top-level changesets that bump the published package", async () => {
    await write("one.md", `---\n"${PACKAGE}": minor\n---\n`);
    await write("none.md", `---\n"${PACKAGE}": none\n---\n`);
    await write("AGENTS.md", `---\n"${PACKAGE}": minor\n---\n`);
    await write("pre/used.md", `---\n"${PACKAGE}": minor\n---\n`);

    expect((await pendingChangesets(root, PACKAGE)).map(({ file }) => file)).toEqual(["one.md"]);
  });

  it("finds nothing wrong with this repository's own changesets", async () => {
    expect(await changesetProblems(repositoryRoot, PACKAGE)).toEqual([]);
  });
});
