import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import postcss from "postcss";
import type { AtRule, ChildNode } from "postcss";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

const readManifest = async (): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));

describe("package.json", () => {
  it("has exports, files, array-form sideEffects, and a build script, and stays private", async () => {
    const manifest = await readManifest();

    expect(manifest.private).toBe(true);
    expect(manifest.exports).toEqual({
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./base.css": "./dist/base.css",
      "./package.json": "./package.json",
    });
    expect(manifest.files).toEqual(["dist", "custom-elements.json"]);
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
  // One build for every test in this block, into a temporary directory.
  let outDir = "";
  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "bcd-embed-element-build-"));
    await build({
      root: packageRoot,
      mode: "lib",
      logLevel: "silent",
      build: { outDir, emptyOutDir: true },
    });
  }, 30_000);
  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("emits the element and the base stylesheet, and nothing else", async () => {
    expect((await readdir(outDir)).toSorted()).toEqual(["base.css", "index.js"]);
  });

  it("leaves no mention of zod in dist/index.js", async () => {
    const output = await readFile(join(outDir, "index.js"), "utf8");

    expect(output.length).toBeGreaterThan(0);
    expect(output.toLowerCase()).not.toContain("zod");
  });

  // Document 3 section 3, "Cascade layers": the published base.css is one file that declares its
  // layer first, keeps the @property rules at the top level, and puts every other rule in the
  // layer bcd-embed.base.
  describe("dist/base.css", () => {
    const readBuiltStylesheet = async () =>
      postcss.parse(await readFile(join(outDir, "base.css"), "utf8"));
    /** The at-rule's name, such as "layer", or null for a node that is not an at-rule. */
    const atRuleName = (node: ChildNode): string | null =>
      node.type === "atrule" ? node.name : null;

    it("starts with the statement @layer bcd-embed.base, before any other rule", async () => {
      const root = await readBuiltStylesheet();
      const first = root.nodes.find((node) => node.type !== "comment");

      expect(first?.type).toBe("atrule");
      expect(first?.type === "atrule" ? `@${first.name} ${first.params}` : "").toBe(
        "@layer bcd-embed.base",
      );
      // A statement, not a block: it has no child nodes.
      expect(first?.type === "atrule" ? first.nodes : null).toBeUndefined();
    });

    it("inlines every import", async () => {
      const root = await readBuiltStylesheet();
      const imports: string[] = [];
      root.walkAtRules("import", (rule) => {
        imports.push(rule.params);
      });

      expect(imports).toEqual([]);
    });

    it("keeps every @property rule at the top level, and every other rule inside the layer", async () => {
      const root = await readBuiltStylesheet();
      const outside = root.nodes.filter(
        (node) =>
          node.type !== "comment" &&
          atRuleName(node) !== "layer" &&
          atRuleName(node) !== "property",
      );
      const layerBlocks = root.nodes.filter(
        (node): node is AtRule =>
          node.type === "atrule" && node.name === "layer" && node.nodes !== undefined,
      );
      const nestedProperties: string[] = [];
      root.walkAtRules("property", (rule) => {
        if (rule.parent !== root) nestedProperties.push(rule.params);
      });
      let layeredRules = 0;
      for (const block of layerBlocks) {
        block.walkRules(() => {
          layeredRules += 1;
        });
      }

      expect(outside).toEqual([]);
      expect(nestedProperties).toEqual([]);
      expect(root.nodes.filter((node) => atRuleName(node) === "property").length).toBeGreaterThan(
        0,
      );
      expect(layerBlocks.map((block) => block.params)).toEqual(
        layerBlocks.map(() => "bcd-embed.base"),
      );
      expect(layeredRules).toBeGreaterThan(0);
    });

    it("keeps the values as written, because it is not minified", async () => {
      const built = await readFile(join(outDir, "base.css"), "utf8");

      expect(built).toContain(
        "light-dark(var(--bcd-color-supported-light), var(--bcd-color-supported-dark))",
      );
      expect(built).toContain("initial-value: #1a7f37;");
    });
  });
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
