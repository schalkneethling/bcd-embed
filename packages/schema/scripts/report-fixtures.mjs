import { parseArgs } from "node:util";

import { bcdSourceFixtures, v1FixtureCases, v1NormalizedFixture } from "../src/fixtures/v1.ts";
import { createFixtureReport, formatFixtureReport } from "./lib/fixture-report.mjs";

const usage = `Usage: pnpm fixtures:report [--json]

Summarize the published v1 golden fixture corpus and its named edge cases.`;

const { values } = parseArgs({
  options: {
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
  strict: true,
});

if (values.help) {
  console.log(usage);
} else {
  const report = createFixtureReport({
    normalized: v1NormalizedFixture,
    cases: v1FixtureCases,
    source: bcdSourceFixtures,
  });

  console.log(
    values.json ? JSON.stringify(report, null, 2) : formatFixtureReport(report).trimEnd(),
  );
}
