import { readFile, writeFile } from "node:fs/promises";

import bcd from "@mdn/browser-compat-data" with { type: "json" };

const check = process.argv.slice(2).includes("--check");
const unknownArguments = process.argv.slice(2).filter((argument) => argument !== "--check");

if (unknownArguments.length > 0) {
  throw new Error(`Unknown arguments: ${unknownArguments.join(", ")}`);
}

const fragmentPaths = [
  "css.properties.width.fit-content",
  "css.properties.min-width.min-content",
  "api.AbortController.abort",
  "api.AudioTrackList",
  "api.Attr.localName",
];

if (bcd.__meta.version !== "8.0.13") {
  throw new Error(`Expected BCD 8.0.13, received ${bcd.__meta.version}.`);
}

const atPath = (path) =>
  path.split(".").reduce((value, segment) => {
    if (value === undefined || value === null || typeof value !== "object") {
      throw new Error(`Missing BCD fixture path: ${path}`);
    }
    return value[segment];
  }, bcd);

const document = {
  source: {
    package: "@mdn/browser-compat-data",
    version: bcd.__meta.version,
  },
  fragments: Object.fromEntries(
    fragmentPaths.map((path) => {
      const feature = atPath(path);
      if (feature?.__compat === undefined) {
        throw new Error(`BCD fixture path has no __compat block: ${path}`);
      }
      return [path, feature.__compat];
    }),
  ),
  subtrees: {
    "javascript.builtins.Array": atPath("javascript.builtins.Array"),
  },
};

const contents = `${JSON.stringify(document, null, 2)}\n`;
const output = new URL("../src/fixtures/source-fragments.json", import.meta.url);

if (check) {
  const committed = await readFile(output, "utf8");
  if (committed !== contents) {
    throw new Error("source-fragments.json is not up to date with BCD 8.0.13.");
  }
} else {
  await writeFile(output, contents);
}
