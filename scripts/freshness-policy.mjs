import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { parse } from "yaml";

export const BCD_PACKAGE = "@mdn/browser-compat-data";
export const BCD_MANIFESTS = [
  "packages/core/package.json",
  "packages/generator/package.json",
  "apps/worker/package.json",
];
export const ALLOWED_BCD_UPDATE_PATHS = [...BCD_MANIFESTS, "pnpm-lock.yaml"];

const exactVersion = /^\d+\.\d+\.\d+$/;
const asPosix = (path) => path.split(sep).join("/");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  return value;
};
const withoutBcdLock = (lock) => {
  const copy = structuredClone(lock);
  for (const section of ["packages", "snapshots"]) {
    for (const key of Object.keys(copy[section] ?? {})) {
      if (key.startsWith(`${BCD_PACKAGE}@`)) delete copy[section][key];
    }
  }
  for (const importer of Object.values(copy.importers ?? {})) {
    for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
      delete importer[field]?.[BCD_PACKAGE];
    }
  }
  return stable(copy);
};

const bcdVersion = (manifest, path) => {
  const version = manifest.dependencies?.[BCD_PACKAGE] ?? manifest.devDependencies?.[BCD_PACKAGE];
  if (typeof version !== "string" || !exactVersion.test(version)) {
    throw new Error(`${path} must pin ${BCD_PACKAGE} to an exact x.y.z version.`);
  }
  return version;
};

const candidateRelativePath = (candidateRoot, path) => {
  const normalized = asPosix(path);
  if (!normalized.startsWith("/")) return normalized;
  const relativePath = asPosix(relative(candidateRoot, path));
  if (relativePath.startsWith("../") || relativePath === "..") {
    throw new Error(`Changed path is outside the candidate checkout: ${path}`);
  }
  return relativePath;
};

const assertExactChangedPaths = (candidateRoot, changedPaths) => {
  const actual = new Set(changedPaths.map((path) => candidateRelativePath(candidateRoot, path)));
  const expected = new Set(ALLOWED_BCD_UPDATE_PATHS);
  if (actual.size !== expected.size || [...actual].some((path) => !expected.has(path))) {
    throw new Error(
      `Blocked: grouped BCD updates may change only ${ALLOWED_BCD_UPDATE_PATHS.join(", ")}.`,
    );
  }
};

const withoutBcd = (manifest) => {
  const copy = structuredClone(manifest);
  for (const field of ["dependencies", "devDependencies"]) delete copy[field]?.[BCD_PACKAGE];
  return copy;
};

export const classifyBcdCandidate = async ({ baseRoot, candidateRoot }) => {
  const pairs = await Promise.all(
    BCD_MANIFESTS.map(async (path) => [
      path,
      await readJson(resolve(baseRoot, path)),
      await readJson(resolve(candidateRoot, path)),
    ]),
  );
  if (
    pairs.every(([path, base, candidate]) => bcdVersion(base, path) === bcdVersion(candidate, path))
  ) {
    return { kind: "non_bcd" };
  }
  for (const [path, base, candidate] of pairs) {
    if (
      JSON.stringify(stable(withoutBcd(base))) !== JSON.stringify(stable(withoutBcd(candidate)))
    ) {
      throw new Error(`${path} changes data beyond the exact BCD pin.`);
    }
  }
  return { kind: "bcd" };
};

/** Validate a Dependabot BCD candidate without evaluating candidate source code. */
export const validateBcdCandidate = async ({
  baseRoot,
  candidateRoot,
  changedPaths,
  registryMetadata,
}) => {
  const classification = await classifyBcdCandidate({ baseRoot, candidateRoot });
  if (classification.kind !== "bcd") throw new Error("Candidate does not change the BCD pin.");
  assertExactChangedPaths(candidateRoot, changedPaths);
  const baseVersions = await Promise.all(
    BCD_MANIFESTS.map(async (path) => bcdVersion(await readJson(resolve(baseRoot, path)), path)),
  );
  const candidateVersions = await Promise.all(
    BCD_MANIFESTS.map(async (path) =>
      bcdVersion(await readJson(resolve(candidateRoot, path)), path),
    ),
  );
  if (new Set(baseVersions).size !== 1) throw new Error("Base BCD pins disagree; blocking update.");
  if (new Set(candidateVersions).size !== 1) {
    throw new Error("Candidate BCD pins disagree across core, generator, and Worker.");
  }
  const [baseVersion] = baseVersions;
  const [version] = candidateVersions;
  const baseParts = baseVersion.split(".").map(Number);
  const candidateParts = version.split(".").map(Number);
  if (candidateParts.every((part, index) => part === baseParts[index])) {
    throw new Error("Candidate does not change the BCD version.");
  }
  const newer = candidateParts.some(
    (part, index) =>
      candidateParts
        .slice(0, index)
        .every((prior, priorIndex) => prior === baseParts[priorIndex]) && part > baseParts[index],
  );
  if (!newer) throw new Error("Candidate BCD version must be newer than the base pin.");

  const integrity = registryMetadata?.["dist.integrity"];
  if (
    registryMetadata?.version !== version ||
    typeof integrity !== "string" ||
    !integrity.startsWith("sha512-")
  ) {
    throw new Error("Registry provenance does not match the exact candidate BCD release.");
  }
  const lockfile = await readFile(resolve(candidateRoot, "pnpm-lock.yaml"), "utf8");
  const baseLockfile = await readFile(resolve(baseRoot, "pnpm-lock.yaml"), "utf8");
  const candidateLock = parse(lockfile);
  const baseLock = parse(baseLockfile);
  if (
    !candidateLock ||
    !baseLock ||
    JSON.stringify(withoutBcdLock(candidateLock)) !== JSON.stringify(withoutBcdLock(baseLock))
  ) {
    throw new Error("Candidate lockfile changes data beyond the BCD package.");
  }
  const entry = candidateLock.packages?.[`${BCD_PACKAGE}@${version}`];
  if (JSON.stringify(entry) !== JSON.stringify({ resolution: { integrity } })) {
    throw new Error(
      "Candidate BCD package descriptor is not the registry-verified immutable entry.",
    );
  }
  if (
    JSON.stringify(candidateLock.snapshots?.[`${BCD_PACKAGE}@${version}`]) !== JSON.stringify({})
  ) {
    throw new Error("Candidate BCD snapshot must not add dependencies.");
  }
  for (const section of ["packages", "snapshots"]) {
    for (const [key, value] of Object.entries(candidateLock[section] ?? {})) {
      if (
        key.startsWith(`${BCD_PACKAGE}@`) &&
        key !== `${BCD_PACKAGE}@${version}` &&
        JSON.stringify(stable(value)) !== JSON.stringify(stable(baseLock[section]?.[key]))
      ) {
        throw new Error("Candidate lockfile changes an unrelated BCD descriptor.");
      }
    }
  }
  const synchronizedImporters = new Map(
    BCD_MANIFESTS.map((path) => [path.replace(/\/package\.json$/, ""), path]),
  );
  for (const [importerPath, importer] of Object.entries(candidateLock.importers ?? {})) {
    for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
      const pin = importer[field]?.[BCD_PACKAGE];
      const basePin = baseLock.importers?.[importerPath]?.[field]?.[BCD_PACKAGE];
      const synchronized = synchronizedImporters.has(importerPath);
      if (
        (!synchronized && JSON.stringify(pin) !== JSON.stringify(basePin)) ||
        (synchronized &&
          ((basePin === undefined) !== (pin === undefined) ||
            (pin !== undefined &&
              JSON.stringify(stable(pin)) !==
                JSON.stringify(stable({ specifier: version, version })))))
      ) {
        throw new Error(
          `Candidate BCD importer '${importerPath}' is not an exact synchronized pin.`,
        );
      }
      if (
        pin !== undefined &&
        (candidateLock.packages?.[`${BCD_PACKAGE}@${pin.version}`] === undefined ||
          candidateLock.snapshots?.[`${BCD_PACKAGE}@${pin.version}`] === undefined)
      ) {
        throw new Error(
          `Candidate BCD importer '${importerPath}' has a missing package or snapshot.`,
        );
      }
    }
  }
  for (const importerPath of synchronizedImporters.keys()) {
    const importer = candidateLock.importers?.[importerPath];
    if (
      !importer ||
      !["dependencies", "devDependencies"].some((field) => importer[field]?.[BCD_PACKAGE])
    ) {
      throw new Error(`Candidate BCD importer '${importerPath}' is missing its synchronized pin.`);
    }
  }
  return { baseVersion, integrity, package: BCD_PACKAGE, version };
};
