// The documentation site shows excerpts of the files in `examples/` (issue #208), and the site's
// own test checks that each sample is in its file. That keeps a sample from drifting only if a
// test also runs the file, so this test fails when an example is added that no browser test or
// end-to-end test imports.
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

const listFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
};

/** Removes block and line comments, so a path mentioned in a comment is not an import. */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/**
 * The relative module specifiers a source file imports: `import … from "x"`, `import "x"`, and
 * `import("x")`. A query such as `?raw` is dropped.
 */
const importSpecifiers = (source: string): string[] =>
  Array.from(
    withoutComments(source).matchAll(
      /(?:\bfrom\s+|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"'?]+)(?:\?[^"']*)?["']/g,
    ),
    (match) => match[1] ?? "",
  );

/** A TypeScript import names `CompatTable.tsx` as `CompatTable.js`, so compare without it. */
const stem = (path: string): string => path.replace(/\.[^./]+$/, "");

describe("examples", () => {
  it("are each imported by a browser test or an end-to-end test", async () => {
    const examples = await listFiles(join(packageRoot, "examples"));
    const testFiles = [
      ...(await listFiles(join(packageRoot, "browser"))),
      ...(await listFiles(join(packageRoot, "e2e"))),
    ].filter((file) => /\.(?:ts|tsx)$/.test(file));

    const imported = new Set<string>();
    for (const file of testFiles) {
      for (const specifier of importSpecifiers(await readFile(file, "utf8"))) {
        imported.add(stem(resolve(dirname(file), specifier)));
      }
    }

    expect(examples.length).toBeGreaterThan(0);
    const unexercised = examples
      .filter((file) => !imported.has(stem(file)))
      .map((file) => relative(packageRoot, file));
    expect(unexercised).toEqual([]);
  });

  it("does not count a path that appears only in a comment", () => {
    const source = [
      '// import "../examples/commented.js";',
      '/* import("../examples/blocked.js") */',
      'import "../examples/real.js";',
      'import html from "../examples/page.html?raw";',
      'const { CompatTable } = await import("../../../examples/react/CompatTable.js");',
    ].join("\n");
    expect(importSpecifiers(source)).toEqual([
      "../examples/real.js",
      "../examples/page.html",
      "../../../examples/react/CompatTable.js",
    ]);
  });
});
