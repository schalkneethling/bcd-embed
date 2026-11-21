// The Custom Elements Manifest (`custom-elements.json`) is committed beside `package.json`. These
// tests fail when the committed file differs from what the analyzer produces now, so a change to
// the element's attributes, properties, or events must come with a regenerated manifest (issue #206).
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

type ManifestMember = {
  readonly name: string;
  readonly privacy?: string;
  readonly description?: string;
  readonly type?: { readonly text: string };
};
type ManifestDeclaration = {
  readonly kind: string;
  readonly name: string;
  readonly tagName?: string;
  readonly attributes?: readonly {
    readonly name: string;
    readonly description?: string;
    readonly type?: { readonly text: string };
  }[];
  readonly events?: readonly { readonly name: string }[];
  readonly members?: readonly ManifestMember[];
};
type Manifest = {
  readonly modules: readonly {
    readonly path: string;
    readonly declarations?: readonly ManifestDeclaration[];
    readonly exports?: readonly { readonly kind: string; readonly name: string }[];
  }[];
};

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));

describe("custom-elements.json", () => {
  let outDir = "";
  let committed: Manifest;
  let fresh: unknown;

  beforeAll(async () => {
    // A directory under the package's `node_modules/.cache`, which Git ignores. The analyzer joins
    // `outdir` onto its working directory (`cli.js`), so the path has to be relative to the
    // package, and a path inside the package stays on one drive on every platform.
    const cache = join(packageRoot, "node_modules", ".cache");
    await mkdir(cache, { recursive: true });
    outDir = await mkdtemp(join(cache, "cem-"));
    // The analyzer runs from the package, so it reads `custom-elements-manifest.config.mjs`
    // (`globs`, `litelement`, `packagejson: false`). `--outdir` is the one flag it adds, so the
    // run leaves the committed file alone.
    const require = createRequire(import.meta.url);
    const cem = join(
      dirname(require.resolve("@custom-elements-manifest/analyzer/package.json")),
      "cem.js",
    );
    await promisify(execFile)(
      process.execPath,
      [cem, "analyze", "--outdir", relative(packageRoot, outDir), "--quiet"],
      { cwd: packageRoot },
    );
    committed = (await readJson(join(packageRoot, "custom-elements.json"))) as Manifest;
    fresh = await readJson(join(outDir, "custom-elements.json"));
  }, 60_000);
  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("equals a fresh run of the analyzer", () => {
    // If this fails, run `pnpm --filter @bcd-embed/element cem` and commit the result.
    expect(committed).toEqual(fresh);
  });

  it("lists the element, its attributes, its properties, and its two events", () => {
    const declarations = committed.modules.flatMap((module) => module.declarations ?? []);
    const element = declarations.find((declaration) => declaration.tagName === "bcd-compat-table");

    expect(element?.kind).toBe("class");
    // `data` is a property only, so it has no attribute.
    expect(element?.attributes?.map((attribute) => attribute.name)).toEqual([
      "query",
      "endpoint",
      "source",
      "loading",
      "browsers",
      "locale",
    ]);
    expect(
      element?.members
        ?.filter((member) => member.privacy === "public")
        .map((member) => member.name),
    ).toEqual(["data", "query", "endpoint", "source", "loading", "browsers", "locale"]);
    expect(element?.events?.map((event) => event.name)).toEqual(["bcd-load", "bcd-error"]);
  });

  it("holds no private member and describes every public one", () => {
    const declarations = committed.modules.flatMap((module) => module.declarations ?? []);
    const element = declarations.find((declaration) => declaration.tagName === "bcd-compat-table");
    const publicMembers = element?.members ?? [];

    expect(publicMembers.filter((member) => member.privacy === "private")).toEqual([]);
    expect(publicMembers.filter((member) => !member.description)).toEqual([]);
    expect(element?.attributes?.filter((attribute) => !attribute.description)).toEqual([]);
    // The type is the alias's definition, not its name.
    expect(publicMembers.find((member) => member.name === "loading")?.type?.text).toBe(
      '"lazy" | "eager"',
    );
    expect(element?.attributes?.find((attribute) => attribute.name === "loading")?.type?.text).toBe(
      '"lazy" | "eager"',
    );
    // Private fields are named with a leading `#`, so none may appear by name.
    expect(JSON.stringify(committed)).not.toMatch(/"name":"#/);
  });

  it("records that the package entry defines bcd-compat-table", () => {
    const entry = committed.modules.find((module) => module.path === "src/index.ts");

    // The analyzer writes the declaration's module as a path of its own style, so the test checks
    // only that a module is named.
    expect(entry?.exports).toContainEqual({
      kind: "custom-element-definition",
      name: "bcd-compat-table",
      declaration: { name: "BcdCompatTable", module: expect.any(String) },
    });
  });

  it("is named by package.json and published with the package", async () => {
    const manifest = (await readJson(join(packageRoot, "package.json"))) as {
      customElements?: string;
      files?: string[];
    };

    expect(manifest.customElements).toBe("custom-elements.json");
    expect(manifest.files).toContain("custom-elements.json");
  });
});
