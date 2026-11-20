import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { build } from "vite";
import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

const readManifest = async (): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));

describe("package.json", () => {
  it("has exports, files, array-form sideEffects, and a build script, and stays private", async () => {
    const manifest = await readManifest();

    expect(manifest.private).toBe(true);
    expect(manifest.exports).toEqual({
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./package.json": "./package.json",
    });
    expect(manifest.files).toEqual(["dist"]);
    expect(manifest.sideEffects).toEqual(["./dist/index.js", "./dist/*.css"]);
    expect(manifest.scripts).toHaveProperty("build");
  });

  it("lists lit and @lit/task as regular dependencies, and the schema only as a development one", async () => {
    const manifest = await readManifest();

    expect(manifest.dependencies).toEqual({ "@lit/task": "1.0.3", lit: "3.3.3" });
    expect(manifest.devDependencies).toHaveProperty("@bcd-embed/schema", "workspace:*");
  });
});

describe("a production build", () => {
  it("leaves no mention of zod in dist/index.js", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "bcd-embed-element-build-"));
    try {
      await build({
        root: packageRoot,
        mode: "lib",
        logLevel: "silent",
        build: { outDir, emptyOutDir: true },
      });

      const output = await readFile(join(outDir, "index.js"), "utf8");

      expect(output.length).toBeGreaterThan(0);
      expect(output.toLowerCase()).not.toContain("zod");
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("the type declarations", () => {
  // Emits the declarations the way `tsconfig.build.json` does, into a temporary directory. The
  // configuration extends the package's `tsconfig.json`, whose `paths` point at the schema
  // package's source, so the test does not need `@bcd-embed/schema` built first. It sits under
  // `node_modules/.cache`, inside the package, so TypeScript finds `@types/node` from there.
  const emitDeclarations = async (): Promise<{ directory: string; sourceRoot: string }> => {
    const cache = join(packageRoot, "node_modules", ".cache");
    await mkdir(cache, { recursive: true });
    const directory = await mkdtemp(join(cache, "declarations-"));
    const outDir = join(directory, "out");
    await writeFile(
      join(directory, "tsconfig.json"),
      JSON.stringify({
        extends: join(packageRoot, "tsconfig.json"),
        compilerOptions: {
          declaration: true,
          emitDeclarationOnly: true,
          noEmit: false,
          outDir,
          rootDir: resolve(packageRoot, ".."),
        },
        include: [join(packageRoot, "src/**/*.ts")],
      }),
    );
    const require = createRequire(import.meta.url);
    const tsc = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
    await promisify(execFile)(process.execPath, [tsc, "--project", directory]);
    return { directory, sourceRoot: join(outDir, "element", "src") };
  };

  // Every declaration file that `entry` reaches through an import or an export, itself included.
  const reachableDeclarations = async (entry: string): Promise<Map<string, string>> => {
    const files = new Map<string, string>();
    const queue = [entry];
    for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
      if (files.has(file)) continue;
      const text = await readFile(file, "utf8");
      files.set(file, text);
      for (const [, specifier = ""] of text.matchAll(
        /(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g,
      )) {
        if (specifier.startsWith(".")) {
          queue.push(resolve(dirname(file), specifier.replace(/\.js$/, ".d.ts")));
        }
      }
    }
    return files;
  };

  it("names the hand-written interface in HTMLElementTagNameMap and never imports from lit", async () => {
    const { directory, sourceRoot } = await emitDeclarations();
    try {
      const entry = join(sourceRoot, "index.d.ts");
      const files = await reachableDeclarations(entry);
      const publicTypes = files.get(join(sourceRoot, "public-types.d.ts")) ?? "";

      // The element's class extends a Lit class, so its own declaration file does import from
      // lit. That shows the check below can fail, and that the entry does not reach the class.
      expect(await readFile(join(sourceRoot, "bcd-compat-table.d.ts"), "utf8")).toMatch(
        /from ["']lit["']/,
      );
      expect(files.size).toBeGreaterThan(1);
      for (const [file, text] of files) {
        expect(/["'](?:lit|lit\/[^"']*|lit-[^"']*|@lit\/[^"']*)["']/.test(text), file).toBe(false);
      }
      expect(publicTypes).toMatch(/interface BcdCompatTableElement extends HTMLElement/);
      expect(publicTypes).toMatch(
        /interface HTMLElementTagNameMap\s*\{\s*"bcd-compat-table": BcdCompatTableElement;/,
      );
      expect(files.get(entry)).toMatch(/BcdCompatTableElement/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);
});
