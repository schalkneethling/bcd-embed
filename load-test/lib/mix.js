// The request mix and the rate plan of the load test (docs/planning/11-load-test.md).
//
// This file is plain ES module code with no Node or k6 imports, so the k6 script and the unit
// tests in tests/load-test.test.ts both load it.

/**
 * One kind of request. `weight` is its share of iterations in percent, and `requests` is how many
 * HTTP requests one iteration of that class sends. Only the `compare` class sends two.
 */
export const REQUEST_CLASSES = [
  { name: "popular_br", weight: 32, requests: 1 },
  { name: "popular_gzip", weight: 8, requests: 1 },
  { name: "popular_identity", weight: 2, requests: 1 },
  { name: "sampled_br", weight: 15, requests: 1 },
  { name: "deep_br", weight: 5, requests: 1 },
  { name: "pinned_br", weight: 10, requests: 1 },
  { name: "raw_br", weight: 2, requests: 1 },
  { name: "conditional", weight: 10, requests: 1 },
  { name: "meta", weight: 3, requests: 1 },
  { name: "browsers", weight: 3, requests: 1 },
  { name: "index", weight: 1, requests: 1 },
  { name: "missing", weight: 4, requests: 1 },
  { name: "grouping", weight: 1, requests: 1 },
  { name: "preflight", weight: 2, requests: 1 },
  { name: "compare", weight: 2, requests: 2 },
];

/** The rule blocks one IP address above this many requests in `RULE_PERIOD_SECONDS`. */
export const RULE_LIMIT = 300;
export const RULE_PERIOD_SECONDS = 10;
/** The plan keeps one generator between these request rates (the issue's 20 to 24 per second). */
export const MIN_REQUESTS_PER_SECOND = 20;
export const MAX_REQUESTS_PER_SECOND = 24;

/** Iterations per second in each phase. The `ramp` phase climbs from 1 to the `steady` rate. */
export const PHASE_RATES = { steady: 20, ceiling: 22 };

/** The preflight's rate and length, and the issue's bound on its total requests. */
export const PREFLIGHT = { iterationsPerSecond: 5, seconds: 60, maxRequests: 1000 };

/** The production smoke run: one iteration per second for 60 seconds. */
export const SMOKE = { iterationsPerSecond: 1, seconds: 60 };

/** Sum of the weights. The table must add up to 100 so that each weight reads as a percentage. */
export const totalWeight = () => REQUEST_CLASSES.reduce((sum, item) => sum + item.weight, 0);

/** Average requests per iteration over the whole mix. */
export const meanRequestsPerIteration = () =>
  REQUEST_CLASSES.reduce((sum, item) => sum + item.weight * item.requests, 0) / totalWeight();

/** The long-run request rate that `iterationsPerSecond` iterations produce. */
export const expectedRequestsPerSecond = (iterationsPerSecond) =>
  iterationsPerSecond * meanRequestsPerIteration();

/**
 * Picks a class from `random`, a number in [0, 1). One pass over a table of 15 entries, so O(C)
 * time and O(1) space for C classes, and no allocation on the request path.
 */
export const pickClass = (random) => {
  const target = random * totalWeight();
  let cumulative = 0;
  for (const item of REQUEST_CLASSES) {
    cumulative += item.weight;
    if (target < cumulative) return item.name;
  }
  return REQUEST_CLASSES[REQUEST_CLASSES.length - 1].name;
};

/** Cycles through every class in table order, so a short run exercises each one. */
export const classByIndex = (iteration) => REQUEST_CLASSES[iteration % REQUEST_CLASSES.length].name;

/** The request count of the preflight if every iteration were a two-request `compare`. */
export const preflightWorstCaseRequests = () =>
  PREFLIGHT.iterationsPerSecond *
  PREFLIGHT.seconds *
  Math.max(...REQUEST_CLASSES.map((item) => item.requests));
