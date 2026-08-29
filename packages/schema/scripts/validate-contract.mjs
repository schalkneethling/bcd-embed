import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { contractKinds, isContractKind, validateContract } from "./lib/contract-validation.mjs";

const usage = `Usage: pnpm schema:validate --kind <kind> [file|-]

Validate one normalized v1 response with both Zod and the published JSON Schema.
When file is omitted or is -, JSON is read from standard input.

Kinds: ${contractKinds.join(", ")}`;

const { values, positionals } = parseArgs({
  options: {
    kind: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
  strict: true,
});

const main = async () => {
  if (values.help) {
    console.log(usage);
    return;
  }

  if (positionals.length > 1) {
    throw new Error(`Expected at most one input file.\n\n${usage}`);
  }
  if (!values.kind || !isContractKind(values.kind)) {
    throw new Error(`--kind must be one of: ${contractKinds.join(", ")}.\n\n${usage}`);
  }

  const input = positionals[0] ?? "-";
  let contents = "";
  if (input === "-") {
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) contents += chunk;
  } else {
    contents = await readFile(input, "utf8");
  }

  let value;
  try {
    value = JSON.parse(contents);
  } catch (error) {
    console.error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  const result = validateContract(values.kind, value);
  for (const [label, validation] of [
    ["Zod", result.zod],
    ["JSON Schema", result.jsonSchema],
  ]) {
    console.log(`${validation.valid ? "PASS" : "FAIL"} ${label}`);
    for (const error of validation.errors) {
      console.log(`  ${error.path}: ${error.message}`);
    }
  }

  process.exitCode = result.valid ? 0 : 1;
};

await main();
