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

// A prerelease version has a hyphen after its patch number, then its identifier, such as
// `0.1.0-beta.0`. The release workflow stages a prerelease under the dist-tag named by that
// identifier, and a stable version under `latest` (apps/website/src/content/docs/releasing.md).
const PRERELEASE_PATTERN = /^\d+\.\d+\.\d+-([a-z]+)/i;

export const describeRelease = ({ name, version }: PackageManifest): Release => {
  const identifier = PRERELEASE_PATTERN.exec(version)?.[1]?.toLowerCase();
  const packageAtVersion = `${name}@${version}`;
  if (identifier === undefined) {
    return { badge: packageAtVersion, installCommand: `npm install ${name}` };
  }
  const stage = `${identifier.charAt(0).toUpperCase()}${identifier.slice(1)}`;
  return {
    badge: `${stage} · ${packageAtVersion}`,
    installCommand: `npm install ${name}@${identifier}`,
  };
};
