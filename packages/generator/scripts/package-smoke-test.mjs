import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const temporaryDirectory = await mkdtemp(join(tmpdir(), "bcd-embed-generator-pack-"));
const run = (command, args, cwd = temporaryDirectory) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
    timeout: 60_000,
  });
  if (result.error)
    throw new Error(`Could not run ${command}: ${result.error.message}`, { cause: result.error });
  if (result.signal) throw new Error(`${command} terminated by ${result.signal}.`);
  if (result.status !== 0)
    throw new Error(`${command} exited ${result.status}: ${result.stderr || result.stdout}`);
  return result.stdout;
};
try {
  const packageRoot = fileURLToPath(new URL("..", import.meta.url));
  const packed = run(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", temporaryDirectory],
    packageRoot,
  );
  const tarball = packed.trim().split("\n").at(-1);
  if (!tarball) throw new Error("npm pack did not report a tarball.");
  run("tar", ["-xf", join(temporaryDirectory, tarball), "-C", temporaryDirectory]);
  const scope = join(temporaryDirectory, "node_modules", "@bcd-embed");
  await mkdir(scope, { recursive: true });
  await rename(join(temporaryDirectory, "package"), join(scope, "generator"));
  for (const dependency of ["core", "schema"]) {
    await symlink(
      fileURLToPath(new URL(`../../${dependency}`, import.meta.url)),
      join(scope, dependency),
      "dir",
    );
  }
  const mdnScope = join(temporaryDirectory, "node_modules", "@mdn");
  await mkdir(mdnScope, { recursive: true });
  await symlink(
    fileURLToPath(new URL("../node_modules/@mdn/browser-compat-data", import.meta.url)),
    join(mdnScope, "browser-compat-data"),
    "dir",
  );
  for (const dependency of ["ajv", "ajv-formats"]) {
    await symlink(
      fileURLToPath(new URL(`../node_modules/${dependency}`, import.meta.url)),
      join(temporaryDirectory, "node_modules", dependency),
      "dir",
    );
  }
  await writeFile(
    join(temporaryDirectory, "smoke.mjs"),
    `import { emitGeneratedSnapshot, generateSnapshot, validateRawArtifact, BCD_VERSION, GENERATOR_VERSION } from "@bcd-embed/generator";
const generation = generateSnapshot({ generated: "2026-08-28T12:00:00Z", expires: "2026-11-26" });
if (generation.snapshot.id !== "bcd-" + BCD_VERSION + "-gen-" + GENERATOR_VERSION) throw new Error("Bad package metadata");
const iterator = generation.artifacts[Symbol.iterator]();
const feature = iterator.next().value;
const raw = iterator.next().value;
if (feature.kind !== "feature" || raw.kind !== "raw") throw new Error("Incomplete artifact pair");
validateRawArtifact(raw.data);
if (typeof emitGeneratedSnapshot !== "function") throw new Error("Missing emitter export");
`,
  );
  run(process.execPath, [join(temporaryDirectory, "smoke.mjs")]);
  run(process.execPath, [join(scope, "generator", "dist", "bin.js"), "--help"]);
  await writeFile(
    join(temporaryDirectory, "smoke.ts"),
    `import { generateSnapshot, type GeneratedArtifact, type GeneratedSnapshot } from "@bcd-embed/generator";
const generation: GeneratedSnapshot = generateSnapshot({ generated: "2026-08-28T12:00:00Z", expires: "2026-11-26" });
for (const artifact of generation.artifacts) {
  const value: GeneratedArtifact = artifact;
  void value;
  break;
}
`,
  );
  await writeFile(
    join(temporaryDirectory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "ESNext",
        moduleResolution: "bundler",
        noEmit: true,
        strict: true,
        target: "ESNext",
        verbatimModuleSyntax: true,
      },
      include: ["smoke.ts"],
    }),
  );
  run(process.execPath, [
    fileURLToPath(new URL("../../../node_modules/typescript/bin/tsc", import.meta.url)),
    "--project",
    join(temporaryDirectory, "tsconfig.json"),
  ]);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
