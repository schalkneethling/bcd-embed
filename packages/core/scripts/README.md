# Mutation gate

Run `pnpm --filter @bcd-embed/core test:mutation` after installing workspace dependencies. The gate first requires a clean core test baseline, then makes five deliberate faults in grouping identity, summary precedence, state mapping, approximate versions, and child traversal. Each fault runs in an isolated source state and must cause assertion failures with zero unhandled runtime errors; a final clean baseline checks restoration.

This is a targeted check that key tests detect those faults, not an exhaustive mutation score.
