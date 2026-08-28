import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";

import { z } from "zod";

import {
  apiErrorResponseSchema,
  browsersResponseSchema,
  featureResponseSchema,
  indexResponseSchema,
  metaResponseSchema,
} from "../src/schemas.ts";

const outputDirectory = new URL("../json-schema/", import.meta.url);
const check = process.argv.slice(2).includes("--check");
const unknownArguments = process.argv.slice(2).filter((argument) => argument !== "--check");

if (unknownArguments.length > 0) {
  throw new Error(`Unknown arguments: ${unknownArguments.join(", ")}`);
}

const definitions = [
  ["feature-response", "Feature response", featureResponseSchema],
  ["browsers-response", "Browser metadata response", browsersResponseSchema],
  ["index-response", "Feature index response", indexResponseSchema],
  ["meta-response", "Service metadata response", metaResponseSchema],
  ["api-error-response", "API error response", apiErrorResponseSchema],
];

const expectedFiles = definitions.map(([name]) => `${name}.schema.json`).sort();

if (check) {
  const actualFiles = (await readdir(outputDirectory))
    .filter((file) => file.endsWith(".schema.json"))
    .sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(
      `Generated schema file set differs: expected ${expectedFiles.join(", ")}; found ${actualFiles.join(", ")}.`,
    );
  }
} else {
  await mkdir(outputDirectory, { recursive: true });
  const actualFiles = await readdir(outputDirectory);
  await Promise.all(
    actualFiles
      .filter((file) => file.endsWith(".schema.json") && !expectedFiles.includes(file))
      .map((file) => unlink(new URL(file, outputDirectory))),
  );
}

for (const [name, title, schema] of definitions) {
  const { $schema, ...generatedSchema } = z.toJSONSchema(schema, {
    target: "draft-2020-12",
  });
  const document = {
    $schema,
    $id: `https://bcd-embed.dev/schemas/v1/${name}.schema.json`,
    title,
    $comment:
      "Relational invariants documented by the v1 contract are additionally enforced by the canonical Zod schemas.",
    ...generatedSchema,
  };
  const contents = `${JSON.stringify(document, null, 2)}\n`;
  const output = new URL(`${name}.schema.json`, outputDirectory);

  if (check) {
    const committed = await readFile(output, "utf8");
    if (committed !== contents) {
      throw new Error(`${name}.schema.json is not up to date.`);
    }
  } else {
    await writeFile(output, contents);
  }
}
