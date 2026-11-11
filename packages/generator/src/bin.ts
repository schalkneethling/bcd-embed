#!/usr/bin/env node
import { emitContentTree } from "./content-tree.js";
import { parseGenerateCommand, usage } from "./cli.js";
import { generateSnapshot } from "./generate.js";

const main = async (): Promise<void> => {
  const command = parseGenerateCommand(process.argv.slice(2));
  if (command.type === "help") {
    process.stdout.write(`${usage}\n`);
    return;
  }
  const generatedSnapshot = generateSnapshot({
    generated: command.generated,
    expires: command.expires,
  });
  const result = await emitContentTree({ outputRoot: command.outputRoot, generatedSnapshot });
  process.stdout.write(
    `Emitted ${result.artifacts} artifacts as ${result.blobs} blobs for ${result.snapshotId}; root ${result.rootSha256}.\n`,
  );
};

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown error.";
  process.stderr.write(`bcd-embed-generate: ${message}\n`);
  process.exitCode = 1;
}
