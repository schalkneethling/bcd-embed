// What the introduction page needs to be deployed at https://browser-compat.dev (issue #211): the
// Wrangler configuration, the `_headers` file, and an enforcing Content-Security-Policy that the
// built page satisfies.
//
// The browser tests serve the built page on 127.0.0.1 with the exact headers of `_headers`, as
// Cloudflare would send them, and listen for `securitypolicyviolation` events in the page and in
// any worker. They run in Chromium. To run them in Chromium, Firefox and WebKit, set
// BCD_EMBED_HOME_CSP_ENGINES (see apps/home/README.md). Every request that leaves the local server
// is aborted, and the hosted API is answered from installed BCD, so no test reaches a real server.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CompatData } from "@mdn/browser-compat-data/types";
import { chromium, firefox, webkit, type Browser, type BrowserType, type Worker } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildAstroSite } from "../../../tests/astro-build.js";
import {
  parseHeadersFile,
  parseJsonc,
  parsePolicy,
  type HeaderRule,
} from "../../../tests/deploy-files.js";
import { LIVE_EXAMPLE, buildFeatureResponse } from "../src/data/examples.js";
import { serve } from "./serve.js";

const homeDirectory = fileURLToPath(new URL("..", import.meta.url));
const deploymentPage = fileURLToPath(
  new URL("../../website/src/content/docs/deployment.md", import.meta.url),
);
const require = createRequire(import.meta.url);
const bcd: CompatData = require("@mdn/browser-compat-data");

const API_ORIGIN = "https://api.browser-compat.dev";

/** Directives that the policy may name. Each one has a reason in the deployment page. */
const ALLOWED_DIRECTIVES = new Set([
  "default-src",
  "script-src",
  "style-src",
  "img-src",
  "connect-src",
  "object-src",
  "base-uri",
  "form-action",
  "frame-ancestors",
]);

/** Sources that would let injected markup run or load, or that name more than one origin. */
const FORBIDDEN_SOURCES = [
  "'unsafe-inline'",
  "'unsafe-eval'",
  "*",
  "data:",
  "blob:",
  "http:",
  "https:",
];

let outDirectory = "";
let builtHtml = "";
let rules: HeaderRule[] = [];

/** The headers of every rule whose path matches, as Cloudflare applies them to a request. */
const headersFor = (pathname: string): Record<string, string> => {
  const found: Record<string, string> = {};
  for (const rule of rules) {
    // A path in `_headers` may end in `*`, which matches anything after the prefix.
    const matches = rule.path.endsWith("*")
      ? pathname.startsWith(rule.path.slice(0, -1))
      : rule.path === pathname;
    if (!matches) continue;
    for (const [name, value] of rule.headers) found[name] = value;
  }
  return found;
};

/** The enforcing policy that `_headers` sends with every response. */
const sentPolicy = (): string => headersFor("/")["content-security-policy"] ?? "";

/** Whether the page holds a table that asks the API for its data, which `connect-src` serves. */
const hasFetchModeTable = (html: string): boolean => /<bcd-compat-table\b[^>]*\squery="/.test(html);

beforeAll(async () => {
  outDirectory = await mkdtemp(join(tmpdir(), "bcd-embed-home-deploy-"));
  // The same build as `home-page.test.ts`: Vitest runs with NODE_ENV=test, which would select
  // Lit's development build, and `pnpm check` runs the tests before the packages are built. The
  // two tests build the same workspace, so the builds take turns (tests/astro-build.ts).
  await buildAstroSite(homeDirectory, outDirectory, {
    ...process.env,
    NODE_ENV: "production",
    BCD_EMBED_HOME_WORKSPACE_SOURCE: "1",
  });
  builtHtml = await readFile(join(outDirectory, "index.html"), "utf8");
  rules = parseHeadersFile(await readFile(join(outDirectory, "_headers"), "utf8"));
}, 180_000);

afterAll(async () => {
  if (outDirectory !== "") await rm(outDirectory, { recursive: true, force: true });
});

describe("the Wrangler configuration", () => {
  const read = async () =>
    parseJsonc(await readFile(join(homeDirectory, "wrangler.jsonc"), "utf8"));

  it("serves only on the apex custom domain, with no workers.dev or preview address", async () => {
    const config = await read();
    expect(config.routes).toEqual([{ pattern: "browser-compat.dev", custom_domain: true }]);
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
  });

  it("serves the files in dist with no Worker script", async () => {
    const config = await read();
    expect(config.main).toBeUndefined();
    expect((config.assets as { directory: string }).directory).toBe("./dist");
  });

  it("names no account, zone, or binding, so nothing in it identifies an account", async () => {
    const config = await read();
    expect(Object.keys(config).sort()).toEqual([
      "$schema",
      "assets",
      "compatibility_date",
      "name",
      "preview_urls",
      "routes",
      "workers_dev",
    ]);
    const text = await readFile(join(homeDirectory, "wrangler.jsonc"), "utf8");
    // An account identifier is 32 hexadecimal characters.
    expect(text).not.toMatch(/\b[0-9a-f]{32}\b/i);
  });
});

describe("the workspace's scripts", () => {
  const read = async () =>
    JSON.parse(await readFile(join(homeDirectory, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

  it("builds, checks for a v1 entry, and then deploys or dry-runs", async () => {
    const { scripts } = await read();
    expect(scripts.build).toContain("scripts/assert-no-v1.mjs dist");
    // Both deploy scripts run `build`, so a deploy never skips the v1 check.
    expect(scripts.deploy).toBe("pnpm run build && wrangler deploy");
    expect(scripts["deploy:dry-run"]).toBe("pnpm run build && wrangler deploy --dry-run");
  });
});

describe("the headers file", () => {
  it("is copied into dist, with the two plain security headers under one rule", () => {
    const everything = rules.find((rule) => rule.path === "/*");
    expect(everything?.headers.get("x-content-type-options")).toBe("nosniff");
    expect(everything?.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("sends the policy as an enforcing header, never report-only", () => {
    const names = rules.flatMap((rule) => [...rule.headers.keys()]);
    expect(names).toContain("content-security-policy");
    expect(names).not.toContain("content-security-policy-report-only");
    // Each name appears once, so Cloudflare has nothing to join with a comma.
    expect(new Set(names).size).toBe(names.length);
  });

  it("caches the content-hashed files for a year, and leaves HTML on Cloudflare's default", () => {
    const hashed = rules.find((rule) => rule.path === "/_astro/*");
    expect(hashed?.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(rules.find((rule) => rule.path === "/*")?.headers.has("cache-control")).toBe(false);
  });
});

describe("the Content-Security-Policy", () => {
  const policy = () => parsePolicy(sentPolicy());

  it("denies by default and names only the directives it explains", () => {
    expect(policy().get("default-src")).toEqual(["'none'"]);
    for (const name of policy().keys()) expect(ALLOWED_DIRECTIVES.has(name), name).toBe(true);
  });

  it("allows scripts, styles and images from the site's own files only", () => {
    expect(policy().get("script-src")).toEqual(["'self'"]);
    expect(policy().get("style-src")).toEqual(["'self'"]);
    expect(policy().get("img-src")).toEqual(["'self'"]);
  });

  it("closes the directives that default-src does not cover", () => {
    expect(policy().get("object-src")).toEqual(["'none'"]);
    expect(policy().get("base-uri")).toEqual(["'none'"]);
    expect(policy().get("form-action")).toEqual(["'none'"]);
    expect(policy().get("frame-ancestors")).toEqual(["'none'"]);
  });

  it("allows no inline or eval source, wildcard, or scheme in any directive", () => {
    for (const [name, sources] of policy()) {
      for (const source of sources)
        expect(FORBIDDEN_SOURCES, `${name} ${source}`).not.toContain(source);
    }
  });

  // The tests below tie `connect-src` to the page: the API origin is allowed exactly when the built
  // page has a table that fetches.
  it("allows the API origin in connect-src when the built page has a fetch-mode table", () => {
    expect(hasFetchModeTable(builtHtml)).toBe(true);
    expect(policy().get("connect-src")).toEqual([API_ORIGIN]);
  });

  it("recognises a fetch-mode table by its query attribute, and a source-mode table by its source", () => {
    expect(hasFetchModeTable('<bcd-compat-table query="css.properties.display">')).toBe(true);
    expect(hasFetchModeTable('<bcd-compat-table source="data-block">')).toBe(false);
    expect(hasFetchModeTable("<p>No table.</p>")).toBe(false);
  });

  it("is written out, with its reasons, on the deployment page", async () => {
    expect(await readFile(deploymentPage, "utf8")).toContain(sentPolicy());
  });
});

describe("robots.txt", () => {
  it("allows every crawler, and names a sitemap only if the build writes one", async () => {
    const robots = await readFile(join(outDirectory, "robots.txt"), "utf8");
    expect(robots).toMatch(/^User-agent: \*$/m);
    expect(robots).toMatch(/^Allow: \/$/m);
    for (const line of robots.split("\n").filter((entry) => entry.startsWith("Sitemap:"))) {
      const path = new URL(line.slice("Sitemap:".length).trim()).pathname;
      await expect(readFile(join(outDirectory, path), "utf8")).resolves.toBeDefined();
    }
  });
});

const ENGINES: Record<string, BrowserType> = { chromium, firefox, webkit };

/** The engines to run the browser tests in: Chromium, unless BCD_EMBED_HOME_CSP_ENGINES says more. */
const engineNames = (process.env.BCD_EMBED_HOME_CSP_ENGINES ?? "chromium")
  .split(",")
  .map((name) => name.trim())
  .filter((name) => name !== "");
for (const name of engineNames) {
  if (ENGINES[name] === undefined)
    throw new Error(`Unknown engine in BCD_EMBED_HOME_CSP_ENGINES: ${name}`);
}

type Visit = {
  /** Every `securitypolicyviolation` the page or a worker reported, as "directive blocked-URI". */
  readonly violations: string[];
  /** Console messages that name the policy. */
  readonly policyMessages: string[];
  /** Workers the page started. */
  readonly workers: number;
  /** Every request to the hosted API that reached the test's route. */
  readonly apiRequests: string[];
  /** Every request to a host other than the local server (the API aside), which was aborted. */
  readonly foreignRequests: string[];
  /** Tables that rendered a `<table>`: the four built in, and the live one. */
  readonly builtInTables: number;
  readonly liveTables: number;
  /** What the extra markup that a control injects did. */
  readonly injectedScriptRan: boolean;
};

type VisitOptions = {
  /** The policy to send instead of the one in `_headers`. */
  readonly policy?: string;
  /** Markup added to the end of `<body>`, to play a page that carries inline script or style. */
  readonly injectBody?: string;
  /** What to wait for before reading the result. The default waits for every table to render. */
  readonly waitFor?: (violations: string[]) => boolean;
};

describe.each(engineNames)("the built page under the policy in %s", (engineName) => {
  let browser: Browser | undefined;
  const servers: Server[] = [];

  beforeAll(async () => {
    browser = await ENGINES[engineName]?.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await Promise.all(
      servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
  });

  const visit = async (options: VisitOptions = {}): Promise<Visit> => {
    if (browser === undefined) throw new Error("The browser did not launch.");
    const { server, url } = await serve(outDirectory, {
      headers: (pathname) => ({
        ...headersFor(pathname),
        ...(options.policy === undefined ? {} : { "content-security-policy": options.policy }),
      }),
      transform: (pathname, body) =>
        options.injectBody !== undefined && pathname === "/"
          ? body.toString("utf8").replace("</body>", `${options.injectBody}</body>`)
          : body,
    });
    servers.push(server);
    const context = await browser.newContext();
    try {
      const apiRequests: string[] = [];
      const foreignRequests: string[] = [];
      const local = new URL(url).origin;
      // A policy check happens before a request leaves the page, so a missing `connect-src` entry
      // is reported even though this route would have answered.
      await context.route("**/*", async (route) => {
        const requested = route.request().url();
        if (requested.startsWith(`${API_ORIGIN}/`)) {
          apiRequests.push(requested);
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { "access-control-allow-origin": "*" },
            body: JSON.stringify(buildFeatureResponse(bcd, LIVE_EXAMPLE.key)),
          });
        } else if (new URL(requested).origin === local) {
          await route.continue();
        } else {
          foreignRequests.push(requested);
          await route.abort();
        }
      });
      const page = await context.newPage();
      await page.addInitScript(() => {
        const violations: string[] = [];
        Object.assign(window, { cspViolations: violations });
        document.addEventListener("securitypolicyviolation", (event) => {
          violations.push(`${event.effectiveDirective} ${event.blockedURI}`);
        });
      });
      const policyMessages: string[] = [];
      page.on("console", (message) => {
        if (/content.security.policy|refused to|violat/i.test(message.text())) {
          policyMessages.push(message.text());
        }
      });
      // A violation in a worker fires on the worker's global scope, not on the document. The page
      // starts none today, and this keeps a worker added later from reporting unheard.
      const workers: Worker[] = [];
      page.on("worker", (worker) => {
        workers.push(worker);
        void worker
          .evaluate(() => {
            const violations: string[] = [];
            Object.assign(self, { cspViolations: violations });
            self.addEventListener("securitypolicyviolation", (event) => {
              violations.push(`${event.effectiveDirective} ${event.blockedURI}`);
            });
          })
          .catch(() => {});
      });

      await page.goto(url);
      const read = () => page.evaluate(() => Reflect.get(window, "cspViolations") as string[]);
      if (options.waitFor === undefined) {
        // The live table is lazy, so it asks once it comes near the viewport.
        await page.locator(".live bcd-compat-table").scrollIntoViewIfNeeded();
        await page.locator(".live bcd-compat-table[loaded] table").waitFor({ state: "attached" });
        await page.waitForFunction(
          () => document.querySelectorAll(".example-panel bcd-compat-table[loaded]").length === 4,
        );
        // A browser makes some requests after the page renders, such as Firefox's request for the
        // favicon, and reports a violation when each one is blocked. A pause lets those arrive, so
        // a count of zero is not a count taken too early.
        await page.waitForTimeout(500);
        // Use the page as a reader does: choose each example, and open a history disclosure in it.
        // Showing a panel and opening a `<details>` could set a style that the policy blocks.
        for (const label of await page.locator(".example-choices label").all()) {
          await label.click();
          await page
            .locator(".example-panel:visible bcd-compat-table details summary")
            .first()
            .click();
        }
        await page.waitForTimeout(250);
      } else {
        const wanted = options.waitFor;
        // Poll the page's own record, with a bound so a control that never fires fails clearly.
        for (let attempt = 0; attempt < 100 && !wanted(await read()); attempt += 1) {
          await page.waitForTimeout(100);
        }
      }

      const workerViolations = await Promise.all(
        workers.map((worker) =>
          worker.evaluate(() => (Reflect.get(self, "cspViolations") as string[] | undefined) ?? []),
        ),
      );
      const visited: Visit = {
        violations: [...(await read()), ...workerViolations.flat()],
        policyMessages,
        workers: workers.length,
        apiRequests,
        foreignRequests,
        builtInTables: await page.locator(".example-panel bcd-compat-table table").count(),
        liveTables: await page.locator(".live bcd-compat-table table").count(),
        injectedScriptRan: await page.evaluate(
          () => Reflect.get(window, "injectedScriptRan") === true,
        ),
      };
      if (process.env.BCD_EMBED_HOME_CSP_REPORT === "1") {
        const label = options.policy === undefined ? "policy" : "control";
        console.log(
          `${engineName} ${label} ${options.injectBody === undefined ? "" : "injected "}violations=${visited.violations.length}`,
          JSON.stringify(visited),
        );
      }
      return visited;
    } finally {
      await context.close();
    }
  };

  it("reports no violation, renders the four built-in tables and the live one, and leaves localhost only for the API", async () => {
    const visited = await visit();
    expect(visited.violations).toEqual([]);
    expect(visited.policyMessages).toEqual([]);
    expect(visited.builtInTables).toBe(4);
    expect(visited.liveTables).toBe(1);
    // The live table asked for exactly its feature, and the test's route answered it.
    expect(visited.apiRequests).toEqual([
      `${API_ORIGIN}/v1/current/features/${LIVE_EXAMPLE.key}.json`,
    ]);
    expect(visited.foreignRequests).toEqual([]);
  }, 60_000);

  // The controls show that the test above can fail. Without them, a counter that never fired
  // would also report zero.
  it("control: a policy of default-src 'none' alone blocks the page's scripts and styles", async () => {
    const visited = await visit({
      policy: "default-src 'none'",
      waitFor: (violations) => violations.length > 0,
    });
    expect(visited.violations.length).toBeGreaterThan(0);
    expect(visited.violations.some((entry) => entry.startsWith("script-src"))).toBe(true);
    expect(visited.liveTables).toBe(0);
  }, 60_000);

  it("control: without connect-src, the live table's request is blocked and the table is empty", async () => {
    const policy = sentPolicy().replace(/;\s*connect-src[^;]*/, "");
    expect(policy).not.toContain("connect-src");
    const visited = await visit({
      policy,
      waitFor: (violations) => violations.some((entry) => entry.startsWith("connect-src")),
    });
    expect(visited.violations.some((entry) => entry.startsWith("connect-src"))).toBe(true);
    expect(visited.apiRequests).toEqual([]);
    expect(visited.liveTables).toBe(0);
  }, 60_000);

  // The page has no image, but Firefox requests /favicon.ico when the page names no icon, and checks
  // that request against `img-src`. This control shows why `img-src 'self'` is in the policy.
  it.runIf(engineName === "firefox")(
    "control: without img-src, Firefox reports its request for /favicon.ico",
    async () => {
      const policy = sentPolicy().replace(/;\s*img-src[^;]*/, "");
      expect(policy).not.toContain("img-src");
      const visited = await visit({ policy, waitFor: (violations) => violations.length > 0 });
      expect(visited.violations.map((entry) => entry.replace(/:\d+/, ""))).toEqual([
        "img-src http://127.0.0.1/favicon.ico",
      ]);
    },
    60_000,
  );

  it("control: the policy blocks an inline script and a style attribute that markup adds", async () => {
    const visited = await visit({
      injectBody:
        '<script>window.injectedScriptRan = true</script><p style="color: red">Injected</p>',
      waitFor: (violations) =>
        violations.some((entry) => entry.startsWith("script-src")) &&
        violations.some((entry) => entry.startsWith("style-src")),
    });
    expect(visited.violations.some((entry) => entry.startsWith("script-src"))).toBe(true);
    expect(visited.violations.some((entry) => entry.startsWith("style-src"))).toBe(true);
    expect(visited.injectedScriptRan).toBe(false);
  }, 60_000);
});
