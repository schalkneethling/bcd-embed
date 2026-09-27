#!/usr/bin/env node
import { emitGeneratedSnapshot } from "./emit.js";
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
  const result = await emitGeneratedSnapshot({ outputRoot: command.outputRoot, generatedSnapshot });
  process.stdout.write(`Emitted ${result.files} artifacts for ${result.snapshotId}.\n`);
};

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown error.";
  process.stderr.write(`bcd-embed-generate: ${message}\n`);
  process.exitCode = 1;
}
