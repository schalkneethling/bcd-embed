// Builds the introduction page into a temporary directory, serves it over HTTP, and loads it in
// Chromium (the `playwright` package at the repository root, with the headless shell that CI
// installs). Every request the page makes to a host other than the local server is answered by a
// route in the test or aborted, so no test reaches the hosted API or any other real server.
import { execFile } from "node:child_process";
import type { Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import AxeBuilder from "@axe-core/playwright";
import type { CompatData } from "@mdn/browser-compat-data/types";
import { featureResponseSchema, type FeatureResponse } from "@bcd-embed/schema";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertNoTopLevelV1 } from "../scripts/assert-no-v1.mjs";
import { contrastRatio, parseRgb, type Rgb } from "./contrast.js";
import {
  EXAMPLES,
  LIVE_EXAMPLE,
  buildFeatureResponse,
  findSubtree,
  toScriptJson,
} from "../src/data/examples.js";
import { describeRelease, type PackageManifest } from "../src/data/release.js";
import { buildAstroSite } from "../../../tests/astro-build.js";
import { HOSTILE_NOTE } from "./hostile-note.js";
import { serve } from "./serve.js";

const run = promisify(execFile);
const homeDirectory = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const bcd: CompatData = require("@mdn/browser-compat-data");

const API_ORIGIN = "https://api.browser-compat.dev";

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
  options: {
    javaScriptEnabled?: boolean;
    width?: number;
    height?: number;
    path?: string;
    colorScheme?: "light" | "dark";
    forcedColors?: "active" | "none";
    reducedMotion?: "reduce" | "no-preference";
    /** Rewrites each stylesheet before the page receives it, to play a browser that lacks a feature. */
    transformCss?: (css: string) => string;
  } = {},
): Promise<PageSession> => {
  if (browser === undefined || site === undefined) throw new Error("The test setup did not run.");
  const context = await browser.newContext({
    javaScriptEnabled: options.javaScriptEnabled ?? true,
    viewport: { width: options.width ?? 1280, height: options.height ?? 720 },
    colorScheme: options.colorScheme,
    forcedColors: options.forcedColors,
    reducedMotion: options.reducedMotion,
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
      if (options.transformCss !== undefined && new URL(url).pathname.endsWith(".css")) {
        const response = await route.fetch();
        await route.fulfill({ response, body: options.transformCss(await response.text()) });
        return;
      }
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
  // (astro.config.ts). The deployment test builds the same workspace, and two builds at once
  // delete each other's intermediate files, so the builds take turns (tests/astro-build.ts).
  await buildAstroSite(homeDirectory, outDirectory, {
    ...process.env,
    NODE_ENV: "production",
    BCD_EMBED_HOME_WORKSPACE_SOURCE: "1",
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

  it("has a header with the wordmark and the main navigation, before main", async () => {
    const { context, page } = await openPage();
    try {
      expect(await page.locator("body > header + main").count()).toBe(1);
      expect(await page.locator("header .site-header__brand").getAttribute("href")).toBe("/");
      const links = await page
        .locator('header nav[aria-label="Main"] a')
        .evaluateAll((anchors) =>
          anchors.map((anchor) => [anchor.textContent, anchor.getAttribute("href")]),
        );
      expect(links).toEqual([
        ["Examples", "#examples"],
        ["Documentation", "https://docs.browser-compat.dev/"],
        ["API", "https://docs.browser-compat.dev/#the-endpoints"],
        ["GitHub", "https://github.com/schalkneethling/bcd-embed"],
      ]);
      expect(await page.locator("#examples").count()).toBe(1);
      // The glyph is decorative, so the link's name is the wordmark alone.
      expect(await page.locator(".site-header__glyph").getAttribute("aria-hidden")).toBe("true");
    } finally {
      await context.close();
    }
  });

  // The badge and the command come from the element's package.json at build time, so a release
  // changes them and nobody has to edit the page (src/data/release.ts).
  it("shows the element's release, its install command, and a link to the getting started page", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../../../packages/element/package.json", import.meta.url), "utf8"),
    ) as PackageManifest;
    const release = describeRelease(manifest);
    const { context, page } = await openPage();
    try {
      expect(await page.locator(".hero__release").textContent()).toBe(release.badge);
      expect(await page.locator(".hero__release").textContent()).toContain(manifest.version);
      expect(await page.locator(".hero__install code").textContent()).toBe(release.installCommand);
      expect(await page.locator(".hero__start").getAttribute("href")).toBe(
        "https://docs.browser-compat.dev/component/getting-started/",
      );
    } finally {
      await context.close();
    }
  });

  // Astro's HTML compression drops the line break between a word and an element that starts the
  // next source line, which ran "with its" and "source" together. The page writes `{" "}` there.
  it("keeps a space between a word and the link or code that follows it", () => {
    const text = builtHtml.replace(/<script\b[^>]*>[^]*?<\/script>/g, "");
    expect(text.match(/[A-Za-z]<(?:a|code)[\s>]/g) ?? []).toEqual([]);
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
      // The radio is clipped away, so a reader clicks its label, which moves focus to the radio.
      for (const example of EXAMPLES) {
        await page.locator(`label[for="example-${example.id}"]`).click();
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
      // The four data scripts, the element's module, and the status module. No script came from
      // the note.
      expect(await page.locator("script").count()).toBe(6);
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

// The status region (issue #210). A script creates it, so it exists only where script runs.
describe("the status region", () => {
  it("is not in the built HTML, because a script creates it", () => {
    expect(builtHtml).not.toMatch(/role=["']?status/);
    expect(builtHtml).not.toContain("aria-live");
  });

  it("is not in the page when script is turned off", async () => {
    const { context, page } = await openPage({ javaScriptEnabled: false });
    try {
      expect(await page.locator('[role="status"]').count()).toBe(0);
      expect(await page.locator("[aria-live]").count()).toBe(0);
    } finally {
      await context.close();
    }
  });

  it("exists and is empty once the page has loaded, outside the panels", async () => {
    const { context, page } = await openPage();
    try {
      await waitForTables(page);
      const status = page.locator('[role="status"]');
      expect(await status.count()).toBe(1);
      expect(await status.textContent()).toBe("");
      expect(await status.evaluate((element) => element.closest(".example-panel"))).toBeNull();
      expect(await status.evaluate((element) => element.parentElement?.className)).toBe("examples");
    } finally {
      await context.close();
    }
  });

  it("holds one sentence that names the example after each selection, by mouse or keyboard", async () => {
    const { context, page } = await openPage();
    try {
      await waitForTables(page);
      const status = page.locator('[role="status"]');
      // The HTML radio starts checked, so choosing it first would change nothing. It goes last.
      for (const example of [...EXAMPLES.slice(1), ...EXAMPLES.slice(0, 1)]) {
        await page.locator(`label[for="example-${example.id}"]`).click();
        const text = (await status.textContent()) ?? "";
        expect(text).toBe(example.announcement);
        expect(text).toMatch(/^Showing the [^\n]+ example: [^\n]+$/);
        expect(text).toContain(example.name);
      }
      // The keyboard path changes the sentence too, and focus stays on the radio.
      await page.keyboard.press("ArrowRight");
      expect(await status.textContent()).toBe(EXAMPLES[1]?.announcement);
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("example-css");
    } finally {
      await context.close();
    }
  });

  // A note or a name could hold markup, and the region must show it as text, never parse it.
  it("sets the sentence as text, so markup in it stays literal", async () => {
    const { context, page } = await openPage();
    try {
      await waitForTables(page);
      const literal = "<b>x</b>";
      await page.locator("#example-css").evaluate((radio, text) => {
        (radio as HTMLInputElement).dataset.announcement = text;
      }, literal);
      await labelFor(page, "css").click();
      const status = page.locator('[role="status"]');
      expect(await status.evaluate((element) => element.childElementCount)).toBe(0);
      expect(await status.textContent()).toBe(literal);
    } finally {
      await context.close();
    }
  });

  it("is not visible, and takes no room", async () => {
    const { context, page } = await openPage();
    try {
      const status = page.locator('[role="status"]');
      const box = await status.boundingBox();
      expect(box === null || (box.width <= 1 && box.height <= 1)).toBe(true);
      expect(await status.evaluate((element) => getComputedStyle(element).display)).not.toBe(
        "none",
      );
    } finally {
      await context.close();
    }
  });

  // A strict policy (#211) serves `script-src 'self'` and `style-src 'self'`, which blocks inline
  // script and every `style` attribute in the HTML.
  it("comes from a script file, with no inline script or style in the built HTML", () => {
    const scripts = [...builtHtml.matchAll(/<script\b([^>]*)>/g)].map((match) => match[1] ?? "");
    expect(scripts.length).toBeGreaterThan(0);
    for (const attributes of scripts) {
      expect(
        /type="application\/json"/.test(attributes) || /\ssrc="\/[^"]+\.js"/.test(attributes),
      ).toBe(true);
    }
    // Only the attributes of tags count. The text of a script is data, and a note in BCD may hold
    // any characters, so the check removes script bodies and reads the tags that remain.
    const tags = builtHtml.replace(/<script\b[^>]*>[^]*?<\/script>/g, "").match(/<[a-zA-Z][^>]*>/g);
    expect(tags?.length).toBeGreaterThan(0);
    for (const tag of tags ?? []) {
      expect(tag, "a style attribute").not.toMatch(/\sstyle\s*=/);
      expect(tag, "an event handler attribute").not.toMatch(/\son[a-z]+\s*=/);
      // `script-src 'self'` also blocks a `javascript:` URL, which would run as inline script.
      expect(tag, "a javascript: URL").not.toMatch(/javascript:/i);
    }
  });
});

type Scheme = "light" | "dark";
const SCHEMES: readonly Scheme[] = ["light", "dark"];

/** The computed value of each property on the first element the locator matches. */
const computed = <Name extends string>(
  locator: Locator,
  names: readonly Name[],
): Promise<Record<Name, string>> =>
  locator.evaluate((element, properties) => {
    const style = getComputedStyle(element);
    return Object.fromEntries(
      properties.map((property) => [property, style.getPropertyValue(property)]),
    );
  }, names) as Promise<Record<Name, string>>;

const labelFor = (page: Page, id: string) => page.locator(`label[for="example-${id}"]`);

/**
 * Presses Tab until the element with this id has focus, as a keyboard user reaches it. The header's
 * links come before the radio group in the focus order, so one press is not enough. The bound
 * fails the test if the element is never reached.
 */
const tabTo = async (page: Page, id: string): Promise<void> => {
  for (let presses = 0; presses < 20; presses += 1) {
    await page.keyboard.press("Tab");
    if ((await page.evaluate(() => document.activeElement?.id)) === id) return;
  }
  throw new Error(`Tab never reached #${id}.`);
};

// Every style rule in every stylesheet, nested rules included.
const styleRules = (page: Page) =>
  page.evaluate(() => {
    const found: { selector: string; boxShadow: string }[] = [];
    const walk = (rules: CSSRuleList) => {
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule) {
          found.push({ selector: rule.selectorText, boxShadow: rule.style.boxShadow });
        }
        if ("cssRules" in rule) walk(rule.cssRules as CSSRuleList);
      }
    };
    for (const sheet of document.styleSheets) walk(sheet.cssRules);
    return found;
  });

describe("the segmented control's styles", () => {
  it("hides each radio with a clip pattern, and keeps it rendered", async () => {
    const { context, page } = await openPage();
    try {
      const radio = await computed(page.locator("#example-html"), [
        "position",
        "clip-path",
        "display",
        "visibility",
        "inline-size",
        "block-size",
        "opacity",
      ] as const);
      expect(radio.position).toBe("absolute");
      expect(radio["clip-path"]).not.toBe("none");
      expect(radio.display).not.toBe("none");
      expect(radio.visibility).toBe("visible");
      expect(radio.opacity).toBe("1");
      expect(Number.parseFloat(radio["inline-size"])).toBeLessThanOrEqual(1);
      expect(Number.parseFloat(radio["block-size"])).toBeLessThanOrEqual(1);
    } finally {
      await context.close();
    }
  });

  it("styles the checked and focus states with the sibling combinator, with no :has() and no box-shadow", async () => {
    const { context, page } = await openPage();
    try {
      const rules = await styleRules(page);
      const stateful = rules.filter(
        ({ selector }) => selector.includes(":checked") || selector.includes(":focus"),
      );
      const selectors = stateful.map(({ selector }) => selector);
      expect(selectors.some((selector) => selector.includes("input:checked + label"))).toBe(true);
      expect(selectors.some((selector) => selector.includes("input:focus-visible + label"))).toBe(
        true,
      );
      // The one rule allowed to use :has() in a :checked or :focus selector is the panel switching,
      // which reaches the panels, not a label, so it cannot use the sibling combinator. Nothing
      // else may.
      const panelSwitching =
        /^\.examples:has\(\[value="(html|css|javascript|api)"\]:checked\) \.example-panel:not\(\[data-example="\1"\]\)$/;
      const withHas = selectors
        .flatMap((selector) => selector.split(", "))
        .filter((selector) => selector.includes(":has("));
      expect(withHas).toHaveLength(4);
      for (const selector of withHas) expect(selector).toMatch(panelSwitching);
      // Forced colours removes a box-shadow, so no state rule and no rule of the control may use one.
      for (const { selector, boxShadow } of rules) {
        if (
          selector.includes(":checked") ||
          selector.includes(":focus") ||
          selector.includes(".example-choices")
        ) {
          expect(boxShadow, selector).toBe("");
        }
      }
    } finally {
      await context.close();
    }
  });

  // A browser that parses :has() but not light-dark() drops each declaration that has light-dark()
  // with literal arguments and keeps the plain one before it. The test plays that browser by
  // renaming the function in the stylesheets, which makes the declaration invalid at parse time.
  it.each(SCHEMES)(
    "keeps a border, a checked border and a focus ring in a browser without light-dark(), in the %s scheme",
    async (scheme) => {
      const { context, page } = await openPage({
        colorScheme: scheme,
        transformCss: (css) => css.replaceAll("light-dark(", "lightdark("),
      });
      try {
        const pageBackground = parseRgb(
          (await computed(page.locator("html"), ["background-color"] as const))["background-color"],
        );
        const names = ["border-top-width", "border-top-color"] as const;
        const unchecked = await computed(labelFor(page, "css"), names);
        const checked = await computed(labelFor(page, "html"), names);
        expect(unchecked["border-top-width"]).toBe("2px");
        expect(checked["border-top-width"]).toBe("4px");
        // The plain fallback, which proves that the renamed function was dropped.
        expect(unchecked["border-top-color"]).toBe("rgb(128, 128, 128)");
        expect(
          contrastRatio(parseRgb(unchecked["border-top-color"]), pageBackground),
        ).toBeGreaterThanOrEqual(3);
        expect(
          contrastRatio(parseRgb(checked["border-top-color"]), pageBackground),
        ).toBeGreaterThanOrEqual(3);

        await tabTo(page, "example-html");
        const ring = await computed(labelFor(page, "html"), [
          "outline-style",
          "outline-width",
          "outline-color",
        ] as const);
        expect(ring["outline-style"]).toBe("solid");
        expect(ring["outline-width"]).toBe("3px");
        expect(
          contrastRatio(parseRgb(ring["outline-color"]), pageBackground),
          `ring ${ring["outline-color"]} in ${scheme}`,
        ).toBeGreaterThanOrEqual(3);
      } finally {
        await context.close();
      }
    },
  );

  it("differs between the checked and an unchecked label by more than colour", async () => {
    const { context, page } = await openPage();
    try {
      const names = ["border-top-width", "border-top-style", "font-weight"] as const;
      const checked = await computed(labelFor(page, "html"), names);
      const unchecked = await computed(labelFor(page, "css"), names);
      expect(Number.parseFloat(checked["border-top-width"])).toBeGreaterThan(
        Number.parseFloat(unchecked["border-top-width"]),
      );
      expect(Number(checked["font-weight"])).toBeGreaterThan(Number(unchecked["font-weight"]));
      expect(checked["border-top-style"]).toBe("solid");
    } finally {
      await context.close();
    }
  });

  // The radios stay in a group, so a keyboard user always lands on the checked one, and its label
  // shows the ring and the checked style together. The ring is an outline, drawn outside the
  // border, so the two stay apart.
  it("draws a focus ring of at least 2 pixels, apart from the checked style, only for keyboard focus", async () => {
    const { context, page } = await openPage();
    try {
      const names = ["outline-width", "outline-style", "outline-offset", "outline-color"] as const;
      expect((await computed(labelFor(page, "html"), names))["outline-style"]).toBe("none");
      await tabTo(page, "example-html");
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("example-html");
      const ring = await computed(labelFor(page, "html"), names);
      expect(ring["outline-style"]).toBe("solid");
      expect(Number.parseFloat(ring["outline-width"])).toBeGreaterThanOrEqual(2);
      // An offset of at least 2 pixels keeps the ring off the checked border, so the colour next to
      // the ring is the page's on both sides, and the contrast test measures it against the page.
      expect(Number.parseFloat(ring["outline-offset"])).toBeGreaterThanOrEqual(2);
      // A mouse click on another label checks it without a ring.
      await labelFor(page, "css").click();
      expect((await computed(labelFor(page, "css"), names))["outline-style"]).toBe("none");
    } finally {
      await context.close();
    }
  });

  it.each([320, 1280])(
    "keeps every label at least 44 by 44 pixels at %i pixels wide",
    async (width) => {
      const { context, page } = await openPage({ width });
      try {
        for (const example of EXAMPLES) {
          const box = await labelFor(page, example.id).boundingBox();
          // WCAG 2.5.8 asks for 24 by 24; the design aims for 44.
          expect(box?.width).toBeGreaterThanOrEqual(44);
          expect(box?.height).toBeGreaterThanOrEqual(44);
        }
        // The labels wrap instead of leaving the viewport, so a narrow screen needs no sideways
        // scrolling.
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
      } finally {
        await context.close();
      }
    },
  );

  it("moves no label when the selection changes", async () => {
    const { context, page } = await openPage({ width: 400 });
    try {
      const boxes = () =>
        Promise.all(EXAMPLES.map((example) => labelFor(page, example.id).boundingBox()));
      // The hero puts the control below the first screen. A box is measured from the viewport, so
      // the control is scrolled into view first, and the click then has nothing to scroll.
      await page.locator(".example-choices").scrollIntoViewIfNeeded();
      const before = await boxes();
      await labelFor(page, "javascript").click();
      expect(await boxes()).toEqual(before);
    } finally {
      await context.close();
    }
  });
});

// A developer sets this to a directory to keep the screenshots the tests take, for a visual check.
const screenshotDirectory = process.env.BCD_EMBED_HOME_SCREENSHOTS;
// It takes a function, so no screenshot is taken when the variable is unset.
const keepScreenshot = async (name: string, take: () => Promise<Buffer>): Promise<void> => {
  if (screenshotDirectory === undefined) return;
  await mkdir(screenshotDirectory, { recursive: true });
  await writeFile(join(screenshotDirectory, `${name}.png`), await take());
};

// A screenshot of the element and the margin around it, which holds a focus ring, taken with the
// pointer away so that no label is hovered. The element is scrolled into view first, because a
// clip is measured in the viewport.
const photographAround = async (page: Page, locator: Locator, margin = 12): Promise<Buffer> => {
  await locator.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  const box = await locator.boundingBox();
  if (box === null) throw new Error("The element has no box.");
  return page.screenshot({
    clip: {
      x: Math.max(0, box.x - margin),
      y: Math.max(0, box.y - margin),
      width: box.width + 2 * margin,
      height: box.height + 2 * margin,
    },
  });
};

type Check = { readonly pair: string; readonly ratio: number; readonly minimum: number };

describe.each(SCHEMES)("the segmented control's contrast in the %s scheme", (scheme) => {
  // Every colour is read from the browser's computed style, so each ratio is the one the page
  // paints. Each pair is a colour against the colour next to it.
  it("meets 3:1 for the boundary, the checked indicator and the focus ring, and 4.5:1 for text", async () => {
    const { context, page } = await openPage({ colorScheme: scheme });
    try {
      const colour = async (locator: Locator, name: string): Promise<Rgb> =>
        parseRgb((await computed(locator, [name] as const))[name] ?? "");
      const pageBackground = await colour(page.locator("html"), "background-color");
      const bodyText = await colour(page.locator("body"), "color");

      const checkedLabel = labelFor(page, "html");
      const checkedBorder = await colour(checkedLabel, "border-top-color");
      const checkedFill = await colour(checkedLabel, "background-color");
      const checkedText = await colour(checkedLabel, "color");

      const label = labelFor(page, "css");
      const border = await colour(label, "border-top-color");
      const fill = await colour(label, "background-color");
      const text = await colour(label, "color");

      await label.hover();
      const hoverFill = await colour(label, "background-color");
      const hoverText = await colour(label, "color");
      const hoverBorder = await colour(label, "border-top-color");
      await page.mouse.move(0, 0);

      await tabTo(page, "example-html");
      const ring = await colour(checkedLabel, "outline-color");

      const checks: Check[] = [
        {
          pair: "unchecked border on the page",
          ratio: contrastRatio(border, pageBackground),
          minimum: 3,
        },
        { pair: "unchecked border on its label", ratio: contrastRatio(border, fill), minimum: 3 },
        {
          pair: "unchecked border on its hovered label",
          ratio: contrastRatio(hoverBorder, hoverFill),
          minimum: 3,
        },
        {
          pair: "checked border on the page",
          ratio: contrastRatio(checkedBorder, pageBackground),
          minimum: 3,
        },
        {
          pair: "checked border on its label",
          ratio: contrastRatio(checkedBorder, checkedFill),
          minimum: 3,
        },
        { pair: "focus ring on the page", ratio: contrastRatio(ring, pageBackground), minimum: 3 },
        { pair: "unchecked label text", ratio: contrastRatio(text, fill), minimum: 4.5 },
        { pair: "hovered label text", ratio: contrastRatio(hoverText, hoverFill), minimum: 4.5 },
        {
          pair: "checked label text",
          ratio: contrastRatio(checkedText, checkedFill),
          minimum: 4.5,
        },
        {
          pair: "body text on the page",
          ratio: contrastRatio(bodyText, pageBackground),
          minimum: 4.5,
        },
      ];
      await keepScreenshot(`segmented-control-${scheme}`, () =>
        photographAround(page, page.locator(".example-choices")),
      );
      if (process.env.BCD_EMBED_HOME_CONTRAST_REPORT === "1") {
        const rows = checks.map(
          ({ pair, ratio, minimum }) => `${pair}\t${ratio.toFixed(2)}\t${minimum}`,
        );
        console.info(`\n${scheme}\n${rows.join("\n")}`);
      }
      for (const { pair, ratio, minimum } of checks) {
        expect(ratio, `${pair} in ${scheme}`).toBeGreaterThanOrEqual(minimum);
      }
    } finally {
      await context.close();
    }
  });
});

// The rest of the page's palette, and the table's tokens, in each scheme. Text needs 4.5:1, even
// the large wordmark, which WCAG would let pass at 3:1. The focus ring, the table's icons and its
// cell borders need 3:1 (WCAG 1.4.11). Each icon colour is read from the registered token the base
// stylesheet uses in that scheme, so every state counts, including those no panel shows today.
describe.each(SCHEMES)("the page's colours in the %s scheme", (scheme) => {
  it("meets 4.5:1 for every text colour and 3:1 for the focus ring and the table's tokens", async () => {
    const { context, page } = await openPage({ colorScheme: scheme });
    try {
      await waitForTables(page);
      const colour = async (selector: string, name: string): Promise<Rgb> =>
        parseRgb((await computed(page.locator(selector).first(), [name] as const))[name] ?? "");
      const pageBackground = await colour("html", "background-color");
      const panel = await colour("#panel-html", "background-color");
      const start = await colour(".hero__start", "background-color");
      const install = await colour(".hero__install code", "background-color");
      const snippet = await colour(".how__snippet", "background-color");

      const checks: Check[] = [
        ["wordmark in the header", await colour(".site-header__brand", "color"), pageBackground],
        ["navigation link", await colour(".site-header__links a", "color"), pageBackground],
        ["release badge", await colour(".hero__release", "color"), pageBackground],
        ["heading wordmark", await colour(".hero__title", "color"), pageBackground],
        ["introduction", await colour(".hero__lede", "color"), pageBackground],
        ["Get started link", await colour(".hero__start", "color"), start],
        ["install command", await colour(".hero__install code", "color"), install],
        ["legend", await colour(".example-choices legend", "color"), pageBackground],
        ["panel heading", await colour("#panel-html > h3", "color"), panel],
        ["panel summary", await colour("#panel-html > p", "color"), panel],
        ["markup sample", await colour(".how__snippet", "color"), snippet],
        ["footer text", await colour(".site-footer", "color"), pageBackground],
        ["footer link", await colour(".site-footer a", "color"), pageBackground],
      ].map(([pair, text, background]) => ({
        pair: pair as string,
        ratio: contrastRatio(text as Rgb, background as Rgb),
        minimum: 4.5,
      }));

      // The first stop in the focus order is the wordmark's link.
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.className)).toBe(
        "site-header__brand",
      );
      const ring = await colour(".site-header__brand", "outline-color");
      checks.push({
        pair: "link focus ring on the page",
        ratio: contrastRatio(ring, pageBackground),
        minimum: 3,
      });

      const tokens = [
        "supported",
        "partial",
        "preview",
        "flagged",
        "unsupported",
        "unknown",
        "no-data",
        "border",
      ];
      for (const token of tokens) {
        const value = await colour("html", `--bcd-color-${token}-${scheme}`);
        checks.push(
          {
            pair: `table ${token} on the page`,
            ratio: contrastRatio(value, pageBackground),
            minimum: 3,
          },
          { pair: `table ${token} on a panel`, ratio: contrastRatio(value, panel), minimum: 3 },
        );
      }

      if (process.env.BCD_EMBED_HOME_CONTRAST_REPORT === "1") {
        const rows = checks.map(
          ({ pair, ratio, minimum }) => `${pair}\t${ratio.toFixed(2)}\t${minimum}`,
        );
        console.info(`\npage ${scheme}\n${rows.join("\n")}`);
      }
      for (const { pair, ratio, minimum } of checks) {
        expect(ratio, `${pair} in ${scheme}`).toBeGreaterThanOrEqual(minimum);
      }
    } finally {
      await context.close();
    }
  });
});

describe("motion", () => {
  // The listener sits on the document in the capture phase, so it sees a transition on any element
  // of the page, the panels, the status region and the tables included.
  it("starts no transition anywhere on the page under prefers-reduced-motion: reduce", async () => {
    const { context, page } = await openPage({ reducedMotion: "reduce" });
    try {
      await waitForTables(page);
      await page.evaluate(() => {
        const started: string[] = [];
        for (const type of ["transitionrun", "transitionstart"]) {
          document.addEventListener(type, (event) => started.push(event.type), true);
        }
        (window as unknown as { started: string[] }).started = started;
      });
      const durations = await page.evaluate(() =>
        [...document.querySelectorAll("*")].map(
          (element) => getComputedStyle(element).transitionDuration,
        ),
      );
      expect(durations.length).toBeGreaterThan(100);
      for (const duration of durations) {
        for (const value of duration.split(",")) expect(Number.parseFloat(value)).toBe(0);
      }
      // A selection by mouse and by keyboard, a disclosure in the table, and the pointer over it.
      await labelFor(page, "css").click();
      await page.keyboard.press("ArrowRight");
      const summary = page
        .locator(".example-panel:visible bcd-compat-table details summary")
        .first();
      await summary.click();
      await summary.hover();
      await page.waitForTimeout(100);
      const started = await page.evaluate(
        () => (window as unknown as { started: string[] }).started,
      );
      expect(started).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

describe("forced colours", () => {
  // Under `forced-colors: active` the browser replaces the author's colours and removes shadows, so
  // only shape survives. The test photographs one label unchecked, checked, and checked with the
  // keyboard ring, and each picture must differ from the others.
  it("tells the checked label and the focused label apart from an unchecked one", async () => {
    const { context, page } = await openPage({ forcedColors: "active" });
    try {
      expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);
      const label = labelFor(page, "css");
      const photograph = () => photographAround(page, label);
      const focusVisible = () =>
        page.locator("#example-css").evaluate((element) => element.matches(":focus-visible"));

      const unchecked = await photograph();
      await label.click();
      expect(await focusVisible()).toBe(false);
      const checked = await photograph();
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("ArrowRight");
      expect(await focusVisible()).toBe(true);
      const focused = await photograph();

      expect(checked.equals(unchecked)).toBe(false);
      expect(focused.equals(unchecked)).toBe(false);
      expect(focused.equals(checked)).toBe(false);

      await keepScreenshot("forced-colours-css-label-unchecked", async () => unchecked);
      await keepScreenshot("forced-colours-css-label-checked", async () => checked);
      await keepScreenshot("forced-colours-css-label-checked-and-focused", async () => focused);
      await keepScreenshot("forced-colours-control-checked-and-focused", () =>
        photographAround(page, page.locator(".example-choices")),
      );

      const ring = await computed(label, ["outline-style", "outline-width"] as const);
      expect(ring["outline-style"]).toBe("solid");
      expect(Number.parseFloat(ring["outline-width"])).toBeGreaterThanOrEqual(2);
    } finally {
      await context.close();
    }
  });
});

describe.each(SCHEMES)("axe in the %s scheme", (scheme) => {
  it("reports no violation with each of the four panels showing", async () => {
    // The live table loads once it scrolls near, so the test scrolls to it, and axe checks it too.
    const { context, page } = await openPage({ colorScheme: scheme, height: 1000 });
    try {
      await page.locator(".live bcd-compat-table").scrollIntoViewIfNeeded();
      await page.waitForFunction(
        () => document.querySelectorAll("bcd-compat-table[loaded]").length === 5,
      );
      for (const example of EXAMPLES) {
        await labelFor(page, example.id).click();
        await page.mouse.move(0, 0);
        const { violations, passes } = await new AxeBuilder({ page }).analyze();
        expect(
          violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) })),
          `${example.id} panel in ${scheme}`,
        ).toEqual([]);
        // Guards against a run that checked nothing: axe passed its colour contrast rule here.
        expect(passes.map(({ id }) => id)).toContain("color-contrast");
      }
    } finally {
      await context.close();
    }
    // Four axe runs take about two seconds alone, and more while other test files share the CPU.
  }, 30_000);
});
