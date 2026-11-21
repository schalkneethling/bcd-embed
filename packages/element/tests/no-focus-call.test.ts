// The component never moves focus (issue #204). A native <details> keeps focus on the <summary>
// that was activated, so a script that calls `focus()` could only take focus from the reader. This
// test reads the source and fails on a call to `focus`, on an `autofocus` attribute, and on a
// `tabindex` other than the scroll region's `0`, which would add a tab stop or a script-only one.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));

/** Every `.ts` file below `directory`. */
const sourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return entry.name.endsWith(".ts") ? [path] : [];
    }),
  );
  return nested.flat();
};

/** Removes block comments and whole-line comments, so prose that names `focus()` does not match. */
const withoutComments = (text: string): string =>
  text.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/^\s*\/\/.*$/gm, "");

describe("the element source", () => {
  it("calls focus() nowhere, sets no autofocus, and adds no tab stop but the region's", async () => {
    const files = await sourceFiles(sourceRoot);
    expect(files.length).toBeGreaterThan(5);

    const offences: string[] = [];
    for (const file of files) {
      const code = withoutComments(await readFile(file, "utf8"));
      if (/\bfocus\s*\(/.test(code)) offences.push(`${file}: calls focus()`);
      if (/\bautofocus\b/i.test(code)) offences.push(`${file}: autofocus`);
      for (const match of code.matchAll(/tabindex\s*=\s*"?(-?\d+)/gi)) {
        if (match[1] !== "0") offences.push(`${file}: tabindex ${match[1]}`);
      }
    }
    expect(offences).toEqual([]);
  });
});
