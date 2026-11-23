// k6 load test for the bcd-embed API (docs/planning/11-load-test.md). One generator, one IP
// address, 20 to 24 requests per second at most.
//
// There is no default host. Set BASE_URL, and CONFIRM_REMOTE=yes for any non-loopback host:
//
//   BASE_URL=http://127.0.0.1:8787 PROFILE=smoke k6 run load-test/load-test.js
//
// Every k6 name below comes from the k6 v2.4.0 documentation. The plan lists each page.
import { SharedArray } from "k6/data";
import { check } from "k6";
import exec from "k6/execution";
import http from "k6/http";
import { Counter, Rate } from "k6/metrics";

import { sameBytes } from "./lib/bytes.js";
import {
  classByIndex,
  MAX_REQUESTS_PER_SECOND,
  PHASE_RATES,
  PREFLIGHT,
  pickClass,
  SMOKE,
} from "./lib/mix.js";
import { resolveBaseUrl } from "./lib/target.js";

const BASE = resolveBaseUrl(__ENV.BASE_URL, __ENV.CONFIRM_REMOTE);
const PROFILE = __ENV.PROFILE || "smoke";
const STEADY_SECONDS = Number(__ENV.STEADY_SECONDS || 600);
const CEILING_SECONDS = Number(__ENV.CEILING_SECONDS || 300);
const RAMP_SECONDS = 60;

// Documented headers and policies (packages/server/README.md, Transport policy).
const CURRENT_CACHE = "max-age=86400, stale-while-revalidate=604800";
const PINNED_CACHE = "max-age=31536000, immutable";
// A cached 404 under /v1/current/ reaches clients with 14400 seconds instead of 3600 (issue #259).
// Both values are accepted for that one case until #259 is settled.
const CURRENT_404_CACHES = ["max-age=3600", "max-age=14400"];
const ORIGIN_HEADER = "https://example.org";

// Only 200, 204, 304 and 404 are expected answers, so http_req_failed counts everything else
// (429, 5xx, 406) as a failure.
http.setResponseCallback(http.expectedStatuses(200, 204, 304, 404));

const list = new SharedArray("keys", () => [JSON.parse(open("./keys.json"))])[0];
// Conditional requests revisit a few hot keys, as returning readers do, so 304s occur early. The
// hot keys are every sixth popular key, which spreads them over the namespaces (the popular list
// is sorted, so its first keys would all be `api.*`). The smoke profile uses one key so its 60
// iterations are certain to reach a 304.
const hotKeys =
  PROFILE === "smoke" ? [list.popular[0]] : list.popular.filter((_, index) => index % 6 === 0);

const scenarioFor = (rate, seconds, startTime) => ({
  executor: "constant-arrival-rate",
  rate,
  timeUnit: "1s",
  duration: `${seconds}s`,
  preAllocatedVUs: Math.max(2, Math.ceil(rate * 2)),
  // Three seconds of requests in flight at the cold-miss latency (about 1.5 s, Document 8) is
  // enough to sustain the rate. A larger pool would let k6 catch up on a long stall.
  maxVUs: Math.max(5, rate * 3),
  ...(startTime === undefined ? {} : { startTime: `${startTime}s` }),
});

const rampScenario = {
  executor: "ramping-arrival-rate",
  startRate: 1,
  timeUnit: "1s",
  stages: [{ target: PHASE_RATES.steady, duration: `${RAMP_SECONDS}s` }],
  preAllocatedVUs: 40,
  maxVUs: 60,
};

// `ramp`, `steady` and `ceiling` each run alone, so the plan can run them as separate k6
// processes. `full` runs them one after another in one process, which suits a local run.
const scenarios = {
  smoke: { smoke: scenarioFor(SMOKE.iterationsPerSecond, SMOKE.seconds) },
  preflight: { preflight: scenarioFor(PREFLIGHT.iterationsPerSecond, PREFLIGHT.seconds) },
  ramp: { ramp: rampScenario },
  steady: { steady: scenarioFor(PHASE_RATES.steady, STEADY_SECONDS) },
  ceiling: { ceiling: scenarioFor(PHASE_RATES.ceiling, CEILING_SECONDS) },
  full: {
    ramp: rampScenario,
    steady: scenarioFor(PHASE_RATES.steady, STEADY_SECONDS, RAMP_SECONDS),
    ceiling: scenarioFor(PHASE_RATES.ceiling, CEILING_SECONDS, RAMP_SECONDS + STEADY_SECONDS),
  },
};

if (scenarios[PROFILE] === undefined) {
  throw new Error(`PROFILE must be one of ${Object.keys(scenarios).join(", ")}.`);
}

// The statuses each class expects. Anything else counts toward `unexpected_status`, which stops
// the run, so a proxy answering 403 or a route that stops answering as documented ends the test.
const EXPECTED_STATUSES = {
  popular_br: [200],
  popular_gzip: [200],
  popular_identity: [200],
  sampled_br: [200],
  deep_br: [200],
  pinned_br: [200],
  raw_br: [200],
  conditional: [200, 304],
  meta: [200],
  browsers: [200],
  index: [200],
  missing: [404],
  grouping: [404],
  preflight: [204],
  compare: [200],
};

const classNames = Object.keys(EXPECTED_STATUSES);
// A threshold that always holds makes k6 list each class's sub-metric in the end-of-test summary.
const perClass = Object.fromEntries(
  classNames.map((name) => [`requests_by_class{class:${name}}`, ["count>=0"]]),
);

// The values of the cf-cache-status response header, plus "none" for responses without it.
const perCacheStatus = Object.fromEntries(
  ["HIT", "MISS", "EXPIRED", "STALE", "REVALIDATED", "DYNAMIC", "BYPASS", "none"].map((status) => [
    `cache_status_responses{status:${status}}`,
    ["count>=0"],
  ]),
);

export const options = {
  scenarios: scenarios[PROFILE],
  // Caps the whole process at 24 requests per second across all VUs. The arrival-rate executors set
  // the rate, but after a stall (a suspended laptop, a paused process) they start the missed
  // iterations at once, and only this cap holds the burst down. k6's documentation discourages
  // `rps`; the plan (section 3) says why it is used here anyway. The CLI flag --rps 24 repeats it.
  rps: MAX_REQUESTS_PER_SECOND,
  // Redirects would send hidden extra requests, so none are followed.
  maxRedirects: 0,
  thresholds: {
    // The stop condition: a 5xx rate above 1% stops the run, checked after the first 30 seconds.
    // k6 measures the whole run so far, not a trailing window, so a long clean run dilutes a late
    // outage. The plan therefore runs each phase as its own k6 process (see the plan, section 6).
    server_errors: [{ threshold: "rate<0.01", abortOnFail: true, delayAbortEval: "30s" }],
    transport_errors: [{ threshold: "rate<0.01", abortOnFail: true, delayAbortEval: "30s" }],
    // Any status a class does not expect (403 from a proxy, 406, a 200 where a 404 belongs).
    unexpected_status: [{ threshold: "rate<0.01", abortOnFail: true, delayAbortEval: "10s" }],
    // One 429 means the generator exceeded the zone's rule, so the run's data is no longer clean.
    rate_limited_responses: [{ threshold: "count<1", abortOnFail: true }],
    compare_mismatch: ["count<1"],
    conditional_not_304: ["count<1"],
    checks: ["rate>0.999"],
    http_req_duration: ["p(95)<1500", "med<1000"],
    ...perClass,
    ...perCacheStatus,
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

const serverErrors = new Rate("server_errors");
const transportErrors = new Rate("transport_errors");
const unexpectedStatus = new Rate("unexpected_status");
const rateLimited = new Counter("rate_limited_responses");
const requestsByClass = new Counter("requests_by_class");
const cacheStatus = new Counter("cache_status_responses");
const conditional304 = new Counter("conditional_304");
const conditionalSeed = new Counter("conditional_seed");
const conditionalNot304 = new Counter("conditional_not_304");
const compareOk = new Counter("compare_ok");
const compareMismatch = new Counter("compare_mismatch");
const cached404Long = new Counter("current_404_max_age_14400");

// State below lives in one virtual user, so it needs no locking.
const etags = new Map();

const pick = (items) => items[Math.floor(Math.random() * items.length)];

const header = (res, name) => {
  const wanted = name.toLowerCase();
  for (const key of Object.keys(res.headers)) {
    if (key.toLowerCase() === wanted) {
      const value = res.headers[key];
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
};

const params = (className, name, encoding, extra = {}) => ({
  headers: {
    "Accept-Encoding": encoding,
    Origin: ORIGIN_HEADER,
    ...extra.headers,
  },
  tags: { class: className, name },
  redirects: 0,
  timeout: "10s",
  responseType: extra.responseType ?? "text",
});

const record = (res, className) => {
  requestsByClass.add(1, { class: className });
  serverErrors.add(res.status >= 500);
  transportErrors.add(res.status === 0);
  unexpectedStatus.add(!EXPECTED_STATUSES[className].includes(res.status));
  if (res.status === 429) rateLimited.add(1);
  cacheStatus.add(1, { status: header(res, "cf-cache-status") ?? "none" });
};

const get = (path, className, name, encoding, extra) => {
  const res = http.get(`${BASE}${path}`, params(className, name, encoding, extra));
  record(res, className);
  return res;
};

const featurePath = (key, snapshot = "current", resource = "features") =>
  `/v1/${snapshot}/${resource}/${key}.json`;

const randomEncoding = () => {
  const r = Math.random();
  return r < 0.7 ? "br" : r < 0.9 ? "gzip" : "identity";
};

const isJson = (res) => (header(res, "content-type") ?? "").startsWith("application/json");
const encodingOf = (res) => header(res, "content-encoding") ?? "identity";
const isStrongEtag = (res) => /^"[0-9a-f]{64}"$/.test(header(res, "etag") ?? "");
const bodyJson = (res) => {
  try {
    return JSON.parse(res.body);
  } catch {
    return null;
  }
};

const checkFeature = (res, className, encoding, cache) =>
  check(
    res,
    {
      "feature: status 200": (r) => r.status === 200,
      "feature: JSON content type": isJson,
      "feature: strong ETag": isStrongEtag,
      "feature: snapshot header is the expected snapshot": (r) =>
        header(r, "bcd-embed-snapshot") === list.snapshot,
      "feature: cache policy as documented": (r) => header(r, "cache-control") === cache,
      "feature: CORS allows any origin": (r) => header(r, "access-control-allow-origin") === "*",
      "feature: encoding is the one requested": (r) => encodingOf(r) === encoding,
      "feature: body is not empty": (r) => r.body !== null && r.body.length > 0,
    },
    { class: className },
  );

const featureRequest = (className, key, encoding, { snapshot, resource } = {}) => {
  const cache = snapshot === undefined || snapshot === "current" ? CURRENT_CACHE : PINNED_CACHE;
  const res = get(
    featurePath(key, snapshot, resource),
    className,
    `${snapshot === undefined ? "current" : "pinned"}_${resource ?? "features"}`,
    encoding,
  );
  checkFeature(res, className, encoding, cache);
};

const conditionalRequest = () => {
  const key = pick(hotKeys);
  const path = featurePath(key);
  const known = etags.get(key);
  if (known === undefined) {
    // No tag yet in this virtual user: fetch the key once so later iterations can be conditional.
    const res = get(path, "conditional", "conditional_seed", "br");
    conditionalSeed.add(1);
    checkFeature(res, "conditional", "br", CURRENT_CACHE);
    const etag = header(res, "etag");
    if (res.status === 200 && etag !== undefined) etags.set(key, etag);
    return;
  }
  const res = get(path, "conditional", "conditional_revalidate", "br", {
    headers: { "If-None-Match": known },
  });
  if (res.status === 304) conditional304.add(1);
  else {
    conditionalNot304.add(1);
    etags.delete(key);
  }
  check(
    res,
    {
      "conditional: 304 for an unchanged tag": (r) => r.status === 304,
      "conditional: 304 carries the same ETag": (r) => header(r, "etag") === known,
      "conditional: 304 has no body": (r) => r.body === null || r.body.length === 0,
    },
    { class: "conditional" },
  );
};

const metaRequest = () => {
  const encoding = randomEncoding();
  const res = get("/v1/meta.json", "meta", "meta", encoding);
  check(
    res,
    {
      "meta: status 200": (r) => r.status === 200,
      "meta: JSON content type": isJson,
      "meta: strong ETag": isStrongEtag,
      "meta: cache policy as documented": (r) => header(r, "cache-control") === CURRENT_CACHE,
      "meta: encoding is the one requested": (r) => encodingOf(r) === encoding,
      "meta: names the expected snapshot and contract": (r) => {
        const body = bodyJson(r);
        return body !== null && body.current === list.snapshot && body.contract === list.contract;
      },
    },
    { class: "meta" },
  );
};

const structuralRequest = (className, path, name) => {
  const res = get(path, className, name, "br");
  check(
    res,
    {
      "structural: status 200": (r) => r.status === 200,
      "structural: JSON content type": isJson,
      "structural: cache policy as documented": (r) => header(r, "cache-control") === CURRENT_CACHE,
      "structural: snapshot header is the expected snapshot": (r) =>
        header(r, "bcd-embed-snapshot") === list.snapshot,
      "structural: encoding is br": (r) => encodingOf(r) === "br",
    },
    { class: className },
  );
};

const errorRequest = (className, key, code) => {
  const res = get(featurePath(key), className, "current_404", "br");
  if (header(res, "cache-control") === "max-age=14400") cached404Long.add(1);
  check(
    res,
    {
      "404: status 404": (r) => r.status === 404,
      "404: JSON content type": isJson,
      "404: cache policy is 3600 or, from the edge cache, 14400 (#259)": (r) =>
        CURRENT_404_CACHES.includes(header(r, "cache-control")),
      "404: error code as documented": (r) => {
        const body = bodyJson(r);
        return body !== null && body.error !== undefined && body.error.code === code;
      },
    },
    { class: className },
  );
};

const preflightRequest = () => {
  const key = pick(list.popular);
  const res = http.options(`${BASE}${featurePath(key)}`, null, {
    headers: {
      Origin: ORIGIN_HEADER,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "if-none-match",
    },
    tags: { class: "preflight", name: "preflight" },
    redirects: 0,
    timeout: "10s",
  });
  record(res, "preflight");
  check(
    res,
    {
      "preflight: status 204": (r) => r.status === 204,
      "preflight: allows GET, HEAD and OPTIONS": (r) => header(r, "allow") === "GET, HEAD, OPTIONS",
      "preflight: allows if-none-match": (r) =>
        (header(r, "access-control-allow-headers") ?? "").includes("if-none-match"),
    },
    { class: "preflight" },
  );
};

// Sends the same key twice, compressed and identity, and checks that k6's decoded body is the
// identity body byte for byte. The compressed request's Content-Encoding header proves that the
// server really sent a compressed body, so the comparison is not identity against identity.
const compareRequest = () => {
  const key = pick(list.popular);
  const encoding = Math.random() < 0.5 ? "br" : "gzip";
  const compressed = get(featurePath(key), "compare", "compare_compressed", encoding, {
    responseType: "binary",
  });
  const identity = get(featurePath(key), "compare", "compare_identity", "identity", {
    responseType: "binary",
  });
  const equal =
    compressed.status === 200 &&
    identity.status === 200 &&
    sameBytes(compressed.body, identity.body);
  if (equal) compareOk.add(1);
  else compareMismatch.add(1);
  check(
    { compressed, identity, equal },
    {
      "compare: both responses are 200": (r) =>
        r.compressed.status === 200 && r.identity.status === 200,
      "compare: the compressed response is really compressed": (r) =>
        encodingOf(r.compressed) === encoding,
      "compare: the identity response is not compressed": (r) =>
        encodingOf(r.identity) === "identity",
      "compare: the compressed body decodes to the identity bytes": (r) => r.equal,
    },
    { class: "compare" },
  );
};

const run = (className) => {
  switch (className) {
    case "popular_br":
      return featureRequest(className, pick(list.popular), "br");
    case "popular_gzip":
      return featureRequest(className, pick(list.popular), "gzip");
    case "popular_identity":
      return featureRequest(className, pick(list.popular), "identity");
    case "sampled_br":
      return featureRequest(className, pick(list.sampled), "br");
    case "deep_br":
      return featureRequest(className, pick(list.deep), "br");
    case "pinned_br":
      return featureRequest(
        className,
        Math.random() < 0.6 ? pick(list.popular) : pick(list.sampled),
        "br",
        { snapshot: list.snapshot },
      );
    case "raw_br":
      return featureRequest(className, pick(list.popular), "br", { resource: "raw" });
    case "conditional":
      return conditionalRequest();
    case "meta":
      return metaRequest();
    case "browsers":
      return structuralRequest(className, "/v1/current/browsers.json", "browsers");
    case "index": {
      const whole = Math.random() < 0.05;
      return structuralRequest(
        className,
        whole ? "/v1/current/index.json" : `/v1/current/index/${pick(list.namespaces)}.json`,
        whole ? "index" : "index_namespace",
      );
    }
    case "missing":
      return errorRequest(className, pick(list.missing), "feature_not_found");
    case "grouping":
      return errorRequest(className, pick(list.grouping), "namespace_not_queryable");
    case "preflight":
      return preflightRequest();
    case "compare":
      return compareRequest();
    default:
      throw new Error(`Unknown request class ${className}`);
  }
};

export default function () {
  // The smoke profile walks the classes in order so 60 iterations cover each one four times.
  const className =
    PROFILE === "smoke" ? classByIndex(exec.scenario.iterationInTest) : pickClass(Math.random());
  run(className);
}

// Runs once, so the target is printed once and not once per virtual user.
export function setup() {
  console.log(
    `Target: ${BASE}, profile ${PROFILE}, at most ${MAX_REQUESTS_PER_SECOND} requests per second.`,
  );
}
