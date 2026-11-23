import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { describeRelease, type PackageManifest } from "../src/data/release.js";

const NAME = "@schalkneethling/bcd-embed";

describe("describeRelease", () => {
  it("names the stage and the dist-tag of a beta", () => {
    expect(describeRelease({ name: NAME, version: "0.1.0-beta.0" })).toEqual({
      badge: `Beta · ${NAME}@0.1.0-beta.0`,
      installCommand: `npm install ${NAME}@beta`,
    });
  });

  // After 1.0, a prerelease such as 1.1.0-rc.1 is staged under the dist-tag named by its
  // identifier, as a beta is (apps/website/src/content/docs/releasing.md).
  it("names a release candidate in words, and installs it by its dist-tag", () => {
    expect(describeRelease({ name: NAME, version: "1.1.0-rc.1" })).toEqual({
      badge: `Release candidate · ${NAME}@1.1.0-rc.1`,
      installCommand: `npm install ${NAME}@rc`,
    });
  });

  it("shows an identifier it has no name for as it is", () => {
    expect(describeRelease({ name: NAME, version: "2.0.0-next.3" })).toEqual({
      badge: `next · ${NAME}@2.0.0-next.3`,
      installCommand: `npm install ${NAME}@next`,
    });
  });

  // A number alone is still a prerelease, but it names no stage, and npm rejects a tag that reads
  // as a version range, so the command pins the version.
  it("treats a numeric-only prerelease as a prerelease, never as stable", () => {
    expect(describeRelease({ name: NAME, version: "1.0.0-0" })).toEqual({
      badge: `Prerelease · ${NAME}@1.0.0-0`,
      installCommand: `npm install ${NAME}@1.0.0-0`,
    });
  });

  // A stable version is the `latest` dist-tag, which npm installs with no tag at all, so the badge
  // drops the stage and the command drops the tag.
  it("names no stage and no tag for a stable version", () => {
    expect(describeRelease({ name: NAME, version: "1.0.0" })).toEqual({
      badge: `${NAME}@1.0.0`,
      installCommand: `npm install ${NAME}`,
    });
  });

  it("describes the element package as it is in the workspace today", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../../../packages/element/package.json", import.meta.url), "utf8"),
    ) as PackageManifest;
    const release = describeRelease(manifest);
    expect(release.badge).toContain(`${manifest.name}@${manifest.version}`);
    expect(release.installCommand.startsWith(`npm install ${manifest.name}`)).toBe(true);
  });
});
