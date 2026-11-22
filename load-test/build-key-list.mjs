// Writes load-test/keys.json from a locally generated artifact folder. It reads local files only
// and sends no request. Run it after generating the snapshot that production serves:
//
//   node packages/generator/dist/bin.js --out <dir> --generated <time> --expires <date>
//   node load-test/build-key-list.mjs --artifacts <dir>
//
// The artifact folder's `v1/meta.json` names the current snapshot, its root names `index.json`'s
// blob, and that blob lists every feature key.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildKeyList, isPublicFeatureKey } from "./lib/key-list.mjs";

const usage = "Usage: node load-test/build-key-list.mjs --artifacts <folder> [--out <file>]";

const parseArguments = (arguments_) => {
  const values = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!["--artifacts", "--out"].includes(name ?? "") || value === undefined) {
      throw new Error(`Unexpected argument '${name ?? ""}'.\n${usage}`);
    }
    values[name.slice(2)] = value;
  }
  if (values.artifacts === undefined) throw new Error(usage);
  return values;
};

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const main = async () => {
  const { artifacts, out } = parseArguments(process.argv.slice(2));
  const root = join(resolve(artifacts), "v1");
  const meta = await readJson(join(root, "meta.json"));
  const snapshot = meta.snapshots.find((item) => item.id === meta.current);
  const tree = await readJson(join(root, "snapshots", `${meta.current}.json`));
  const indexHash = tree.structural["index.json"];
  const index = await readJson(join(root, "blobs", `${indexHash}.json`));
  const list = buildKeyList({
    indexKeys: index.keys,
    namespaces: meta.namespaces,
    snapshot: meta.current,
    sourceVersion: snapshot.source.version,
    contract: meta.contract,
  });
  for (const key of [...list.popular, ...list.deep, ...list.sampled]) {
    if (!isPublicFeatureKey(key)) throw new Error(`Not a public feature key: ${key}`);
  }
  const target = out ?? join(dirname(fileURLToPath(import.meta.url)), "keys.json");
  await writeFile(target, `${JSON.stringify(list, null, 2)}\n`);
  console.log(
    `Wrote ${target}: ${list.popular.length} popular, ${list.deep.length} deep, ` +
      `${list.sampled.length} sampled, ${list.grouping.length} grouping, ${list.missing.length} missing ` +
      `for ${list.snapshot} (${index.keys.length} indexed keys).`,
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
