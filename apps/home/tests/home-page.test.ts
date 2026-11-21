// Builds the introduction page into a temporary directory, serves it over HTTP, and loads it in
// Chromium (the `playwright` package at the repository root, with the headless shell that CI
// installs). Every request the page makes to a host other than the local server is answered by a
// route in the test or aborted, so no test reaches the hosted API or any other real server.
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { CompatData } from "@mdn/browser-compat-data/types";
import { featureResponseSchema, type FeatureResponse } from "@bcd-embed/schema";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertNoTopLevelV1 } from "../scripts/assert-no-v1.mjs";
import {
  EXAMPLES,
  LIVE_EXAMPLE,
  buildFeatureResponse,
  findSubtree,
  toScriptJson,
} from "../src/data/examples.js";
import { HOSTILE_NOTE } from "./hostile-note.js";

const run = promisify(execFile);
const homeDirectory = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const bcd: CompatData = require("@mdn/browser-compat-data");

const API_ORIGIN = "https://api.browser-compat.dev";
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

// Serves the built site. A path that leaves the directory, or names no file, answers 404.
const serve = async (directory: string): Promise<{ server: Server; url: string }> => {
  const server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? "/").split("?")[0] ?? "/");
    const file = normalize(join(directory, path.endsWith("/") ? `${path}index.html` : path));
    if (!file.startsWith(directory + sep)) {
      response.writeHead(404).end();
      return;
    }
    readFile(file).then(
      (body) => {
        const type = CONTENT_TYPES[extname(file)] ?? "application/octet-stream";
        response.writeHead(200, { "content-type": type }).end(body);
      },
      () => response.writeHead(404).end(),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}/` };
};

let outDirectory = "";
let site: { server: Server; url: string } | undefined;
let browser: Browser | undefined;
let builtHtml = "";

type PageSession = {
  readonly context: BrowserContext;
  readonly page: Page;
  /** Every request to the hosted API, in order. */
  readonly apiRequests: string[];
  /** Every request to any other host than the local server, which the route aborted. */
  readonly foreignRequests: string[];
  /** Set when the page opened an alert, confirm, or prompt dialog. */
  readonly dialogs: string[];
};

// Opens a page in a new context. The hosted API is answered from installed BCD with the CORS header
// the real API sends; any other foreign request is aborted and recorded.
const openPage = async (
  options: { javaScriptEnabled?: boolean; height?: number; path?: string } = {},
): Promise<PageSession> => {
  if (browser === undefined || site === undefined) throw new Error("The test setup did not run.");
  const context = await browser.newContext({
    javaScriptEnabled: options.javaScriptEnabled ?? true,
    viewport: { width: 1280, height: options.height ?? 720 },
  });
  const apiRequests: string[] = [];
  const foreignRequests: string[] = [];
  const dialogs: string[] = [];
  const local = new URL(site.url).origin;
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith(`${API_ORIGIN}/`)) {
      apiRequests.push(url);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(buildFeatureResponse(bcd, LIVE_EXAMPLE.key)),
      });
      return;
    }
    if (new URL(url).origin === local) {
      await route.continue();
      return;
    }
    foreignRequests.push(url);
    await route.abort();
  });
  const page = await context.newPage();
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await page.goto(new URL(options.path ?? "", site.url).href);
  return { context, page, apiRequests, foreignRequests, dialogs };
};

const visiblePanels = (page: Page) =>
  page.$$eval(".example-panel", (panels) =>
    panels
      .filter((panel) => getComputedStyle(panel).display !== "none")
      .map((panel) => (panel as HTMLElement).dataset.example),
  );

// How far the live table's top edge is below the bottom of the viewport, in CSS pixels.
const liveTableDistance = (page: Page) =>
  page
    .locator(`.live bcd-compat-table[query="${LIVE_EXAMPLE.key}"]`)
    .evaluate((element) => element.getBoundingClientRect().top - window.innerHeight);

const waitForTables = (page: Page) =>
  page.waitForFunction(
    () => document.querySelectorAll(".example-panel bcd-compat-table[loaded]").length === 4,
  );

beforeAll(async () => {
  outDirectory = await mkdtemp(join(tmpdir(), "bcd-embed-home-"));
  // Vitest runs with `NODE_ENV=test`, which would make Vite select Lit's development build.
  // `pnpm check` runs the tests before any workspace package is built, so the build reads the
  // packages' source; the deployed page, built by `pnpm build`, reads their `dist/` instead
  // (astro.config.ts).
  await run("pnpm", ["exec", "astro", "build", "--outDir", outDirectory], {
    cwd: homeDirectory,
    env: { ...process.env, NODE_ENV: "production", BCD_EMBED_HOME_WORKSPACE_SOURCE: "1" },
  });
  builtHtml = await readFile(join(outDirectory, "index.html"), "utf8");
  site = await serve(outDirectory);
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => (site ? site.server.close(() => resolve()) : resolve()));
  if (outDirectory !== "") await rm(outDirectory, { recursive: true, force: true });
});

describe("the page's structure", () => {
  it("has one h1, an introduction, and a fieldset with a legend and four labelled radios", async () => {
    const { context, page } = await openPage();
    try {
      expect(await page.locator("h1").count()).toBe(1);
      expect(await page.locator("h1 + p").textContent()).toMatch(/browser compatibility table/);
      const fieldset = page.locator("fieldset");
      expect(await fieldset.count()).toBe(1);
      expect(await fieldset.locator("> legend").count()).toBe(1);
      const radios = await fieldset.locator("input").evaluateAll((inputs) =>
        inputs.map((input) => {
          const label = input.nextElementSibling;
          return {
            type: (input as HTMLInputElement).type,
            label: label?.localName === "label" ? label.textContent : null,
            labelFor: label?.getAttribute("for") === input.id,
          };
        }),
      );
      expect(radios).toEqual([
        { type: "radio", label: "HTML", labelFor: true },
        { type: "radio", label: "CSS", labelFor: true },
        { type: "radio", label: "JavaScript", labelFor: true },
        { type: "radio", label: "Web API", labelFor: true },
      ]);
      expect(await page.locator(".example-panels > .example-panel").count()).toBe(4);
    } finally {
      await context.close();
    }
  });

  it("keeps every radio rendered and in the accessibility tree", async () => {
    const { context, page } = await openPage();
    try {
      const styles = await page
        .locator('input[type="radio"]')
        .evaluateAll((inputs) =>
          inputs.map((input) => [
            getComputedStyle(input).display,
            getComputedStyle(input).visibility,
          ]),
        );
      for (const [display, visibility] of styles) {
        expect(display).not.toBe("none");
        expect(visibility).not.toBe("hidden");
      }
      const snapshot = await page.locator("fieldset").ariaSnapshot();
      for (const name of ["HTML", "CSS", "JavaScript", "Web API"]) {
        expect(snapshot).toContain(`radio "${name}"`);
      }
    } finally {
      await context.close();
    }
  });

  it("states the BCD version its inline data came from", async () => {
    const { context, page } = await openPage();
    try {
      expect(await page.locator("main").textContent()).toContain(`BCD ${bcd.__meta.version}`);
    } finally {
      await context.close();
    }
  });
});

describe("switching panels", () => {
  it("shows only the HTML panel on load", async () => {
    const { context, page } = await openPage();
    try {
      expect(await page.locator("#example-html").isChecked()).toBe(true);
      expect(await visiblePanels(page)).toEqual(["html"]);
    } finally {
      await context.close();
    }
  });

  it("shows only the CSS panel, with a rendered line-clamp table, after a click on CSS", async () => {
    const { context, page, apiRequests } = await openPage();
    try {
      await waitForTables(page);
      // In a viewport this tall the live table may already be near enough to load, so only the
      // requests that the click causes count.
      const requestsBefore = apiRequests.length;
      await page.locator('label[for="example-css"]').click();
      expect(await visiblePanels(page)).toEqual(["css"]);
      const table = page.locator("#panel-css bcd-compat-table .bcd-table");
      expect(await table.isVisible()).toBe(true);
      expect(await table.locator("tbody th").first().textContent()).toContain("line-clamp");
      expect(apiRequests).toHaveLength(requestsBefore);
    } finally {
      await context.close();
    }
  });

  // The criterion's "within one second" rules out a page that waits or requests between presses.
  // Timing the presses from Node would time Playwright's round trips, not the page, so the test
  // checks the effect instead: each press switches the panel at once, and no request is sent.
  it("reaches the Web API panel with three right arrows, with no request", async () => {
    const { context, page, apiRequests, foreignRequests } = await openPage({ height: 600 });
    try {
      await waitForTables(page);
      // A request here could only come from the lazy live table, so the test is only meaningful
      // while that table is further than its 400-pixel margin from the viewport.
      expect(await liveTableDistance(page)).toBeGreaterThan(400);
      const requestsDuringPresses: string[] = [];
      page.on("request", (request) => requestsDuringPresses.push(request.url()));
      await page.locator("#example-html").focus();
      for (const expected of ["css", "javascript", "api"]) {
        await page.keyboard.press("ArrowRight");
        expect(await visiblePanels(page)).toEqual([expected]);
      }
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("example-api");
      expect(requestsDuringPresses).toEqual([]);
      expect(apiRequests).toEqual([]);
      expect(foreignRequests).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it("leaves focus on the selected radio after every selection", async () => {
    const { context, page } = await openPage();
    try {
      await waitForTables(page);
      for (const example of EXAMPLES) {
        await page.locator(`#example-${example.id}`).click();
        expect(await page.evaluate(() => document.activeElement?.id)).toBe(`example-${example.id}`);
      }
      await page.keyboard.press("ArrowLeft");
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("example-javascript");
      expect(await page.locator("#example-javascript").isChecked()).toBe(true);
    } finally {
      await context.close();
    }
  });

  it("switches panels with CSS when script is turned off, and each panel links to MDN", async () => {
    const { context, page } = await openPage({ javaScriptEnabled: false });
    try {
      for (const example of EXAMPLES) {
        await page.locator(`label[for="example-${example.id}"]`).click();
        const panel = page.locator(`#panel-${example.id}`);
        const link = panel.locator('bcd-compat-table a[href^="https://developer.mozilla.org/"]');
        expect(await link.isVisible()).toBe(true);
        expect(await link.getAttribute("href")).toMatch(/#browser_compatibility$/);
        expect(await panel.locator(".bcd-table").count()).toBe(0);
      }
      // The HTML feature has no page of its own, so its link goes to the <video> page and says so.
      const videoLink = page.locator("#panel-html bcd-compat-table a");
      expect(await videoLink.getAttribute("href")).toBe(
        `${findSubtree(bcd, "html.elements.video").__compat?.mdn_url}#browser_compatibility`,
      );
      expect(await videoLink.textContent()).toMatch(/Browser compatibility for\s+<video>\s+on MDN/);
      // `visiblePanels` evaluates script in the page, which this context forbids, so each panel is
      // checked through Playwright's own visibility test instead.
      expect(await page.locator("#panel-api").isVisible()).toBe(true);
      for (const id of ["html", "css", "javascript"]) {
        expect(await page.locator(`#panel-${id}`).isVisible()).toBe(false);
      }
    } finally {
      await context.close();
    }
  });

  it("keeps the fieldset visible in a browser that supports :has()", async () => {
    const { context, page } = await openPage();
    try {
      expect(await page.locator("fieldset").isVisible()).toBe(true);
    } finally {
      await context.close();
    }
  });

  // Chromium supports :has(), so the test plays a browser that does not: it deletes the rules that
  // use :has(), as such a browser drops them, and unwraps the `@supports not selector(:has(*))`
  // block, whose condition is true there.
  it("shows every panel under its own heading, and hides the radios, without :has()", async () => {
    const { context, page } = await openPage();
    try {
      expect(await visiblePanels(page)).toEqual(["html"]);
      const changed = await page.evaluate(() => {
        let removed = 0;
        let unwrapped = 0;
        for (const sheet of document.styleSheets) {
          for (let index = sheet.cssRules.length - 1; index >= 0; index -= 1) {
            const rule = sheet.cssRules[index];
            if (rule instanceof CSSStyleRule && rule.selectorText.includes(":has(")) {
              sheet.deleteRule(index);
              removed += 1;
            } else if (
              rule instanceof CSSSupportsRule &&
              rule.conditionText.replaceAll(" ", "") === "notselector(:has(*))"
            ) {
              const inner = [...rule.cssRules].map((child) => child.cssText);
              sheet.deleteRule(index);
              for (const text of inner.reverse()) sheet.insertRule(text, index);
              unwrapped += 1;
            }
          }
        }
        return { removed, unwrapped };
      });
      expect(changed).toEqual({ removed: 1, unwrapped: 1 });
      expect(await page.locator("fieldset").isVisible()).toBe(false);
      expect(await visiblePanels(page)).toEqual(["html", "css", "javascript", "api"]);
      for (const example of EXAMPLES) {
        const heading = page.locator(`#panel-${example.id} > h3`);
        expect(await heading.isVisible()).toBe(true);
        expect(await heading.textContent()).toContain(example.label);
      }
    } finally {
      await context.close();
    }
  });
});

describe("the inline data", () => {
  const scriptPattern = (id: string) =>
    new RegExp(`<script type="application/json" id="${id}">([^]*?)</script>`);

  it("holds one escaped JSON script per panel that validates and matches installed BCD", () => {
    for (const example of EXAMPLES) {
      const id = `bcd-data-${example.key.replaceAll(".", "-")}`;
      const matches = builtHtml.match(new RegExp(`id="${id}"`, "g")) ?? [];
      expect(matches).toHaveLength(1);
      const text = builtHtml.match(scriptPattern(id))?.[1];
      expect(text).toBeDefined();
      expect(text).not.toContain("<");
      const parsed: unknown = JSON.parse(text ?? "");
      expect(featureResponseSchema.safeParse(parsed).success).toBe(true);
      expect(parsed).toEqual(buildFeatureResponse(bcd, example.key));
    }
    // The real notes hold markup such as `<code>`, so the escape is exercised by real data too.
    expect(builtHtml).toContain("\\u003ccode>");
  });

  it("keeps a hostile note inside its script, where nothing runs", async () => {
    const payload: FeatureResponse = structuredClone(
      buildFeatureResponse(bcd, "css.properties.line-clamp"),
    );
    const statement = payload.features[0]?.support.chrome?.branches[0]?.statements[0];
    if (statement === undefined) throw new Error("The line-clamp payload has no Chrome statement.");
    statement.notes = [HOSTILE_NOTE];
    const id = "bcd-data-css-properties-line-clamp";
    // A function replacer, because a string replacement would read a `$&` or `$1` in the payload
    // as a pattern.
    const hostileHtml = builtHtml.replace(
      scriptPattern(id),
      () => `<script type="application/json" id="${id}">${toScriptJson(payload)}</script>`,
    );
    expect(hostileHtml).not.toBe(builtHtml);
    await mkdir(join(outDirectory, "hostile"));
    await writeFile(join(outDirectory, "hostile", "index.html"), hostileHtml);

    const { context, page, dialogs } = await openPage({ path: "hostile/" });
    try {
      await waitForTables(page);
      expect(await page.locator(`script#${id}`).count()).toBe(1);
      expect(await page.locator('script[type="application/json"]').count()).toBe(4);
      // The four data scripts and the element's module. No script came from the note.
      expect(await page.locator("script").count()).toBe(5);
      const note = await page.locator("#panel-css bcd-compat-table").textContent();
      expect(note).toContain("</script><script>alert(1)</script>");
      expect(dialogs).toEqual([]);
      expect(await page.locator("#panel-api bcd-compat-table[loaded]").count()).toBe(1);
    } finally {
      await context.close();
      await rm(join(outDirectory, "hostile"), { recursive: true, force: true });
    }
  });
});

describe("the live table", () => {
  it("sends no request until it scrolls near, then exactly one", async () => {
    const { context, page, apiRequests, foreignRequests } = await openPage({ height: 600 });
    try {
      await waitForTables(page);
      const live = page.locator(`.live bcd-compat-table[query="${LIVE_EXAMPLE.key}"]`);
      // The element waits until it is within 400 pixels of the viewport, so the test is only
      // meaningful while the table starts further away than that.
      expect(await liveTableDistance(page)).toBeGreaterThan(400);
      await page.waitForTimeout(300);
      expect(apiRequests).toEqual([]);

      await live.scrollIntoViewIfNeeded();
      await page.waitForFunction(
        (key) => document.querySelector(`bcd-compat-table[query="${key}"]`)?.hasAttribute("loaded"),
        LIVE_EXAMPLE.key,
      );
      expect(apiRequests).toEqual([`${API_ORIGIN}/v1/current/features/${LIVE_EXAMPLE.key}.json`]);
      await page.mouse.wheel(0, -5000);
      await page.mouse.wheel(0, 5000);
      await page.waitForTimeout(300);
      expect(apiRequests).toHaveLength(1);
      expect(foreignRequests).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

describe("the built site", () => {
  it("keeps the base stylesheet's layer statement and light-dark() colours unminified", async () => {
    const hrefs = [...builtHtml.matchAll(/<link rel="stylesheet" href="\/([^"]+)"/g)].map(
      (match) => match[1] ?? "",
    );
    expect(hrefs.length).toBeGreaterThan(0);
    const css = (
      await Promise.all(hrefs.map((href) => readFile(join(outDirectory, href), "utf8")))
    ).join("\n");
    expect(css).toContain("@layer bcd-embed.base;");
    expect(css).toContain("light-dark(");
    expect(css).not.toContain("--lightningcss-");
    // Astro writes every stylesheet as a file, so the page has no `<style>` element.
    expect(builtHtml).not.toContain("<style");
  });

  it("writes no top-level v1 entry", async () => {
    await expect(assertNoTopLevelV1(outDirectory)).resolves.toBeUndefined();
  });

  it("fails the check when a top-level v1 entry is added", async () => {
    await mkdir(join(outDirectory, "v1"));
    try {
      await expect(assertNoTopLevelV1(outDirectory)).rejects.toThrow(/top-level "v1" entry/);
    } finally {
      await rm(join(outDirectory, "v1"), { recursive: true, force: true });
    }
  });

  // The build script runs the check from the command line, so its exit code is what fails the build.
  it("exits non-zero from the command line when a top-level v1 entry is added", async () => {
    const script = join(homeDirectory, "scripts", "assert-no-v1.mjs");
    await expect(run(process.execPath, [script, outDirectory])).resolves.toBeDefined();
    await mkdir(join(outDirectory, "v1"));
    try {
      await expect(run(process.execPath, [script, outDirectory])).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining('top-level "v1" entry'),
      });
    } finally {
      await rm(join(outDirectory, "v1"), { recursive: true, force: true });
    }
  });
});
