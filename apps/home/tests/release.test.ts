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
  it("uses the identifier of any other prerelease as its stage and dist-tag", () => {
    expect(describeRelease({ name: NAME, version: "1.1.0-rc.1" })).toEqual({
      badge: `Rc · ${NAME}@1.1.0-rc.1`,
      installCommand: `npm install ${NAME}@rc`,
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
