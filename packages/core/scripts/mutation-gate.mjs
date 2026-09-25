import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const mutationCases = [
  {
    name: "grouping identity",
    file: "packages/core/src/support.ts",
    before: "JSON.stringify([statement.prefix, statement.alternativeName])",
    after: "JSON.stringify([statement.prefix, null])",
  },
  {
    name: "summary precedence",
    file: "packages/core/src/support.ts",
    before: "statement.flags.length === 0",
    after: "statement.flags.length > 0",
  },
  {
    name: "support state mapping",
    file: "packages/core/src/support.ts",
    before: 'statement.partialImplementation\n          ? "partial"\n          : "supported"',
    after: 'statement.partialImplementation\n          ? "supported"\n          : "supported"',
  },
  {
    name: "approximate-version boundary",
    file: "packages/core/src/version.ts",
    before: 'const approximate = raw.startsWith("≤");',
    after: "const approximate = false;",
  },
  {
    name: "child traversal",
    file: "packages/core/src/flatten.ts",
    before: "for (const [segment, child] of Object.entries(node)) {",
    after: "for (const [segment, child] of Object.entries({})) {",
  },
];

const copyFilter = (source) => {
  const normalized = `${source}${sep}`;
  return (
    !normalized.includes(`${sep}.git${sep}`) && !normalized.includes(`${sep}node_modules${sep}`)
  );
};

const runCoreTests = async (sandbox) => {
  const testReport = join(sandbox, "mutation-tests.json");
  const runtimeReport = join(sandbox, "mutation-runtime.json");
  await rm(testReport, { force: true });
  await rm(runtimeReport, { force: true });

  const result = spawnSync(
    process.execPath,
    [
      join(sandbox, "node_modules/vitest/vitest.mjs"),
      "run",
      "packages/core/tests",
      "--reporter=json",
      "--reporter=./packages/core/scripts/mutation-runtime-reporter.mjs",
      `--outputFile.json=${testReport}`,
    ],
    {
      cwd: sandbox,
      encoding: "utf8",
      env: { ...process.env, MUTATION_RUNTIME_REPORT: runtimeReport },
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
    },
  );

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.error || result.signal || result.status === null) {
    throw new Error(`Vitest did not exit normally.\n${output}`, { cause: result.error });
  }

  let tests;
  let runtime;
  try {
    tests = JSON.parse(await readFile(testReport, "utf8"));
    runtime = JSON.parse(await readFile(runtimeReport, "utf8"));
  } catch (error) {
    throw new Error(`Vitest did not produce both structured reports.\n${output}`, {
      cause: error,
    });
  }

  if (
    typeof tests.numTotalTests !== "number" ||
    tests.numTotalTests < 1 ||
    !Array.isArray(tests.testResults) ||
    tests.testResults.some(
      (file) =>
        typeof file.message !== "string" ||
        !Array.isArray(file.assertionResults) ||
        file.assertionResults.some(
          (assertion) =>
            typeof assertion.status !== "string" || !Array.isArray(assertion.failureMessages),
        ),
    ) ||
    typeof tests.numFailedTests !== "number" ||
    typeof tests.success !== "boolean" ||
    typeof runtime.unhandledErrors !== "number" ||
    typeof runtime.reason !== "string"
  ) {
    throw new Error(`Unexpected Vitest reporter shape.\n${output}`);
  }

  return { status: result.status, tests, runtime, output };
};

const assertCleanBaseline = ({ status, tests, runtime, output }) => {
  if (
    status !== 0 ||
    !tests.success ||
    tests.numFailedTests !== 0 ||
    tests.testResults.some((file) => file.status !== "passed") ||
    runtime.unhandledErrors !== 0 ||
    runtime.reason !== "passed"
  ) {
    throw new Error(`Mutation baseline failed before any mutant was applied.\n${output}`);
  }
};

const assertKilledByAssertion = (
  mutation,
  expectedTestCount,
  { status, tests, runtime, output },
) => {
  const failedAssertions = tests.testResults.flatMap((file) =>
    file.assertionResults.filter((assertion) => assertion.status === "failed"),
  );
  const assertionOnly =
    failedAssertions.length > 0 &&
    failedAssertions.every(
      (assertion) =>
        assertion.failureMessages.length > 0 &&
        assertion.failureMessages.every((message) => /\bAssertionError\b/.test(message)),
    );
  if (
    status !== 1 ||
    tests.success ||
    tests.numTotalTests !== expectedTestCount ||
    tests.numFailedTests !== failedAssertions.length ||
    !assertionOnly ||
    tests.testResults.some(
      (file) =>
        file.message !== "" ||
        (file.status === "failed" &&
          !file.assertionResults.some((assertion) => assertion.status === "failed")),
    ) ||
    runtime.unhandledErrors !== 0 ||
    runtime.reason !== "failed"
  ) {
    throw new Error(
      `Mutant '${mutation.name}' was not killed by test assertions alone.\n${output}`,
    );
  }
};

const sandbox = await mkdtemp(join(tmpdir(), "bcd-embed-mutation-"));
try {
  await cp(repository, sandbox, { recursive: true, filter: copyFilter });
  await symlink(join(repository, "node_modules"), join(sandbox, "node_modules"), "dir");
  await symlink(
    join(repository, "packages/core/node_modules"),
    join(sandbox, "packages/core/node_modules"),
    "dir",
  );
  await symlink(
    join(repository, "packages/schema/node_modules"),
    join(sandbox, "packages/schema/node_modules"),
    "dir",
  );

  const baseline = await runCoreTests(sandbox);
  assertCleanBaseline(baseline);
  console.log("Mutation baseline passed.");

  for (const mutation of mutationCases) {
    const target = join(sandbox, mutation.file);
    const original = await readFile(target, "utf8");
    if (original.split(mutation.before).length !== 2) {
      throw new Error(`Mutation anchor must occur exactly once: ${mutation.name}`);
    }

    try {
      await writeFile(target, original.replace(mutation.before, mutation.after));
      assertKilledByAssertion(mutation, baseline.tests.numTotalTests, await runCoreTests(sandbox));
      console.log(`Killed: ${mutation.name}`);
    } finally {
      await writeFile(target, original);
    }
  }

  assertCleanBaseline(await runCoreTests(sandbox));
  console.log("Post-mutation baseline passed.");
} finally {
  await rm(sandbox, { recursive: true, force: true });
}
