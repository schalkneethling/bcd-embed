import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
