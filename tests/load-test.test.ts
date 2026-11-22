import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";

import { featureKeySchema } from "@bcd-embed/schema";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sameBytes } from "../load-test/lib/bytes.js";
import {
  allListedKeys,
  buildKeyList,
  isPublicFeatureKey,
  POPULAR_CANDIDATES,
} from "../load-test/lib/key-list.mjs";
import {
  classByIndex,
  meanRequestsPerIteration,
  MAX_REQUESTS_PER_SECOND,
  MIN_REQUESTS_PER_SECOND,
  pickClass,
  REQUEST_CLASSES,
} from "../load-test/lib/mix.js";
import { resolveBaseUrl } from "../load-test/lib/target.js";

const readText = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

type KeyList = ReturnType<typeof buildKeyList>;
const committed = JSON.parse(readText("load-test/keys.json")) as KeyList;

// ---- Loading the k6 script with stubbed k6 modules --------------------------------------------

type Threshold = { threshold: string; abortOnFail?: boolean; delayAbortEval?: string };
type Scenario = {
  executor: string;
  rate?: number;
  startRate?: number;
  stages?: { target: number; duration: string }[];
  duration?: string;
  startTime?: string;
  preAllocatedVUs: number;
  maxVUs: number;
};
type ScriptOptions = {
  rps: number;
  maxRedirects: number;
  scenarios: Record<string, Scenario>;
  thresholds: Record<string, (string | Threshold)[]>;
};

vi.mock("k6/http", () => ({
  default: {
    setResponseCallback: () => undefined,
    expectedStatuses: () => undefined,
    get: () => undefined,
    options: () => undefined,
  },
}));
vi.mock("k6", () => ({ check: () => true }));
vi.mock("k6/data", () => ({
  SharedArray: class {
    constructor(_name: string, build: () => unknown[]) {
      return build();
    }
  },
}));
vi.mock("k6/execution", () => ({ default: { scenario: { iterationInTest: 0 } } }));
vi.mock("k6/metrics", () => ({
  Counter: class {
    add() {}
  },
  Rate: class {
    add() {}
  },
}));

const loadScript = async (env: Record<string, string>): Promise<ScriptOptions> => {
  vi.resetModules();
  vi.stubGlobal("__ENV", env);
  vi.stubGlobal("open", (path: string) => readText(`load-test/${path.replace("./", "")}`));
  const module = (await import("../load-test/load-test.js")) as { options: ScriptOptions };
  return module.options;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

const LOCAL = { BASE_URL: "http://127.0.0.1:8787" };
const PROFILES = ["smoke", "preflight", "ramp", "steady", "ceiling", "full"] as const;

const requestsPerSecond = (iterations: number): number => iterations * meanRequestsPerIteration();

describe("the k6 script's options", () => {
  it("caps the process at 24 requests per second or less", async () => {
    for (const profile of PROFILES) {
      const options = await loadScript({ ...LOCAL, PROFILE: profile });
      expect(options.rps, profile).toBeGreaterThan(0);
      expect(options.rps, profile).toBeLessThanOrEqual(24);
    }
  });

  it("keeps every scenario's request rate at or below the cap", async () => {
    for (const profile of PROFILES) {
      const options = await loadScript({ ...LOCAL, PROFILE: profile });
      for (const [name, scenario] of Object.entries(options.scenarios)) {
        const peak =
          scenario.executor === "ramping-arrival-rate"
            ? Math.max(...(scenario.stages ?? []).map((stage) => stage.target))
            : (scenario.rate ?? 0);
        expect(requestsPerSecond(peak), `${profile}/${name}`).toBeLessThanOrEqual(options.rps);
      }
    }
  });

  it("holds the steady and ceiling phases between 20 and 24 requests per second", async () => {
    const steady = (await loadScript({ ...LOCAL, PROFILE: "steady" })).scenarios.steady!;
    const ceiling = (await loadScript({ ...LOCAL, PROFILE: "ceiling" })).scenarios.ceiling!;
    for (const scenario of [steady, ceiling]) {
      expect(scenario.executor).toBe("constant-arrival-rate");
      expect(requestsPerSecond(scenario.rate ?? 0)).toBeGreaterThanOrEqual(MIN_REQUESTS_PER_SECOND);
      expect(requestsPerSecond(scenario.rate ?? 0)).toBeLessThanOrEqual(MAX_REQUESTS_PER_SECOND);
    }
  });

  it("sends fewer than 1,000 requests in the preflight even if every iteration were a compare", async () => {
    const scenario = (await loadScript({ ...LOCAL, PROFILE: "preflight" })).scenarios.preflight!;
    const seconds = Number.parseInt(scenario.duration ?? "0", 10);
    const worst =
      (scenario.rate ?? 0) * seconds * Math.max(...REQUEST_CLASSES.map((c) => c.requests));
    expect(worst).toBeLessThan(1000);
  });

  it("runs the smoke profile at one iteration per second for 60 seconds", async () => {
    const scenario = (await loadScript({ ...LOCAL, PROFILE: "smoke" })).scenarios.smoke!;
    expect(scenario.rate).toBe(1);
    expect(scenario.duration).toBe("60s");
  });

  it("limits the pool of VUs to three seconds of requests so a stall cannot be caught up", async () => {
    for (const profile of ["steady", "ceiling"] as const) {
      const scenario = (await loadScript({ ...LOCAL, PROFILE: profile })).scenarios[profile]!;
      expect(scenario.maxVUs).toBeLessThanOrEqual((scenario.rate ?? 0) * 3);
      expect(scenario.maxVUs).toBeGreaterThanOrEqual(scenario.preAllocatedVUs);
    }
  });

  it("follows no redirects", async () => {
    expect((await loadScript({ ...LOCAL })).maxRedirects).toBe(0);
  });

  it("stops the run on a 5xx or transport error rate above 1% after 30 seconds", async () => {
    const { thresholds } = await loadScript({ ...LOCAL });
    for (const metric of ["server_errors", "transport_errors"]) {
      expect(thresholds[metric]).toEqual([
        { threshold: "rate<0.01", abortOnFail: true, delayAbortEval: "30s" },
      ]);
    }
  });

  it("stops the run on an unexpected status after about 10 seconds", async () => {
    const { thresholds } = await loadScript({ ...LOCAL });
    expect(thresholds.unexpected_status).toEqual([
      { threshold: "rate<0.01", abortOnFail: true, delayAbortEval: "10s" },
    ]);
  });

  it("stops the run on the first 429", async () => {
    const { thresholds } = await loadScript({ ...LOCAL });
    expect(thresholds.rate_limited_responses).toEqual([
      { threshold: "count<1", abortOnFail: true },
    ]);
  });

  it("fails on a compare mismatch or a conditional that did not give a 304", async () => {
    const { thresholds } = await loadScript({ ...LOCAL });
    expect(thresholds.compare_mismatch).toEqual(["count<1"]);
    expect(thresholds.conditional_not_304).toEqual(["count<1"]);
  });

  it("refuses to load against a remote host without the exact host in CONFIRM_REMOTE", async () => {
    const remote = { BASE_URL: "https://api.browser-compat.dev", PROFILE: "smoke" };
    await expect(loadScript(remote)).rejects.toThrow("CONFIRM_REMOTE=api.browser-compat.dev");
    await expect(loadScript({ ...remote, CONFIRM_REMOTE: "yes" })).rejects.toThrow(
      "CONFIRM_REMOTE=api.browser-compat.dev",
    );
    await expect(
      loadScript({ ...remote, CONFIRM_REMOTE: "api.browser-compat.dev" }),
    ).resolves.toBeDefined();
  });

  it("rejects an unknown profile", async () => {
    await expect(loadScript({ ...LOCAL, PROFILE: "nope" })).rejects.toThrow(
      "PROFILE must be one of",
    );
  });
});

describe("the documented k6 commands", () => {
  /** Joins backslash continuations, then returns every line that runs k6. */
  const k6Commands = (path: string): string[] => {
    let inFence = false;
    const lines: string[] = [];
    for (const line of readText(path)
      .replace(/\\\n\s*/g, " ")
      .split("\n")) {
      if (line.trimStart().startsWith("```")) inFence = !inFence;
      else if (inFence && /\bk6 run\b/.test(line)) lines.push(line);
    }
    return lines;
  };

  const documents = ["load-test/README.md", "docs/planning/11-load-test.md"];

  it.each(documents)("%s has k6 commands", (path) => {
    expect(k6Commands(path).length).toBeGreaterThan(0);
  });

  it.each(documents)("every k6 run in %s disables usage reports and caps the rate", (path) => {
    for (const command of k6Commands(path)) {
      expect(command, command).toContain("--no-usage-report");
      expect(command, command).toContain("--rps 24");
    }
  });

  it.each(documents)(
    "every remote k6 run in %s names the exact host and sets no shared variable",
    (path) => {
      const text = readText(path);
      expect(text).not.toMatch(/^\s*export (BASE_URL|CONFIRM_REMOTE)/m);
      expect(text).not.toContain("CONFIRM_REMOTE=yes");
      for (const command of k6Commands(path).filter((line) => line.includes("https://"))) {
        expect(command, command).toContain("CONFIRM_REMOTE=api.browser-compat.dev");
        expect(command, command).toContain("BASE_URL=https://api.browser-compat.dev");
      }
    },
  );

  it.each(documents)("%s writes summaries under load-test/results/", (path) => {
    for (const command of k6Commands(path).filter((line) => line.includes("--summary-export"))) {
      expect(command, command).toMatch(/--summary-export load-test\/results\//);
    }
  });

  it("git-ignores the results folder", () => {
    expect(readText("load-test/.gitignore")).toMatch(/^results\/$/m);
  });
});

// ---- Non-k6 modules ---------------------------------------------------------------------------

describe("the request mix", () => {
  it("names each class once", () => {
    const names = REQUEST_CLASSES.map((item) => item.name);
    expect(new Set(names).size).toBe(names.length);
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

describe("the compressed-versus-identity comparison", () => {
  const bytes = (...values: number[]): ArrayBuffer => new Uint8Array(values).buffer;

  it("accepts two buffers with the same bytes", () => {
    expect(sameBytes(bytes(1, 2, 3), bytes(1, 2, 3))).toBe(true);
  });

  it("rejects one differing byte", () => {
    expect(sameBytes(bytes(1, 2, 3), bytes(1, 2, 4))).toBe(false);
  });

  it("rejects different lengths", () => {
    expect(sameBytes(bytes(1, 2), bytes(1, 2, 3))).toBe(false);
  });

  it("accepts two empty buffers", () => {
    expect(sameBytes(new ArrayBuffer(0), new ArrayBuffer(0))).toBe(true);
  });

  it("rejects a null body on either side, so a 200 without a body cannot pass", () => {
    expect(sameBytes(null, bytes(1))).toBe(false);
    expect(sameBytes(bytes(1), null)).toBe(false);
    expect(sameBytes(null, null)).toBe(false);
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

  it("allows a remote host only when CONFIRM_REMOTE is that exact host name", () => {
    const url = "https://api.browser-compat.dev";
    expect(() => resolveBaseUrl(url, undefined)).toThrow("CONFIRM_REMOTE=api.browser-compat.dev");
    expect(() => resolveBaseUrl(url, "yes")).toThrow("CONFIRM_REMOTE=api.browser-compat.dev");
    expect(() => resolveBaseUrl(url, "example.org")).toThrow(
      "CONFIRM_REMOTE=api.browser-compat.dev",
    );
    expect(resolveBaseUrl(url, "api.browser-compat.dev")).toBe(url);
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
    ...Array.from({ length: 2500 }, (_, index) => `css.properties.p${index}.a.b.c`),
    ...Array.from({ length: 30 }, (_, index) => `webextensions.manifest.k${index}.a.b.c`),
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

  it("samples all the way to the end of the sorted keys", () => {
    const list = buildKeyList(input);
    const sorted = [...new Set(indexKeys)].sort();
    const lastSampled = sorted.indexOf(list.sampled.at(-1) as string);
    expect(lastSampled).toBeGreaterThan(sorted.length - Math.ceil(sorted.length / 50) - 1);
  });

  it("spreads deep keys over namespaces and does not let the largest one fill the group", () => {
    const list = buildKeyList({ ...input, deepCount: 20 });
    const css = list.deep.filter((key) => key.startsWith("css.")).length;
    const extensions = list.deep.filter((key) => key.startsWith("webextensions.")).length;
    expect(css).toBe(10);
    expect(extensions).toBe(10);
  });

  it("gives all of a small namespace's deep keys and the rest to the others", () => {
    const list = buildKeyList({ ...input, deepCount: 100 });
    expect(list.deep.filter((key) => key.startsWith("webextensions.")).length).toBe(30);
    expect(list.deep.filter((key) => key.startsWith("css.")).length).toBe(70);
    expect(new Set(list.deep).size).toBe(100);
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

  it("samples the whole index, so the last sampled key is near the end of the alphabet", () => {
    expect(committed.sampled.length).toBeGreaterThanOrEqual(990);
    expect(committed.sampled.at(-1)?.startsWith("webextensions.")).toBe(true);
  });

  it("holds hot-key candidates (every sixth popular key) from more than one namespace", () => {
    const namespaces = new Set(
      committed.popular.filter((_, index) => index % 6 === 0).map((key) => key.split(".")[0]),
    );
    expect(namespaces.size).toBeGreaterThan(3);
  });

  it("has no deep namespace above a third of the deep keys", () => {
    const counts = new Map<string, number>();
    for (const key of committed.deep) {
      const namespace = key.split(".")[0] as string;
      counts.set(namespace, (counts.get(namespace) ?? 0) + 1);
    }
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(committed.deep.length / 3);
  });
});

describe("credentials", () => {
  it("are absent from the script and its libraries (keys.json is checked by its grammar)", () => {
    for (const file of [
      "load-test/load-test.js",
      "load-test/lib/mix.js",
      "load-test/lib/bytes.js",
      "load-test/lib/target.js",
    ]) {
      expect(readText(file)).not.toMatch(/bearer|authorization|api[_-]?key|secret|token|password/i);
    }
  });
});

// ---- Running k6 itself, when it is installed ---------------------------------------------------

const hasK6 = spawnSync("k6", ["version"], { stdio: "ignore" }).status === 0;

/** A server that answers every request with one status. */
const stubServer = async (status: number): Promise<{ server: Server; origin: string }> => {
  const server = createServer((_request, response) => {
    response.statusCode = status;
    response.end("blocked");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, origin: `http://127.0.0.1:${port}` };
};

const runK6 = (origin: string): Promise<{ code: number | null; seconds: number; output: string }> =>
  new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(
      "k6",
      ["run", "--quiet", "--no-usage-report", "--rps", "24", "load-test/load-test.js"],
      {
        cwd: new URL("../", import.meta.url),
        env: { ...process.env, BASE_URL: origin, PROFILE: "smoke" },
      },
    );
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("close", (code) => resolve({ code, seconds: (Date.now() - started) / 1000, output }));
  });

describe.skipIf(!hasK6)("k6 against a local stub", () => {
  it("stops a 60-second run at the first 429", async () => {
    const { server, origin } = await stubServer(429);
    try {
      const result = await runK6(origin);
      expect(result.code).not.toBe(0);
      expect(result.output).toContain("abortOnFail");
      expect(result.seconds).toBeLessThan(30);
    } finally {
      server.close();
    }
  }, 60_000);

  it("stops a 60-second run when every response is an unexpected 403", async () => {
    const { server, origin } = await stubServer(403);
    try {
      const result = await runK6(origin);
      expect(result.code).not.toBe(0);
      expect(result.output).toContain("unexpected_status");
      expect(result.seconds).toBeLessThan(40);
    } finally {
      server.close();
    }
  }, 60_000);
});
