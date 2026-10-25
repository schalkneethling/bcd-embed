import { writeFile } from "node:fs/promises";

import bcd from "@mdn/browser-compat-data" with { type: "json" };

if (process.argv.length > 2) {
  throw new Error(`Unknown arguments: ${process.argv.slice(2).join(", ")}`);
}

const fragmentPaths = [
  "css.properties.width.fit-content",
  "css.properties.min-width.min-content",
  "api.AbortController.abort",
  "api.AudioTrackList",
  "api.Attr.localName",
];

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

await writeFile(output, contents);
