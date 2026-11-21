import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildWebsite, websiteDirectory } from "./website-build.js";

type HeaderRule = { path: string; headers: Map<string, string> };

// Wrangler's own `_headers` parser lives inside its bundle and is not exported, so this reads
// the same shape: a line that starts at column zero is a path, and the indented `Name: value`
// lines under it are that path's headers. Comments and blank lines are skipped.
const parseHeadersFile = (text: string): HeaderRule[] => {
  const rules: HeaderRule[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("/")) {
      rules.push({ path: line, headers: new Map() });
      continue;
    }
    const separator = line.indexOf(":");
    const rule = rules.at(-1);
    if (rule === undefined || separator === -1) throw new Error(`Unexpected line: ${line}`);
    const name = line.slice(0, separator).trim().toLowerCase();
    // Cloudflare joins repeated names with a comma, so a repeat within one rule or across two
    // rules would change a value. The assertions below keep each name under one rule.
    rule.headers.set(name, line.slice(separator + 1).trim());
  }
  return rules;
};

// The zone's rate limiting rule matches `/v1/` on every hostname, so a top-level `v1` entry in
// the site would be answered by the rule, not by the site.
const assertNoTopLevelV1 = async (directory: string) => {
  const entries = await readdir(directory);
  if (entries.includes("v1")) {
    throw new Error(
      `${directory} has a top-level "v1" entry. The zone's rate limiting rule matches /v1/ on every hostname.`,
    );
  }
};

describe("documentation site deployment", () => {
  let outDirectory = "";

  // `pnpm check` runs the tests before the build, so there is no `dist/` to read. Building into
  // a temporary directory also keeps this test from racing the real build.
  beforeAll(async () => {
    outDirectory = await mkdtemp(join(tmpdir(), "bcd-embed-website-"));
    await buildWebsite(outDirectory);
  }, 120_000);

  afterAll(async () => {
    if (outDirectory !== "") await rm(outDirectory, { recursive: true, force: true });
  });

  it("serves only on the custom domain, with no workers.dev or preview address", async () => {
    const text = await readFile(join(websiteDirectory, "wrangler.jsonc"), "utf8");
    // The file holds whole-line comments and trailing commas, which JSON.parse rejects.
    const json = text.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1");
    const config = JSON.parse(json);
    expect(config.routes).toEqual([{ pattern: "docs.browser-compat.dev", custom_domain: true }]);
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
    expect(config.assets.not_found_handling).toBe("404-page");
  });

  it("writes the home page, Starlight's 404 page and a sitemap", async () => {
    const home = await readFile(join(outDirectory, "index.html"), "utf8");
    expect(home).toContain("<title>How bcd-embed works | bcd-embed</title>");
    const notFound = await readFile(join(outDirectory, "404.html"), "utf8");
    expect(notFound).toContain("<title>404 | bcd-embed</title>");
    const sitemap = await readFile(join(outDirectory, "sitemap-index.xml"), "utf8");
    expect(sitemap).toContain("https://docs.browser-compat.dev/sitemap-0.xml");
    const robots = await readFile(join(outDirectory, "robots.txt"), "utf8");
    expect(robots).toContain("Sitemap: https://docs.browser-compat.dev/sitemap-index.xml");
  });

  it("copies the headers file into the assets directory", async () => {
    const rules = parseHeadersFile(await readFile(join(outDirectory, "_headers"), "utf8"));
    const everything = rules.find((rule) => rule.path === "/*");
    const hashed = rules.find((rule) => rule.path === "/_astro/*");
    expect(everything?.headers.get("x-content-type-options")).toBe("nosniff");
    expect(everything?.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(hashed?.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    // HTML must not inherit the one-year lifetime, and a second `Cache-Control` under `/*` would
    // be joined to the first with a comma on every `_astro/` file.
    expect(everything?.headers.has("cache-control")).toBe(false);
  });

  it("sends the policy as report-only and never as an enforcing header", async () => {
    const rules = parseHeadersFile(await readFile(join(outDirectory, "_headers"), "utf8"));
    const names = rules.flatMap((rule) => [...rule.headers.keys()]);
    expect(names).toContain("content-security-policy-report-only");
    expect(names).not.toContain("content-security-policy");
    // Each name appears once, so Cloudflare has nothing to join.
    expect(new Set(names).size).toBe(names.length);
  });

  it("writes no top-level v1 entry", async () => {
    await expect(assertNoTopLevelV1(outDirectory)).resolves.toBeUndefined();
  });

  it("rejects a top-level v1 entry", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "bcd-embed-v1-"));
    try {
      await mkdir(join(fixture, "v1"));
      await expect(assertNoTopLevelV1(fixture)).rejects.toThrow(/top-level "v1" entry/);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
});
