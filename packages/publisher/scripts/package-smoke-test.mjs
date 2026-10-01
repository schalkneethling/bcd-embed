import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const temporary = await mkdtemp(join(tmpdir(), "bcd-embed-publisher-pack-"));
const run = (command, args, cwd = temporary) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
    timeout: 60_000,
  });
  if (result.error) throw result.error;
  if (result.signal || result.status !== 0)
    throw new Error(`Package smoke failed: ${result.stderr || result.stdout}`);
  return result.stdout;
};
try {
  const packed = run(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", temporary],
    fileURLToPath(new URL("..", import.meta.url)),
  );
  const tarball = packed.trim().split("\n").at(-1);
  if (!tarball) throw new Error("npm pack did not report a tarball.");
  run("tar", ["-xf", join(temporary, tarball), "-C", temporary]);
  const scope = join(temporary, "node_modules", "@bcd-embed");
  await mkdir(scope, { recursive: true });
  await rename(join(temporary, "package"), join(scope, "publisher"));
  for (const dependency of ["generator", "schema"]) {
    await symlink(
      fileURLToPath(new URL(`../../${dependency}`, import.meta.url)),
      join(scope, dependency),
      "dir",
    );
  }
  for (const [scopeName, packageName] of [
    ["@aws-sdk", "client-s3"],
    ["@types", "node"],
  ]) {
    const targetScope = join(temporary, "node_modules", scopeName);
    await mkdir(targetScope, { recursive: true });
    const source =
      scopeName === "@types"
        ? "../../../node_modules/@types/node"
        : "../node_modules/@aws-sdk/client-s3";
    await symlink(
      fileURLToPath(new URL(source, import.meta.url)),
      join(targetScope, packageName),
      "dir",
    );
  }
  await symlink(
    fileURLToPath(new URL("../node_modules/semver", import.meta.url)),
    join(temporary, "node_modules", "semver"),
    "dir",
  );
  await writeFile(
    join(temporary, "smoke.mjs"),
    `import { createR2S3Store, publishCandidate, pruneRetiredSnapshots, readPublicationReservation, restorePublishedBaseline, validateCandidate, parsePublishCommand } from "@bcd-embed/publisher";
for (const value of [createR2S3Store, publishCandidate, pruneRetiredSnapshots, readPublicationReservation, restorePublishedBaseline, validateCandidate]) if (typeof value !== "function") throw new Error("Missing runtime export");
if (parsePublishCommand(["--help"]).type !== "help") throw new Error("CLI grammar mismatch");
createR2S3Store({ accountId: "0".repeat(32), bucket: "smoke-test", accessKeyId: "local-only", secretAccessKey: "local-only" });
`,
  );
  run(process.execPath, [join(temporary, "smoke.mjs")]);
  run(process.execPath, [join(scope, "publisher", "dist", "bin.js"), "--help"]);
  await writeFile(
    join(temporary, "smoke.ts"),
    `import { readPublicationReservation, restorePublishedBaseline, type PublicationStore, type PublicationReservation, type RestoredBaseline } from "@bcd-embed/publisher";
declare const store: PublicationStore;
const reservation: Promise<PublicationReservation | null> = readPublicationReservation(store, "bcd-8.1.3-gen-0.0.0");
const baseline: Promise<RestoredBaseline | null> = restorePublishedBaseline({ store, outputRoot: "/trusted/empty" });
void reservation; void baseline;
`,
  );
  await writeFile(
    join(temporary, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "ESNext",
        moduleResolution: "bundler",
        noEmit: true,
        strict: true,
        target: "ESNext",
        verbatimModuleSyntax: true,
        types: ["node"],
      },
      include: ["smoke.ts"],
    }),
  );
  run(process.execPath, [
    fileURLToPath(new URL("../../../node_modules/typescript/bin/tsc", import.meta.url)),
    "--project",
    join(temporary, "tsconfig.json"),
  ]);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
