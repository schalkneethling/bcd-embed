// The release the page advertises: the element package's name and version, read from its
// package.json at build time, so the badge and the install command change with each release and
// never go stale as hand-written copy would. Nothing of this module ships to the browser.
//
// The package's `exports` do not include `package.json`, so the page imports the file by its
// workspace path (src/pages/index.astro).

/** The fields of the element's package.json that the page reads. */
export type PackageManifest = {
  readonly name: string;
  readonly version: string;
};

export type Release = {
  /** The badge text, such as "Beta · @schalkneethling/bcd-embed@0.1.0-beta.0". */
  readonly badge: string;
  /** The command a reader copies, such as "npm install @schalkneethling/bcd-embed@beta". */
  readonly installCommand: string;
};

// Semantic Versioning marks a prerelease with a hyphen after the patch number, then dot-separated
// identifiers: `0.1.0-beta.0`, `1.1.0-rc.1`, or only a number, as in `1.0.0-0`. The release
// workflow stages a prerelease under the dist-tag named by its first identifier, as `beta` is, and
// a stable version under `latest` (apps/website/src/content/docs/releasing.md).
const PRERELEASE_PATTERN = /^\d+\.\d+\.\d+-([0-9A-Za-z-]+)/;

/** The badge's words for the stages the project names; any other identifier is shown as it is. */
const STAGE_NAMES: Readonly<Record<string, string>> = {
  alpha: "Alpha",
  beta: "Beta",
  rc: "Release candidate",
};

export const describeRelease = ({ name, version }: PackageManifest): Release => {
  const identifier = PRERELEASE_PATTERN.exec(version)?.[1];
  const packageAtVersion = `${name}@${version}`;
  if (identifier === undefined) {
    return { badge: packageAtVersion, installCommand: `npm install ${name}` };
  }
  // A number alone, as in `1.0.0-0`, names no stage and is not a dist-tag npm accepts: "Tags that
  // can be interpreted as valid semver ranges will be rejected" (npm dist-tag, "Caveats"). Such a
  // prerelease is still never `latest`, so the
  // badge calls it a prerelease and the command pins the exact version.
  if (/^\d+$/.test(identifier)) {
    return {
      badge: `Prerelease · ${packageAtVersion}`,
      installCommand: `npm install ${packageAtVersion}`,
    };
  }
  return {
    badge: `${STAGE_NAMES[identifier] ?? identifier} · ${packageAtVersion}`,
    installCommand: `npm install ${name}@${identifier}`,
  };
};
