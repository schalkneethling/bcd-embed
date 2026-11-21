// A throwaway consumer project that installs the built package and builds with Vite in production
// mode, the way a page that depends on `@bcd-embed/element` does (issue #206). The consumer reaches
// the package through `node_modules/@bcd-embed/element`, so the build follows the package's own
// `exports` and `sideEffects` fields, not a path alias to the source.
import { createServer } from "node:http";
import type { Server } from "node:http";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import type { Browser } from "playwright";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

// Lit announces itself by writing these arrays to `globalThis` when its modules run. They survive
// minification because they are property names, so their presence in a built file means that the
// build kept Lit's code, and their absence means that it did not.
const LIT_MARKERS = ["litHtmlVersions", "reactiveElementVersions", "litElementVersions"];

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
};

type ConsumerSource = {
  /** The consumer's `main.ts`. */
  readonly main: string;
  /** Replaces `sideEffects` in the installed copy of the package's `package.json`. */
  readonly sideEffects?: boolean;
};

type ConsumerBuild = {
  /** The directory that holds the built page. */
  readonly outDir: string;
  /** Every JavaScript file of the build, joined into one string. */
  readonly script: string;
};

// The consumer's root, one for the whole file. Each build gets its own subdirectory.
let workspace = "";
let buildCount = 0;

// Installs the package into a new consumer project, then builds the consumer. The package is built
// into its installed location, so the consumer reads `package.json` and `dist/` and nothing else
// from it. `lit` and `@lit/task` are links to the copies the package itself resolves, which stands
// in for the install that a registry package triggers through its `dependencies`.
const buildConsumer = async ({ main, sideEffects }: ConsumerSource): Promise<ConsumerBuild> => {
  buildCount += 1;
  const root = join(workspace, `consumer-${buildCount}`);
  const installed = join(root, "node_modules", "@bcd-embed", "element");
  await mkdir(installed, { recursive: true });

  await build({
    root: packageRoot,
    configFile: join(packageRoot, "vite.config.ts"),
    mode: "lib",
    logLevel: "silent",
    build: { outDir: join(installed, "dist"), emptyOutDir: true },
  });

  const manifest: Record<string, unknown> = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  );
  if (sideEffects !== undefined) manifest.sideEffects = sideEffects;
  await writeFile(join(installed, "package.json"), JSON.stringify(manifest));

  for (const dependency of ["lit", "@lit/task"]) {
    const target = await realpath(join(packageRoot, "node_modules", dependency));
    const link = join(root, "node_modules", dependency);
    await mkdir(join(link, ".."), { recursive: true });
    await symlink(target, link, "dir");
  }

  await writeFile(join(root, "main.ts"), main);
  await writeFile(
    join(root, "index.html"),
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Consumer</title></head>' +
      '<body><script type="module" src="./main.ts"></script></body></html>',
  );

  const outDir = join(root, "built");
  await build({
    root,
    configFile: false,
    mode: "production",
    logLevel: "silent",
    build: { outDir, emptyOutDir: true },
  });

  const assets = join(outDir, "assets");
  const scripts = (await readdir(assets)).filter((name) => name.endsWith(".js"));
  const script = (
    await Promise.all(scripts.map((name) => readFile(join(assets, name), "utf8")))
  ).join("\n");
  return { outDir, script };
};

// Serves a built page over HTTP, because a browser refuses to load an ES module from `file:`.
const serve = async (directory: string): Promise<{ server: Server; url: string }> => {
  const server = createServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0] ?? "/";
    const file = join(directory, path === "/" ? "index.html" : path);
    readFile(file).then(
      (body) => {
        response.writeHead(200, { "content-type": CONTENT_TYPES[extname(file)] ?? "text/plain" });
        response.end(body);
      },
      () => {
        response.writeHead(404);
        response.end();
      },
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("The server has no port.");
  return { server, url: `http://127.0.0.1:${address.port}/` };
};

// Loads a built page in Chromium and reports whether the element is defined once it has run, with
// every error that the page raised.
const runPage = async (
  browser: Browser,
  directory: string,
): Promise<{ defined: boolean; errors: string[] }> => {
  const { server, url } = await serve(directory);
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(url, { waitUntil: "load" });
    const defined = await page.evaluate(() => customElements.get("bcd-compat-table") !== undefined);
    return { defined, errors };
  } finally {
    await page.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
};

const sideEffectImport = 'import "@bcd-embed/element";\n';

const typeOnlyImport = [
  'import type { BcdCompatTableElement } from "@bcd-embed/element";',
  'const table: BcdCompatTableElement | null = document.querySelector("bcd-compat-table");',
  "console.log(table?.query);",
  "",
].join("\n");

describe("a consumer that builds with Vite in production mode", () => {
  let browser: Browser;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "bcd-embed-consumer-"));
    browser = await chromium.launch();
  }, 60_000);
  afterAll(async () => {
    await browser.close();
    await rm(workspace, { recursive: true, force: true });
  });

  it("defines bcd-compat-table when the built page runs", async () => {
    const consumer = await buildConsumer({ main: sideEffectImport });

    expect(await runPage(browser, consumer.outDir)).toEqual({ defined: true, errors: [] });
    // Without these markers the next test would pass for a build that never contained Lit.
    for (const marker of LIT_MARKERS) expect(consumer.script).toContain(marker);
  }, 60_000);

  it("ships no Lit code when the consumer imports only a type", async () => {
    const consumer = await buildConsumer({ main: typeOnlyImport });

    for (const marker of LIT_MARKERS) expect(consumer.script).not.toContain(marker);
    expect(await runPage(browser, consumer.outDir)).toEqual({ defined: false, errors: [] });
  }, 60_000);

  // The reason `sideEffects` is an array. A bare `false` tells the bundler that a bare
  // `import "@bcd-embed/element"` has no effect, so it drops the module and nothing defines the
  // element. This test shows that the first one would fail under that change.
  it("leaves the element undefined when sideEffects is false", async () => {
    const consumer = await buildConsumer({ main: sideEffectImport, sideEffects: false });

    expect(await runPage(browser, consumer.outDir)).toEqual({ defined: false, errors: [] });
  }, 60_000);
});
