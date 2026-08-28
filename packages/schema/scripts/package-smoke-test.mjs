import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const temporaryDirectory = await mkdtemp(join(tmpdir(), "bcd-embed-schema-pack-"));
const schemaNames = [
  "feature-response",
  "browsers-response",
  "index-response",
  "meta-response",
  "api-error-response",
];

try {
  const packed = spawnSync(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", temporaryDirectory],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
    },
  );
  if (packed.status !== 0) {
    throw new Error(packed.stderr || packed.stdout);
  }

  const tarball = packed.stdout.trim().split("\n").at(-1);
  if (!tarball) {
    throw new Error("npm pack did not report a tarball.");
  }

  const extractedPackage = join(temporaryDirectory, "node_modules", "@bcd-embed", "schema");
  const extracted = spawnSync(
    "tar",
    ["-xf", join(temporaryDirectory, tarball), "-C", temporaryDirectory],
    { encoding: "utf8" },
  );
  if (extracted.status !== 0) {
    throw new Error(extracted.stderr || extracted.stdout);
  }

  await mkdir(join(temporaryDirectory, "node_modules", "@bcd-embed"), {
    recursive: true,
  });
  await rename(join(temporaryDirectory, "package"), extractedPackage);

  const nodeModules = join(temporaryDirectory, "node_modules");
  await symlink(
    fileURLToPath(new URL("../node_modules/zod", import.meta.url)),
    join(nodeModules, "zod"),
    "dir",
  );

  const smokeTest = join(temporaryDirectory, "smoke.mjs");
  await writeFile(
    smokeTest,
    `import { createRequire } from "node:module";
import { featureResponseSchema } from "@bcd-embed/schema";
const require = createRequire(import.meta.url);
if (typeof featureResponseSchema.parse !== "function") throw new Error("Missing Zod export");
for (const name of ${JSON.stringify(schemaNames)}) {
  const jsonSchema = require(\`@bcd-embed/schema/json-schema/\${name}\`);
  if (jsonSchema.$schema !== "https://json-schema.org/draft/2020-12/schema") throw new Error(\`Invalid JSON Schema draft for \${name}\`);
  if (jsonSchema.$id !== \`https://bcd-embed.dev/schemas/v1/\${name}.schema.json\`) throw new Error(\`Invalid JSON Schema ID for \${name}\`);
}
`,
  );
  const smoke = spawnSync(process.execPath, [smokeTest], {
    cwd: temporaryDirectory,
    encoding: "utf8",
    env: process.env,
  });
  if (smoke.status !== 0) {
    throw new Error(smoke.stderr || smoke.stdout);
  }

  const typeSmokeTest = join(temporaryDirectory, "smoke.ts");
  await writeFile(
    typeSmokeTest,
    `import { featureResponseSchema, type FeatureResponse } from "@bcd-embed/schema";
declare const input: unknown;
const parsed: FeatureResponse = featureResponseSchema.parse(input);
void parsed;
`,
  );
  const typeScriptConfig = join(temporaryDirectory, "tsconfig.json");
  await writeFile(
    typeScriptConfig,
    `${JSON.stringify(
      {
        compilerOptions: {
          module: "ESNext",
          moduleResolution: "bundler",
          noEmit: true,
          strict: true,
          target: "ESNext",
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
    [typeScriptCompiler, "--project", typeScriptConfig],
    { cwd: temporaryDirectory, encoding: "utf8", env: process.env },
  );
  if (typeSmoke.status !== 0) {
    throw new Error(typeSmoke.stderr || typeSmoke.stdout);
  }

  const manifest = JSON.parse(await readFile(join(extractedPackage, "package.json"), "utf8"));
  for (const name of schemaNames) {
    if (!manifest.exports[`./json-schema/${name}`]) {
      throw new Error(`Packed manifest is missing the ${name} JSON Schema export.`);
    }
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
