// Reads the base stylesheet's source files for the style tests. Each file is parsed with PostCSS,
// so a test walks real declarations and at-rules instead of matching text.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import postcss from "postcss";
import type { Root } from "postcss";

export const STYLES_DIRECTORY = fileURLToPath(new URL("../../src/styles/", import.meta.url));

export type Stylesheet = {
  /** The file name, such as `table.css`. */
  readonly name: string;
  readonly root: Root;
};

/** Every `.css` file in `src/styles`, parsed, in file name order. */
export const readStylesheets = (): Stylesheet[] =>
  readdirSync(STYLES_DIRECTORY)
    .filter((name) => name.endsWith(".css"))
    .toSorted()
    .map((name) => ({
      name,
      root: postcss.parse(readFileSync(`${STYLES_DIRECTORY}${name}`, "utf8"), { from: name }),
    }));

/** One stylesheet by file name. */
export const readStylesheet = (name: string): Stylesheet => {
  const sheet = readStylesheets().find((candidate) => candidate.name === name);
  if (sheet === undefined) throw new Error(`No stylesheet ${name} in ${STYLES_DIRECTORY}`);
  return sheet;
};
