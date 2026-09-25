import { writeFileSync } from "node:fs";

/** Capture Vitest run-level errors omitted from its built-in JSON reporter. */
export default class MutationRuntimeReporter {
  onTestRunEnd(_modules, unhandledErrors, reason) {
    const report = process.env.MUTATION_RUNTIME_REPORT;
    if (!report) throw new Error("MUTATION_RUNTIME_REPORT must identify the report file.");
    writeFileSync(report, JSON.stringify({ unhandledErrors: unhandledErrors.length, reason }));
  }
}
