// A throwaway consumer project that installs the built package and builds with Vite in production
// mode, the way a page that depends on `@bcd-embed/element` does (issue #206). The consumer reaches
// the package through `node_modules/@bcd-embed/element`, so the build follows the package's own
// `exports` and `sideEffects` fields, not a path alias to the source.
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { Server } from "node:http";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { chromium } from "playwright";
import type { Browser } from "playwright";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const schemaSource = fileURLToPath(new URL("../../schema/src/index.ts", import.meta.url));

// Lit announces itself by writing these arrays to `globalThis` when its modules run. They survive
// minification because they are property names, so their presence in a built file means that the
// build kept Lit's code, and their absence means that it did not.
const LIT_MARKERS = ["litHtmlVersions", "reactiveElementVersions", "litElementVersions"];

// Lit's development build, which the `development` export condition selects, logs this text when
// it loads. The production build does not contain it.
const LIT_DEV_MODE_WARNING = "Lit is in dev mode";

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
  /**
   * The `NODE_ENV` of the consumer's build. Vite reads it to choose the `development` or the
   * `production` export condition, and it is "production" unless a test says otherwise.
   */
  readonly nodeEnv?: string;
  /** Whether to install the package's type declarations beside `dist/index.js`. */
  readonly declarations?: boolean;
};

type ConsumerBuild = {
  /** The consumer's project directory. */
  readonly root: string;
  /** The directory that holds the built page. */
  readonly outDir: string;
  /** Every JavaScript file of the build, joined into one string. */
  readonly script: string;
  /** Every CSS file of the build, joined into one string. */
  readonly styles: string;
};

// The consumer's root, one for the whole file. Each build gets its own subdirectory.
let workspace = "";
let buildCount = 0;

const require = createRequire(import.meta.url);
const tsc = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");

// Vitest runs with `NODE_ENV=test`, and Vite fills `NODE_ENV` in only when it is unset, so a build
// started from a test would otherwise resolve the development build of Lit. The variable is set
// for the one build and put back afterwards.
const buildWithNodeEnv = async (nodeEnv: string, run: () => Promise<unknown>): Promise<void> => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = nodeEnv;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
};

// Emits the package's declarations the way `tsconfig.build.json` does, into a temporary directory,
// and copies them next to `dist/index.js` of the installed package. The configuration extends the
// package's `tsconfig.json`, whose `paths` point at the schema package's source, so the test does
// not need `@bcd-embed/schema` built first. `tsc` finds `@types/node` from a directory under
// `node_modules/.cache` inside the package.
const installDeclarations = async (installedDist: string): Promise<void> => {
  const cache = join(packageRoot, "node_modules", ".cache");
  await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(join(cache, "consumer-declarations-"));
  try {
    const outDir = join(directory, "out");
    await writeFile(
      join(directory, "tsconfig.json"),
      JSON.stringify({
        extends: join(packageRoot, "tsconfig.json"),
        compilerOptions: {
          declaration: true,
          emitDeclarationOnly: true,
          noEmit: false,
          outDir,
          rootDir: join(packageRoot, ".."),
        },
        include: [join(packageRoot, "src/**/*.ts")],
      }),
    );
    await promisify(execFile)(process.execPath, [tsc, "--project", directory]);
    await cp(join(outDir, "element", "src"), installedDist, { recursive: true });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

// Installs the package into a new consumer project, then builds the consumer. The package is built
// into its installed location, so the consumer reads `package.json` and `dist/` and nothing else
// from it. `lit` and `@lit/task` are links to the copies the package itself resolves, which stands
// in for the install that a registry package triggers through its `dependencies`.
const buildConsumer = async ({
  main,
  sideEffects,
  nodeEnv = "production",
  declarations = false,
}: ConsumerSource): Promise<ConsumerBuild> => {
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
  if (declarations) await installDeclarations(join(installed, "dist"));

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
  await buildWithNodeEnv(nodeEnv, () =>
    build({
      root,
      configFile: false,
      mode: "production",
      logLevel: "silent",
      build: { outDir, emptyOutDir: true },
    }),
  );

  const assets = join(outDir, "assets");
  const readAssets = async (extension: string): Promise<string> => {
    const names = (await readdir(assets)).filter((name) => name.endsWith(extension));
    return (await Promise.all(names.map((name) => readFile(join(assets, name), "utf8")))).join(
      "\n",
    );
  };
  return { root, outDir, script: await readAssets(".js"), styles: await readAssets(".css") };
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

// Runs the TypeScript compiler on `typecheck.ts` in a consumer project and returns its exit code
// and output. The consumer's `paths` entry stands in for the install of `@bcd-embed/schema` that
// the declarations import their types from.
const typecheck = async (
  root: string,
  source: string,
): Promise<{ code: number; output: string }> => {
  await writeFile(join(root, "typecheck.ts"), source);
  await writeFile(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "es2022",
        module: "esnext",
        moduleResolution: "bundler",
        lib: ["es2022", "dom"],
        types: [],
        strict: true,
        noEmit: true,
        paths: { "@bcd-embed/schema": [schemaSource] },
      },
      include: ["typecheck.ts"],
    }),
  );
  try {
    await promisify(execFile)(process.execPath, [tsc, "--project", root]);
    return { code: 0, output: "" };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string };
    return { code: failure.code ?? 1, output: failure.stdout ?? "" };
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
  let browser: Browser | undefined;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "bcd-embed-consumer-"));
    browser = await chromium.launch();
  }, 60_000);
  afterAll(async () => {
    try {
      await browser?.close();
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  const launched = (): Browser => {
    if (browser === undefined) throw new Error("The browser did not launch.");
    return browser;
  };

  it("defines bcd-compat-table when the built page runs, with Lit's production build", async () => {
    const consumer = await buildConsumer({ main: sideEffectImport });

    expect(await runPage(launched(), consumer.outDir)).toEqual({ defined: true, errors: [] });
    // Without these markers the type-only test would pass for a build that never contained Lit.
    for (const marker of LIT_MARKERS) expect(consumer.script).toContain(marker);
    expect(consumer.script).not.toContain(LIT_DEV_MODE_WARNING);
  }, 60_000);

  // The check above only means something if a development build does contain the warning.
  it("builds Lit's development build, with its warning, when NODE_ENV is development", async () => {
    const consumer = await buildConsumer({ main: sideEffectImport, nodeEnv: "development" });

    expect(consumer.script).toContain(LIT_DEV_MODE_WARNING);
  }, 60_000);

  // Every value that the entry exports is in `dist/index.js`, and that file is a side-effect file
  // that holds the `customElements.define` call. A value import such as `en` therefore defines the
  // element and brings in Lit. No import that reaches a value of the package avoids Lit, so the
  // only Lit-free consumer is one that imports types.
  it("brings in Lit and defines the element when the consumer imports a value", async () => {
    const consumer = await buildConsumer({
      main: 'import { en } from "@bcd-embed/element";\nconsole.log(en);\n',
    });

    for (const marker of LIT_MARKERS) expect(consumer.script).toContain(marker);
    expect(await runPage(launched(), consumer.outDir)).toEqual({ defined: true, errors: [] });
  }, 60_000);

  // `import type` is erased before the bundler resolves anything, so this build cannot fail on
  // account of the package. It shows only that a type-only consumer ships no Lit; the next test
  // checks that the types resolve.
  it("ships no Lit code when the consumer imports only a type", async () => {
    const consumer = await buildConsumer({ main: typeOnlyImport });

    for (const marker of LIT_MARKERS) expect(consumer.script).not.toContain(marker);
    expect(await runPage(launched(), consumer.outDir)).toEqual({ defined: false, errors: [] });
  }, 60_000);

  it("type-checks against the declarations that `exports` names", async () => {
    const consumer = await buildConsumer({ main: typeOnlyImport, declarations: true });

    // `table` is typed through `HTMLElementTagNameMap`, which the declarations augment. The
    // `@ts-expect-error` line fails the compile if `table` were `any`, so it shows that the
    // types are the package's and not a fallback.
    const accepted = await typecheck(
      consumer.root,
      [
        "import type {",
        "  BcdCompatTableElement,",
        "  CompatTableData,",
        '} from "@bcd-embed/element";',
        'const table = document.querySelector("bcd-compat-table");',
        "const element: BcdCompatTableElement | null = table;",
        'const loading: "lazy" | "eager" | undefined = table?.loading;',
        "const query: string | null | undefined = table?.query;",
        "const data: CompatTableData | null | undefined = table?.data;",
        "// @ts-expect-error The element has no property named missing.",
        "table?.missing;",
        "export { data, element, loading, query };",
        "",
      ].join("\n"),
    );
    expect(accepted).toEqual({ code: 0, output: "" });

    // A name that the package does not export must fail, which shows that the compile resolved
    // the package through `exports` and read its declarations.
    const rejected = await typecheck(
      consumer.root,
      'import type { NotExported } from "@bcd-embed/element";\nexport type { NotExported };\n',
    );
    expect(rejected.code).not.toBe(0);
    expect(rejected.output).toContain("NotExported");
  }, 120_000);

  // The `./base.css` export is a plain string with no condition, so the bundler maps the import
  // to `dist/base.css`. Vite minifies the CSS of an app build with lightningcss by default, which
  // drops the `@layer bcd-embed.base;` statement and lowers `light-dark()` (issue #246 tracks
  // it), so the assertions are on text that survives: the layer block and a rule inside it.
  it("resolves @bcd-embed/element/base.css through exports", async () => {
    const consumer = await buildConsumer({ main: 'import "@bcd-embed/element/base.css";\n' });

    expect(consumer.styles).toContain("@layer bcd-embed.base{");
    expect(consumer.styles).toContain(".bcd-render-container");
    expect(consumer.script).not.toContain("customElements");
  }, 60_000);

  // The reason `sideEffects` is an array. A bare `false` tells the bundler that a bare
  // `import "@bcd-embed/element"` has no effect, so it drops the module and nothing defines the
  // element. This test shows that the first one would fail under that change.
  it("leaves the element undefined when sideEffects is false", async () => {
    const consumer = await buildConsumer({ main: sideEffectImport, sideEffects: false });

    expect(await runPage(launched(), consumer.outDir)).toEqual({ defined: false, errors: [] });
  }, 60_000);
});
