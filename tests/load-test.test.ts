import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { featureKeySchema } from "@bcd-embed/schema";
import { describe, expect, it } from "vitest";

import { sameBytes } from "../load-test/lib/bytes.js";
import {
  allListedKeys,
  buildKeyList,
  isPublicFeatureKey,
  POPULAR_CANDIDATES,
} from "../load-test/lib/key-list.mjs";
import {
  classByIndex,
  expectedRequestsPerSecond,
  MAX_REQUESTS_PER_SECOND,
  meanRequestsPerIteration,
  MIN_REQUESTS_PER_SECOND,
  PHASE_RATES,
  pickClass,
  PREFLIGHT,
  preflightWorstCaseRequests,
  REQUEST_CLASSES,
  RULE_LIMIT,
  RULE_PERIOD_SECONDS,
  SMOKE,
  totalWeight,
} from "../load-test/lib/mix.js";
import { resolveBaseUrl } from "../load-test/lib/target.js";

const readText = (path: string): string =>
  readFileSync(new URL(`../load-test/${path}`, import.meta.url), "utf8");

type KeyList = ReturnType<typeof buildKeyList>;
const committed = JSON.parse(readText("keys.json")) as KeyList;

describe("the request mix", () => {
  it("adds up to 100 percent so each weight reads as a share", () => {
    expect(totalWeight()).toBe(100);
  });

  it("names each class once", () => {
    const names = REQUEST_CLASSES.map((item) => item.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("sends 1.02 requests per iteration, because only the compare class sends two", () => {
    expect(meanRequestsPerIteration()).toBeCloseTo(1.02, 10);
  });

  it("picks classes in proportion to their weights", () => {
    const counts = new Map<string, number>();
    const samples = 100_000;
    for (let index = 0; index < samples; index += 1) {
      const name = pickClass((index + 0.5) / samples);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    for (const item of REQUEST_CLASSES) {
      expect(counts.get(item.name)).toBe(item.weight * (samples / 100));
    }
  });

  it("returns the last class for a random value of nearly 1", () => {
    expect(pickClass(0.999999)).toBe(REQUEST_CLASSES.at(-1)?.name);
  });

  it("cycles through every class so a short run covers each one", () => {
    const seen = new Set(REQUEST_CLASSES.map((_, index) => classByIndex(index)));
    expect(seen.size).toBe(REQUEST_CLASSES.length);
    expect(classByIndex(REQUEST_CLASSES.length)).toBe(classByIndex(0));
  });
});

const PHASE_RATES_VALUES = Object.values(PHASE_RATES);

describe("the rate plan", () => {
  it.each(Object.entries(PHASE_RATES))(
    "keeps the %s phase between 20 and 24 requests per second",
    (_phase, iterations) => {
      const rate = expectedRequestsPerSecond(iterations);
      expect(rate).toBeGreaterThanOrEqual(MIN_REQUESTS_PER_SECOND);
      expect(rate).toBeLessThanOrEqual(MAX_REQUESTS_PER_SECOND);
    },
  );

  it("keeps the highest phase at least 20 percent under the rule's 30 per second", () => {
    const ruleRate = RULE_LIMIT / RULE_PERIOD_SECONDS;
    const highest = expectedRequestsPerSecond(Math.max(...Object.values(PHASE_RATES)));
    expect(highest).toBeLessThanOrEqual(ruleRate * 0.8);
  });

  it("needs a compare share at least ten times its weight to reach the rule's limit in 10 seconds", () => {
    // 220 iterations in 10 seconds send 220 requests. Each extra compare adds one more, so 80 of
    // the 220 (36 percent) must be compares to reach 300. The mix sends 2 percent.
    const iterations = Math.max(...PHASE_RATES_VALUES) * RULE_PERIOD_SECONDS;
    const comparesNeeded = RULE_LIMIT - iterations;
    const compareWeight = REQUEST_CLASSES.find((item) => item.name === "compare")?.weight ?? 0;
    expect(comparesNeeded / iterations).toBeGreaterThanOrEqual((compareWeight / 100) * 10);
  });

  it("sends fewer than 1,000 requests in the preflight, even in the worst case", () => {
    expect(preflightWorstCaseRequests()).toBeLessThan(PREFLIGHT.maxRequests);
    expect(
      PREFLIGHT.iterationsPerSecond * PREFLIGHT.seconds * meanRequestsPerIteration(),
    ).toBeLessThan(PREFLIGHT.maxRequests);
  });

  it("keeps the production smoke run at one iteration per second for 60 seconds", () => {
    expect(SMOKE).toEqual({ iterationsPerSecond: 1, seconds: 60 });
  });
});

describe("the compressed-versus-identity comparison", () => {
  it("accepts two buffers with the same bytes", () => {
    expect(sameBytes(new Uint8Array([1, 2, 3]).buffer, new Uint8Array([1, 2, 3]).buffer)).toBe(
      true,
    );
  });

  it("rejects one differing byte", () => {
    expect(sameBytes(new Uint8Array([1, 2, 3]).buffer, new Uint8Array([1, 2, 4]).buffer)).toBe(
      false,
    );
  });

  it("rejects different lengths", () => {
    expect(sameBytes(new Uint8Array([1, 2]).buffer, new Uint8Array([1, 2, 3]).buffer)).toBe(false);
  });

  it("accepts two empty buffers", () => {
    expect(sameBytes(new ArrayBuffer(0), new ArrayBuffer(0))).toBe(true);
  });
});

describe("the base URL guard", () => {
  it("has no default host", () => {
    expect(() => resolveBaseUrl(undefined, undefined)).toThrow("BASE_URL is required");
    expect(() => resolveBaseUrl("", undefined)).toThrow("BASE_URL is required");
  });

  it("accepts loopback origins without confirmation and drops a trailing slash", () => {
    expect(resolveBaseUrl("http://127.0.0.1:8787/", undefined)).toBe("http://127.0.0.1:8787");
    expect(resolveBaseUrl("http://localhost:8787", undefined)).toBe("http://localhost:8787");
    expect(resolveBaseUrl("http://[::1]:8787", undefined)).toBe("http://[::1]:8787");
  });

  it("refuses a remote host unless CONFIRM_REMOTE is yes", () => {
    expect(() => resolveBaseUrl("https://api.browser-compat.dev", undefined)).toThrow(
      "CONFIRM_REMOTE=yes",
    );
    expect(() => resolveBaseUrl("https://api.browser-compat.dev", "true")).toThrow(
      "CONFIRM_REMOTE=yes",
    );
    expect(resolveBaseUrl("https://api.browser-compat.dev", "yes")).toBe(
      "https://api.browser-compat.dev",
    );
  });

  it("refuses a host that only starts like a loopback address", () => {
    expect(() => resolveBaseUrl("http://127.0.0.1.example.com", undefined)).toThrow(
      "not a loopback",
    );
    expect(() => resolveBaseUrl("http://localhost.example.com", undefined)).toThrow(
      "not a loopback",
    );
  });

  it("refuses a path, query or fragment", () => {
    expect(() => resolveBaseUrl("http://127.0.0.1/v1", undefined)).toThrow("origin");
    expect(() => resolveBaseUrl("http://127.0.0.1?x=1", undefined)).toThrow("origin");
  });
});

describe("the key list builder", () => {
  const indexKeys = [
    ...POPULAR_CANDIDATES,
    ...Array.from({ length: 300 }, (_, index) => `css.properties.p${index}.a.b.c`),
    "css.properties.p0.a.b.c.d",
  ];
  const input = {
    indexKeys,
    namespaces: ["api", "css", "html"],
    snapshot: "bcd-0.0.0-gen-0.0.0",
    sourceVersion: "0.0.0",
    contract: "1.1.0",
    sampledCount: 50,
    deepCount: 10,
  };

  it("is deterministic, so a rerun writes the same file", () => {
    expect(buildKeyList(input)).toEqual(buildKeyList(input));
  });

  it("fails loudly when a popular candidate is not in the index", () => {
    expect(() => buildKeyList({ ...input, indexKeys: indexKeys.slice(1) })).toThrow(
      /Popular candidates missing from the index: api\.AbortController/,
    );
  });

  it("draws sampled and deep keys from the index only", () => {
    const list = buildKeyList(input);
    const known = new Set(indexKeys);
    for (const key of [...list.popular, ...list.sampled, ...list.deep]) {
      expect(known.has(key)).toBe(true);
    }
    expect(list.deep.every((key) => key.split(".").length >= 6)).toBe(true);
    expect(list.sampled.length).toBeLessThanOrEqual(50);
  });

  it("makes missing keys that are not in the index, and grouping keys that are only prefixes", () => {
    const list = buildKeyList(input);
    const known = new Set(indexKeys);
    expect(list.missing.length).toBeGreaterThan(0);
    for (const key of list.missing) expect(known.has(key)).toBe(false);
    expect(list.grouping).toContain("css.properties");
    for (const key of list.grouping) {
      expect(known.has(key)).toBe(false);
      expect(indexKeys.some((candidate) => candidate.startsWith(`${key}.`))).toBe(true);
    }
  });
});

/** Every dotted path in BCD that carries `__compat`, which is the contract's addressability rule. */
const addressableKeys = (): Set<string> => {
  const require = createRequire(new URL("../apps/worker/package.json", import.meta.url));
  const bcd = require("@mdn/browser-compat-data") as Record<string, unknown>;
  const keys = new Set<string>();
  const walk = (node: Record<string, unknown>, path: string): void => {
    if (path !== "" && "__compat" in node) keys.add(path);
    for (const [name, child] of Object.entries(node)) {
      if (name === "__compat" || name === "__meta" || name === "browsers") continue;
      if (typeof child === "object" && child !== null) {
        walk(child as Record<string, unknown>, path === "" ? name : `${path}.${name}`);
      }
    }
  };
  walk(bcd, "");
  return keys;
};

describe("the committed key list (load-test/keys.json)", () => {
  it("holds only public feature keys that satisfy the contract's key schema", () => {
    const keys = allListedKeys(committed).filter(
      (key) => !committed.missing.includes(key) && !committed.grouping.includes(key),
    );
    expect(keys.length).toBeGreaterThan(1000);
    for (const key of keys) {
      expect(isPublicFeatureKey(key)).toBe(true);
      expect(featureKeySchema.safeParse(key).success).toBe(true);
    }
  });

  it("draws every popular, deep and sampled key from BCD at the snapshot's source version", () => {
    const known = addressableKeys();
    for (const key of [...committed.popular, ...committed.deep, ...committed.sampled]) {
      expect(known.has(key), key).toBe(true);
    }
  });

  it("holds no missing or grouping key that BCD addresses", () => {
    const known = addressableKeys();
    for (const key of [...committed.missing, ...committed.grouping]) {
      expect(known.has(key), key).toBe(false);
    }
  });

  it("names the snapshot that the live Worker serves for contract 1.1.0", () => {
    expect(committed.snapshot).toBe("bcd-8.1.9-gen-0.1.0");
    expect(committed.contract).toBe("1.1.0");
  });
});

describe("the k6 script", () => {
  const script = readText("load-test.js");

  it("contains no credential, token or authorization header (keys.json is checked by its grammar)", () => {
    for (const file of ["load-test.js", "lib/mix.js", "lib/bytes.js", "lib/target.js"]) {
      expect(readText(file)).not.toMatch(/bearer|authorization|api[_-]?key|secret|token|password/i);
    }
  });

  it("stops the run when the 5xx rate passes 1 percent, after a 30 second delay", () => {
    expect(script).toMatch(
      /server_errors: \[\{ threshold: "rate<0\.01", abortOnFail: true, delayAbortEval: "30s" \}\]/,
    );
  });

  it("stops the run on the first 429, which means the generator exceeded the rule", () => {
    expect(script).toMatch(
      /rate_limited_responses: \[\{ threshold: "count<1", abortOnFail: true \}\]/,
    );
  });

  it("counts 304 responses in their own metric and fails on a conditional that returns 200", () => {
    expect(script).toContain('new Counter("conditional_304")');
    expect(script).toContain('conditional_not_304: ["count<1"]');
  });

  it("fails on any compressed body that differs from the identity body", () => {
    expect(script).toContain("sameBytes(compressed.body, identity.body)");
    expect(script).toContain('compare_mismatch: ["count<1"]');
  });

  it("follows no redirects, so no request is sent that the plan did not count", () => {
    expect(script).toContain("maxRedirects: 0");
    expect(script).toContain("redirects: 0");
  });

  it("reads its target from BASE_URL through the guard", () => {
    expect(script).toContain("resolveBaseUrl(__ENV.BASE_URL, __ENV.CONFIRM_REMOTE)");
    expect(script).not.toMatch(/https?:\/\/(?!example\.org)[a-z0-9.-]+\.[a-z]{2,}/i);
  });
});
