import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";

import {
  ALLOWED_BCD_UPDATE_PATHS,
  BCD_PACKAGE,
  classifyBcdCandidate,
  validateBcdCandidate,
} from "../scripts/freshness-policy.mjs";

const integrity = "sha512-registry-provenance";

const writeCandidate = async (root: string, version: string): Promise<void> => {
  await Promise.all(
    ["packages/core", "packages/generator", "apps/worker"].map((path) =>
      mkdir(join(root, path), { recursive: true }),
    ),
  );
  await Promise.all([
    writeFile(
      join(root, "packages/core/package.json"),
      JSON.stringify({ dependencies: { [BCD_PACKAGE]: version } }),
    ),
    writeFile(
      join(root, "packages/generator/package.json"),
      JSON.stringify({ dependencies: { [BCD_PACKAGE]: version } }),
    ),
    writeFile(
      join(root, "apps/worker/package.json"),
      JSON.stringify({ devDependencies: { [BCD_PACKAGE]: version } }),
    ),
    writeFile(
      join(root, "pnpm-lock.yaml"),
      stringify({
        lockfileVersion: "9.0",
        importers: Object.fromEntries(
          ["packages/core", "packages/generator", "apps/worker"].map((path) => [
            path,
            {
              [path === "apps/worker" ? "devDependencies" : "dependencies"]: {
                [BCD_PACKAGE]: { specifier: version, version },
              },
            },
          ]),
        ),
        packages: { [`${BCD_PACKAGE}@${version}`]: { resolution: { integrity } } },
        snapshots: { [`${BCD_PACKAGE}@${version}`]: {} },
      }),
    ),
  ]);
};

describe("trusted BCD freshness policy", () => {
  it("allows one exact, registry-provenanced pin across all runtime consumers", async () => {
    const root = await mkdtemp(join(tmpdir(), "bcd-freshness-"));
    try {
      const base = join(root, "base");
      const candidate = join(root, "candidate");
      await Promise.all([writeCandidate(base, "8.1.3"), writeCandidate(candidate, "8.1.4")]);
      await expect(
        validateBcdCandidate({
          baseRoot: base,
          candidateRoot: candidate,
          changedPaths: ALLOWED_BCD_UPDATE_PATHS.map((path) => join(candidate, path)),
          registryMetadata: { version: "8.1.4", "dist.integrity": integrity },
        }),
      ).resolves.toEqual({
        baseVersion: "8.1.3",
        integrity,
        package: BCD_PACKAGE,
        version: "8.1.4",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("blocks extra paths, range pins, and lockfile provenance mismatches", async () => {
    const root = await mkdtemp(join(tmpdir(), "bcd-freshness-"));
    try {
      const base = join(root, "base");
      const candidate = join(root, "candidate");
      await Promise.all([writeCandidate(base, "8.1.3"), writeCandidate(candidate, "8.1.4")]);
      await expect(
        validateBcdCandidate({
          baseRoot: base,
          candidateRoot: candidate,
          changedPaths: [...ALLOWED_BCD_UPDATE_PATHS, "README.md"],
          registryMetadata: { version: "8.1.4", "dist.integrity": integrity },
        }),
      ).rejects.toThrow("may change only");
      await expect(
        validateBcdCandidate({
          baseRoot: base,
          candidateRoot: candidate,
          changedPaths: ALLOWED_BCD_UPDATE_PATHS,
          registryMetadata: { version: "8.1.4", "dist.integrity": "sha512-other" },
        }),
      ).rejects.toThrow("registry-verified");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects malicious manifest and lockfile changes while leaving non-BCD updates neutral", async () => {
    const root = await mkdtemp(join(tmpdir(), "bcd-freshness-"));
    try {
      const base = join(root, "base");
      const candidate = join(root, "candidate");
      await Promise.all([writeCandidate(base, "8.1.3"), writeCandidate(candidate, "8.1.4")]);
      await writeFile(
        join(candidate, "packages/generator/package.json"),
        JSON.stringify({
          dependencies: { [BCD_PACKAGE]: "8.1.4" },
          scripts: { preinstall: "malicious" },
        }),
      );
      await expect(
        classifyBcdCandidate({ baseRoot: base, candidateRoot: candidate }),
      ).rejects.toThrow("beyond the exact BCD pin");
      await writeCandidate(candidate, "8.1.3");
      await expect(
        classifyBcdCandidate({ baseRoot: base, candidateRoot: candidate }),
      ).resolves.toEqual({
        kind: "non_bcd",
      });
      await writeCandidate(candidate, "8.1.2");
      await expect(
        validateBcdCandidate({
          baseRoot: base,
          candidateRoot: candidate,
          changedPaths: ALLOWED_BCD_UPDATE_PATHS,
          registryMetadata: { version: "8.1.2", "dist.integrity": integrity },
        }),
      ).rejects.toThrow("must be newer");
      await writeCandidate(candidate, "8.1.4");
      await writeFile(
        join(candidate, "pnpm-lock.yaml"),
        `lockfileVersion: '9.0'\npackages:\n  '${BCD_PACKAGE}@8.1.4':\n    resolution: {integrity: ${integrity}}\n  other@1.0.0:\n    resolution: {integrity: sha512-evil}\n`,
      );
      await expect(
        validateBcdCandidate({
          baseRoot: base,
          candidateRoot: candidate,
          changedPaths: ALLOWED_BCD_UPDATE_PATHS,
          registryMetadata: { version: "8.1.4", "dist.integrity": integrity },
        }),
      ).rejects.toThrow("lockfile changes");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it.each(["tarball", "importer", "snapshot", "extraDescriptor", "missingImporter"])(
    "blocks malicious BCD %s metadata before any candidate install",
    async (attack) => {
      const root = await mkdtemp(join(tmpdir(), "bcd-freshness-"));
      try {
        const base = join(root, "base");
        const candidate = join(root, "candidate");
        await Promise.all([writeCandidate(base, "8.1.3"), writeCandidate(candidate, "8.1.4")]);
        const path = join(candidate, "pnpm-lock.yaml");
        const lock = parse(await readFile(path, "utf8"));
        const key = `${BCD_PACKAGE}@8.1.4`;
        if (attack === "tarball")
          lock.packages[key].resolution.tarball = "https://evil.invalid/bcd.tgz";
        if (attack === "importer")
          lock.importers["packages/core"].dependencies[BCD_PACKAGE].version = "8.1.4(evil@1.0.0)";
        if (attack === "snapshot") lock.snapshots[key].dependencies = { evil: "1.0.0" };
        if (attack === "extraDescriptor")
          lock.packages[`${BCD_PACKAGE}@99.0.0`] = {
            resolution: { tarball: "https://evil.invalid/bcd.tgz" },
          };
        if (attack === "missingImporter")
          delete lock.importers["packages/core"].dependencies[BCD_PACKAGE];
        await writeFile(path, stringify(lock));
        await expect(
          validateBcdCandidate({
            baseRoot: base,
            candidateRoot: candidate,
            changedPaths: ALLOWED_BCD_UPDATE_PATHS,
            registryMetadata: { version: "8.1.4", "dist.integrity": integrity },
          }),
        ).rejects.toThrow();
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );

  it("blocks partial pin updates and mixed manifests; unrelated Worker updates are neutral", async () => {
    const root = await mkdtemp(join(tmpdir(), "bcd-freshness-"));
    try {
      const base = join(root, "base");
      const candidate = join(root, "candidate");
      await Promise.all([writeCandidate(base, "8.1.3"), writeCandidate(candidate, "8.1.4")]);
      const worker = join(candidate, "apps/worker/package.json");
      await writeFile(worker, JSON.stringify({ devDependencies: { [BCD_PACKAGE]: "8.1.3" } }));
      await expect(
        validateBcdCandidate({
          baseRoot: base,
          candidateRoot: candidate,
          changedPaths: ALLOWED_BCD_UPDATE_PATHS,
          registryMetadata: { version: "8.1.4", "dist.integrity": integrity },
        }),
      ).rejects.toThrow("pins disagree");
      await writeFile(
        worker,
        JSON.stringify({ devDependencies: { [BCD_PACKAGE]: "8.1.4", wrangler: "4.140.0" } }),
      );
      await expect(
        classifyBcdCandidate({ baseRoot: base, candidateRoot: candidate }),
      ).rejects.toThrow("beyond the exact BCD pin");
      await writeCandidate(candidate, "8.1.3");
      await writeFile(
        worker,
        JSON.stringify({ devDependencies: { [BCD_PACKAGE]: "8.1.3", wrangler: "4.140.0" } }),
      );
      await expect(
        classifyBcdCandidate({ baseRoot: base, candidateRoot: candidate }),
      ).resolves.toEqual({ kind: "non_bcd" });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
