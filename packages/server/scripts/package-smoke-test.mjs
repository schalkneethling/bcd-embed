import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const temporaryDirectory = await mkdtemp(join(tmpdir(), "bcd-embed-server-pack-"));
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
  await rename(join(temporaryDirectory, "package"), join(scope, "server"));
  await symlink(
    fileURLToPath(new URL("../../schema", import.meta.url)),
    join(scope, "schema"),
    "dir",
  );
  await writeFile(
    join(temporaryDirectory, "smoke.mjs"),
    `
import { createArtifactHandler, matchesIfNoneMatch, MAX_KEY_LENGTH } from "@bcd-embed/server";
const paths = [];
const handler = createArtifactHandler({ store: { get: async (path) => {
  paths.push(path);
  return { body: new Response('{"public":true}').body, etag: '"packed"', size: 15 };
} } });
const result = await handler(new Request("https://example.test/v1/meta.json"));
if (result.status !== 200 || (await result.json()).public !== true) throw new Error("Packed handler failed");
if (paths[0] !== "v1/meta.json" || MAX_KEY_LENGTH !== 512) throw new Error("Packed routing exports failed");
if (!matchesIfNoneMatch('W/"packed"', '"packed"')) throw new Error("Packed conditional export failed");
`,
  );
  run(process.execPath, [join(temporaryDirectory, "smoke.mjs")]);
  await writeFile(
    join(temporaryDirectory, "smoke.ts"),
    `
import { createArtifactHandler, type ArtifactStore, type Artifact, type ArtifactHandlerOptions, type ReadDecision } from "@bcd-embed/server";
const store: ArtifactStore = { get: async () => {
  const value: Artifact = { body: new ReadableStream<Uint8Array>(), etag: '"typed"' };
  return value;
} };
const options: ArtifactHandlerOptions = { store, beforeRead: () => {
  const decision: ReadDecision = { code: "rate_limited", retryAfter: 60 };
  return decision;
} };
const handler: (request: Request) => Promise<Response> = createArtifactHandler(options);
void handler;
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
