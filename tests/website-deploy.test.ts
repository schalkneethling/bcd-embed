import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseHeadersFile, parseJsonc } from "./deploy-files.js";
import { buildWebsite, websiteDirectory } from "./website-build.js";

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
    const config = parseJsonc(text);
    expect(config.routes).toEqual([{ pattern: "docs.browser-compat.dev", custom_domain: true }]);
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
    expect((config.assets as { not_found_handling: string }).not_found_handling).toBe("404-page");
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
