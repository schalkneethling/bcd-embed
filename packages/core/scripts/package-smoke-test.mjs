import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const temporaryDirectory = await mkdtemp(join(tmpdir(), "bcd-embed-core-pack-"));

try {
  const packageRoot = fileURLToPath(new URL("..", import.meta.url));
  const packed = spawnSync(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", temporaryDirectory],
    { cwd: packageRoot, encoding: "utf8" },
  );
  if (packed.status !== 0) throw new Error(packed.stderr || packed.stdout);
  const tarball = packed.stdout.trim().split("\n").at(-1);
  if (!tarball) throw new Error("npm pack did not report a tarball.");

  const extracted = spawnSync(
    "tar",
    ["-xf", join(temporaryDirectory, tarball), "-C", temporaryDirectory],
    { encoding: "utf8" },
  );
  if (extracted.status !== 0) throw new Error(extracted.stderr || extracted.stdout);

  const scopeDirectory = join(temporaryDirectory, "node_modules", "@bcd-embed");
  await mkdir(scopeDirectory, { recursive: true });
  await rename(join(temporaryDirectory, "package"), join(scopeDirectory, "core"));
  await symlink(
    fileURLToPath(new URL("../../schema", import.meta.url)),
    join(scopeDirectory, "schema"),
    "dir",
  );
  const mdnScope = join(temporaryDirectory, "node_modules", "@mdn");
  await mkdir(mdnScope, { recursive: true });
  await symlink(
    fileURLToPath(new URL("../node_modules/@mdn/browser-compat-data", import.meta.url)),
    join(mdnScope, "browser-compat-data"),
    "dir",
  );

  const smokeTest = join(temporaryDirectory, "smoke.mjs");
  await writeFile(
    smokeTest,
    `import bcd from "@mdn/browser-compat-data" with { type: "json" };
import { BcdNormalizationError, normalizeFeatureSubtree } from "@bcd-embed/core";
const result = normalizeFeatureSubtree({
  key: "javascript.builtins.Array",
  subtree: bcd.javascript.builtins.Array,
  browsers: bcd.browsers,
});
if (result.features.length !== 51) throw new Error("Packed core returned an incomplete Array subtree");
if (typeof BcdNormalizationError !== "function") throw new Error("Missing public error export");
`,
  );
  const smoke = spawnSync(process.execPath, [smokeTest], {
    cwd: temporaryDirectory,
    encoding: "utf8",
    env: process.env,
  });
  if (smoke.status !== 0) throw new Error(smoke.stderr || smoke.stdout);

  const typeSmokeTest = join(temporaryDirectory, "smoke.ts");
  await writeFile(
    typeSmokeTest,
    `import bcd from "@mdn/browser-compat-data" with { type: "json" };
import { normalizeFeatureSubtree, type NormalizedFeatureSubtree } from "@bcd-embed/core";
const result: NormalizedFeatureSubtree = normalizeFeatureSubtree({
  key: "javascript.builtins.Array",
  subtree: bcd.javascript.builtins!.Array!,
  browsers: bcd.browsers,
});
void result;
`,
  );
  await writeFile(
    join(temporaryDirectory, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: "ESNext",
          moduleResolution: "bundler",
          noEmit: true,
          resolveJsonModule: true,
          strict: true,
          target: "ESNext",
          verbatimModuleSyntax: true,
        },
        include: ["smoke.ts"],
      },
      null,
      2,
    )}\n`,
  );
  const typeScriptCompiler = fileURLToPath(
    new URL("../../../node_modules/typescript/bin/tsc", import.meta.url),
  );
  const typeSmoke = spawnSync(
    process.execPath,
    [typeScriptCompiler, "--project", join(temporaryDirectory, "tsconfig.json")],
    { cwd: temporaryDirectory, encoding: "utf8", env: process.env },
  );
  if (typeSmoke.status !== 0) throw new Error(typeSmoke.stderr || typeSmoke.stdout);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
