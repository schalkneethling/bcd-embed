// The element inside React 19.3.1, Vue 3.5.45, and Svelte 5.57.3 (issue #207), in Chromium,
// Firefox, and WebKit. Each framework has one page (e2e/frameworks/<name>/), and every test runs
// against two builds of it: Vite's dev server, and the production build that the global setup
// writes. The pages record the events that the framework's own listener syntax receives, so a
// passing test shows that the framework wired the listener, not only that the element fired.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { FRAMEWORK_DEV_PORT, FRAMEWORK_PRODUCTION_PORT } from "./frameworks/ports.js";

const FRAMEWORKS = ["react", "vue", "svelte"] as const;
type Framework = (typeof FRAMEWORKS)[number];

const BUILDS = [
  { name: "dev", origin: `http://127.0.0.1:${FRAMEWORK_DEV_PORT}` },
  { name: "production", origin: `http://127.0.0.1:${FRAMEWORK_PRODUCTION_PORT}` },
] as const;
type Build = (typeof BUILDS)[number];

// What each framework does with `data` when it renders the element before the element is defined
// and the page uses the framework's ordinary binding. React and Vue test `data in element` when
// they apply the prop, and the property does not exist yet, so each writes the attribute
// `data="[object Object]"`, which the element never reads. Svelte sets an object as a property
// while the element is undefined, and Lit keeps a property set before the upgrade.
const PLAIN_BINDING_AFTER_DEFINE: Record<Framework, "lost" | "kept"> = {
  react: "lost",
  vue: "lost",
  svelte: "kept",
};

// Svelte creates its markup with `document.importNode`. In WebKit 27.2 (Playwright 1.65.1, macOS),
// an element that `importNode` made while nothing had read `window.customElements` yet is never
// upgraded by a later `customElements.define`, nor by `customElements.upgrade`. The reproduction
// below uses no framework. A page that imports the element first never meets it, which is the
// recommended order. The production build of the Svelte page meets it because nothing there reads
// `customElements` before Svelte mounts.
//
// The dev build of the Svelte page passes in WebKit only because Vite's dev client script defines
// `vite-error-overlay` first, which reads `customElements` before Svelte mounts. A Vite change
// could remove that read. If the Svelte dev tests in WebKit start to fail with an element that is
// not `:defined`, this is the cause, not the element.
//
// The affected tests assert the symptom instead of using `test.fail`. `test.fail` passes on any
// failure, so a different breakage in the same test would stay green. The symptom check passes
// only when the element is not defined and the fallback is still showing, so a fixed engine and
// an unrelated failure both turn the test red.
const WEBKIT_UPGRADE_BUG =
  "WebKit 27.2 never upgrades an element that document.importNode made before window.customElements was first read.";

const webkitNeverUpgrades = (browserName: string, framework: Framework, build: Build): boolean =>
  browserName === "webkit" && framework === "svelte" && build.name === "production";

/** The symptom of the WebKit bug: the element stays undefined and the fallback stays visible. */
const expectNeverUpgraded = async (page: Page): Promise<void> => {
  expect(
    await page.evaluate(() => document.querySelector("bcd-compat-table")?.matches(":defined")),
  ).toBe(false);
  await expect(page.locator("#table > p")).toBeVisible();
  await expect(page.locator("#table[loaded]")).toHaveCount(0);
  expect(await page.locator("#table table").count()).toBe(0);
};

type OpenedPage = {
  /** The text of every `console.error` and every uncaught exception. */
  readonly errors: string[];
  /** The text of every console message of any type. */
  readonly messages: string[];
};

/** Opens a framework page with a scenario and waits until the framework and the element are in. */
const open = async (
  page: Page,
  framework: Framework,
  build: Build,
  query = "",
): Promise<OpenedPage> => {
  const opened: OpenedPage = { errors: [], messages: [] };
  page.on("console", (message) => {
    opened.messages.push(message.text());
    if (message.type() === "error") opened.errors.push(message.text());
  });
  page.on("pageerror", (error) => opened.errors.push(error.message));
  await page.goto(`${build.origin}/e2e/frameworks/${framework}/index.html?${query}`);
  await page.locator("body[data-ready]").waitFor({ state: "attached" });
  return opened;
};

/** The rendered table, which exists once the element has rendered a payload. */
const loadedTable = (page: Page) => page.locator("#table[loaded] table");

/** What the element reports about its `data`, and what the page's listeners received. */
const inspect = (page: Page) =>
  page.evaluate(() => {
    const element = document.querySelector("bcd-compat-table");
    return {
      sameObject: element?.data === window.bcdPage.payload,
      hasDataAttribute: element?.hasAttribute("data") ?? false,
      dataAttribute: element?.getAttribute("data") ?? null,
      dataIsNull: element?.data === null,
      undefinedAtFirstRender: window.bcdPage.undefinedAtFirstRender,
      loads: window.bcdPage.loads,
      errors: window.bcdPage.errors,
    };
  });

/** The text nodes that are direct children of the element: the author's string fallback. */
const ownText = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelector("bcd-compat-table")?.childNodes ?? [])
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent?.trim())
      .filter((text) => text !== ""),
  );

for (const framework of FRAMEWORKS) {
  for (const build of BUILDS) {
    test.describe(`${framework}, ${build.name} build`, () => {
      test("sets data as a property, and the framework's own listener receives bcd-load", async ({
        page,
      }) => {
        const opened = await open(page, framework, build);
        await loadedTable(page).waitFor();

        const state = await inspect(page);
        // `element.data` is the very object the page passed, and the attribute was never written.
        expect(state.sameObject).toBe(true);
        expect(state.hasDataAttribute).toBe(false);
        // The element was already defined when the framework rendered.
        expect(state.undefinedAtFirstRender).toBe(false);
        expect(state.loads).toEqual([{ mode: "data", snapshot: null }]);
        expect(state.errors).toEqual([]);
        expect(opened.errors).toEqual([]);
      });

      test("keeps the table and the author's child through a re-render with changed props", async ({
        page,
      }) => {
        const opened = await open(page, framework, build);
        await loadedTable(page).waitFor();
        await expect(page.getByRole("columnheader", { name: "Opera" })).toHaveCount(0);

        // The element hid its fallback when the table rendered. Keep a reference to the node, so
        // the test can tell the node that is still there from a replacement.
        await page.locator("#table > p").evaluate((child) => {
          Object.assign(window, { fallbackChild: child });
        });
        await expect(page.locator("#table > p")).toBeHidden();

        await page.locator("#rerender").click();

        // The changed `browsers` prop reached the element, so the table has the new column.
        await expect(page.getByRole("columnheader", { name: "Opera" })).toBeVisible();
        await expect(page.locator("#table > .bcd-render-container")).toHaveCount(1);
        const child = await page.locator("#table > p").evaluate((node) => ({
          sameNode: node === Reflect.get(window, "fallbackChild"),
          text: node.textContent,
          hidden: getComputedStyle(node).display === "none",
        }));
        // The framework updated the hidden child in place, and the element left it alone.
        expect(child).toEqual({ sameNode: true, text: "Fallback, revision 1.", hidden: true });
        // Changing `browsers` is no new payload, so no second `bcd-load` fired.
        expect((await inspect(page)).loads).toHaveLength(1);
        expect(opened.errors).toEqual([]);
      });

      test("restores the table when the framework replaces a single string child", async ({
        page,
      }) => {
        const opened = await open(page, framework, build, "fallback=string");
        await loadedTable(page).waitFor();
        expect(await ownText(page)).toEqual(["Fallback, revision 0."]);
        const rowsBefore = await page.locator("#table tbody tr").count();

        await page.locator("#rerender").click();
        await expect(page.getByRole("columnheader", { name: "Opera" })).toBeVisible();

        // Whether the framework assigned `textContent` (which removes the container) or updated
        // its text node, the element ends up with its one container, and the table is in it.
        await expect(page.locator("#table > .bcd-render-container")).toHaveCount(1);
        await expect(loadedTable(page)).toBeVisible();
        await expect(page.locator("#table tbody tr")).toHaveCount(rowsBefore);
        expect(await ownText(page)).toEqual(["Fallback, revision 1."]);
        expect(opened.errors).toEqual([]);
      });

      test("reports an invalid payload to the framework's bcd-error listener, then recovers", async ({
        page,
      }) => {
        const opened = await open(page, framework, build);
        await loadedTable(page).waitFor();

        await page.locator("#break").click();
        await expect(page.locator("#table:not([loaded])")).toBeAttached();
        await expect(page.locator("#table > p")).toBeVisible();
        expect((await inspect(page)).errors).toEqual([
          { mode: "data", reason: "invalid-payload", status: null, code: null },
        ]);

        await page.locator("#restore").click();
        await expect(loadedTable(page)).toBeVisible();
        expect((await inspect(page)).loads).toHaveLength(2);
        expect(opened.errors).toEqual([]);
      });

      // Svelte has one binding, so its "robust" and "plain" pages are the same page, and the test
      // below covers it. Running both would repeat one test under two names.
      if (framework !== "svelte") {
        test("sets data when the element is defined after the framework rendered it", async ({
          page,
        }) => {
          const opened = await open(page, framework, build, "define=after&binding=robust");
          await loadedTable(page).waitFor();

          const state = await inspect(page);
          // The page rendered before the definition, so the binding is what delivered `data`.
          expect(state.undefinedAtFirstRender).toBe(true);
          expect(state.sameObject).toBe(true);
          expect(state.hasDataAttribute).toBe(false);
          expect(state.loads).toEqual([{ mode: "data", snapshot: null }]);
          expect(opened.errors).toEqual([]);
        });
      }

      test("handles the ordinary binding when the element is defined after the render", async ({
        page,
        browserName,
      }) => {
        const opened = await open(page, framework, build, "define=after");
        // The page rendered before the definition, in every framework and build.
        expect((await inspect(page)).undefinedAtFirstRender).toBe(true);

        if (webkitNeverUpgrades(browserName, framework, build)) {
          test.info().annotations.push({ type: "webkit-bug", description: WEBKIT_UPGRADE_BUG });
          await expectNeverUpgraded(page);
        } else if (PLAIN_BINDING_AFTER_DEFINE[framework] === "kept") {
          await loadedTable(page).waitFor();
          expect((await inspect(page)).sameObject).toBe(true);
          expect((await inspect(page)).hasDataAttribute).toBe(false);
        } else {
          // The framework wrote `data="[object Object]"`. Lit declares `data` with
          // `attribute: false`, so the element never reads it and the payload is lost.
          await expect(page.locator("#table > p")).toBeVisible();
          const state = await inspect(page);
          expect(state.dataAttribute).toBe("[object Object]");
          // The element's constructor sets `data` to `null`, so the property reads `null`.
          expect(state.dataIsNull).toBe(true);
          expect(state.loads).toEqual([]);
          await expect(page.locator("#table[loaded]")).toHaveCount(0);

          // Once the element is defined, the framework sees the property, so the next `data` it
          // is given arrives as a property and the table renders.
          await page.locator("#break").click();
          await page.locator("#restore").click();
          await expect(loadedTable(page)).toBeVisible();
          expect((await inspect(page)).sameObject).toBe(true);
        }
        expect(opened.errors).toEqual([]);
      });

      // The documentation site shows `examples/<framework>/CompatTable.*` as the framework's
      // sample, so this test is what keeps that sample correct.
      test("renders the documentation site's example component", async ({ page }) => {
        const opened = await open(page, framework, build, "example=docs");
        await page.locator("bcd-compat-table[loaded] table").waitFor();

        const state = await inspect(page);
        expect(state.sameObject).toBe(true);
        expect(state.hasDataAttribute).toBe(false);
        // The example's own listener, written in the framework's syntax, received `bcd-load`.
        expect(opened.messages).toContain("Table loaded: data");
        // The example's `browsers` attribute reached the element: without it, the default set
        // would show the fixture's Node.js column.
        await expect(page.getByRole("columnheader", { name: "Chrome" })).toBeVisible();
        await expect(page.getByRole("columnheader", { name: "Node.js" })).toHaveCount(0);
        await expect(page.locator("bcd-compat-table > p")).toBeHidden();
        expect(opened.errors).toEqual([]);
      });

      test(`${build.name === "dev" ? "loads" : "does not load"} Lit's development build`, async ({
        page,
      }) => {
        const opened = await open(page, framework, build);
        await loadedTable(page).waitFor();

        // Lit writes this warning when its development build loads (issue #206 relies on it too).
        // It tells the two builds apart, so the production tests are known to test production.
        const warned = opened.messages.some((message) => message.includes("Lit is in dev mode"));
        expect(warned).toBe(build.name === "dev");
      });
    });
  }

  if (framework === "svelte") {
    // The engine behaviour that the Svelte tests above meet, without a framework or the element.
    test("an element that importNode made before customElements was read is upgraded by define", async ({
      page,
      browserName,
    }) => {
      await page.setContent(`<!doctype html><div id="app"></div>`);
      const upgraded = await page.evaluate(() => {
        const template = document.createElement("template");
        template.innerHTML = "<main><x-importer></x-importer></main>";
        const copy = document.importNode(template.content.firstChild as Node, true) as Element;
        document.body.append(copy);
        // This is the first read of `window.customElements` on the page.
        customElements.define("x-importer", class extends HTMLElement {});
        return copy.firstElementChild?.matches(":defined");
      });
      // WebKit is expected not to upgrade it; the test turns red when a release fixes that.
      expect(upgraded).toBe(browserName !== "webkit");
    });
  }

  if (framework !== "react") {
    // `ref` in Vue and `$state` in Svelte make an object deeply reactive, so a page that keeps the
    // payload there passes a Proxy, not the payload.
    test(`${framework}: a deeply reactive payload reaches the element as a proxy that still renders`, async ({
      page,
    }) => {
      const opened = await open(page, framework, BUILDS[0], "state=deep");
      await loadedTable(page).waitFor();

      const state = await inspect(page);
      expect(state.sameObject).toBe(false);
      expect(state.loads).toEqual([{ mode: "data", snapshot: null }]);
      expect(opened.errors).toEqual([]);
    });
  }
}
