// The web component's pages on the documentation site (issue #208). The pages must not drift from
// the element: every name they use must exist, every code sample must be an excerpt of a file that
// a test runs, and the live example on the getting-started page must work with and without script,
// under the site's own Content Security Policy.
import { readdir, readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import type { Browser, Worker } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { v1NormalizedFixture } from "../packages/schema/src/fixtures/v1.js";
import { buildWebsite } from "./website-build.js";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const websiteDirectory = join(repositoryRoot, "apps/website");
const pagesDirectory = join(websiteDirectory, "src/content/docs/component");
const elementDirectory = join(repositoryRoot, "packages/element");

type Page = { readonly name: string; readonly text: string };

const readPages = async (): Promise<Page[]> => {
  const names = (await readdir(pagesDirectory)).filter((name) => /\.mdx?$/.test(name));
  return Promise.all(
    names.map(async (name) => ({ name, text: await readFile(join(pagesDirectory, name), "utf8") })),
  );
};

const pageNamed = (pages: Page[], name: string): Page => {
  const page = pages.find((candidate) => candidate.name === name);
  if (page === undefined) throw new Error(`There is no page ${name}`);
  return page;
};

type CodeBlock = {
  readonly page: string;
  readonly language: string;
  readonly lines: string[];
  /** The file named by a `sample:` comment on the line before the fence, if there is one. */
  readonly sample: string | null;
};

// A Markdown page marks a sample with `<!-- sample: path -->` and an MDX page with
// `{/* sample: path */}`, because MDX does not accept HTML comments.
const SAMPLE_MARKER = /^(?:<!--|\{\/\*)\s*sample:\s*(\S+)\s*(?:-->|\*\/\})$/;

const codeBlocks = (page: Page): CodeBlock[] => {
  const blocks: CodeBlock[] = [];
  const lines = page.text.split("\n");
  let open: { fence: string; language: string; lines: string[]; sample: string | null } | null =
    null;
  let previous = "";
  for (const line of lines) {
    if (open === null) {
      const start = /^(`{3,})(\S*)/.exec(line);
      if (start !== null) {
        const marker = SAMPLE_MARKER.exec(previous.trim());
        open = {
          fence: start[1] ?? "```",
          language: start[2] ?? "",
          lines: [],
          sample: marker?.[1] ?? null,
        };
      } else if (line.trim() !== "") {
        previous = line;
      }
    } else if (line.startsWith(open.fence) && line.trim() === open.fence) {
      blocks.push({ page: page.name, ...open });
      open = null;
      previous = "";
    } else {
      open.lines.push(line);
    }
  }
  return blocks;
};

const indentOf = (line: string): number => line.length - line.trimStart().length;

/** Removes the indentation that every non-blank line shares. */
const dedent = (lines: string[]): string[] => {
  const indents = lines.filter((line) => line.trim() !== "").map(indentOf);
  const common = indents.length === 0 ? 0 : Math.min(...indents);
  return lines.map((line) => line.slice(common).trimEnd());
};

/**
 * Whether the block's lines appear in the file as consecutive lines, with any indentation they
 * share there removed. O(F × B) for F lines in the file and B in the block, which is small.
 */
const isExcerptOf = (file: string, block: string[]): boolean => {
  const fileLines = file.split("\n");
  const wanted = dedent(block).join("\n");
  for (let start = 0; start + block.length <= fileLines.length; start += 1) {
    if (dedent(fileLines.slice(start, start + block.length)).join("\n") === wanted) return true;
  }
  return false;
};

/** A partial excerpt shorter than this matches too many files to prove where it came from. */
const MIN_EXCERPT_LINES = 3;

/**
 * Samples outside `packages/element/examples/`, each run by a test: the Vite configuration of the
 * framework pages, which `e2e/frameworks.e2e.ts` builds and serves.
 */
const OTHER_SAMPLES = new Set(["packages/element/e2e/frameworks/vite.config.ts"]);

/**
 * The one command that cannot be checked here, because it reaches the npm registry. The package is
 * a beta, so the command names the `beta` dist-tag.
 */
const INSTALL = "npm install @schalkneethling/bcd-embed@beta";

/** The directory of each workspace a command may name with `--filter`. */
const WORKSPACES: Record<string, string> = {
  "@schalkneethling/bcd-embed": "packages/element",
  "@bcd-embed/website": "apps/website",
};

/**
 * Checks each line of a shell block: the install, or a pnpm script that exists in the
 * root `package.json` or, with `--filter`, in that workspace's `package.json`.
 */
const shellProblems = async (block: CodeBlock): Promise<string[]> => {
  const problems: string[] = [];
  for (const line of block.lines.map((entry) => entry.trim()).filter((entry) => entry !== "")) {
    if (line === INSTALL) continue;
    const filtered = /^pnpm --filter (\S+) (?:run )?([\w:-]+)$/.exec(line);
    const root = /^pnpm (?:run )?([\w:-]+)$/.exec(line);
    const directory = filtered ? WORKSPACES[filtered[1] ?? ""] : root ? "." : undefined;
    const script = filtered?.[2] ?? root?.[1];
    if (directory === undefined || script === undefined) {
      problems.push(`${block.page}: "${line}" is not a known command`);
      continue;
    }
    const manifest = JSON.parse(
      await readFile(join(repositoryRoot, directory, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    if (manifest.scripts?.[script] === undefined) {
      problems.push(`${block.page}: "${line}" names no script in ${directory}/package.json`);
    }
  }
  return problems;
};

/**
 * Checks one code block: a shell block by `shellProblems`, and any other block against the file
 * its `sample:` comment names. The block must be that whole file, or at least
 * `MIN_EXCERPT_LINES` consecutive lines of it.
 */
const sampleProblems = async (block: CodeBlock): Promise<string[]> => {
  if (block.language === "sh") return shellProblems(block);
  if (block.sample === null)
    return [`${block.page}: a ${block.language} block has no sample comment`];
  // `examples/` is run by `browser/docs-examples.browser.test.ts` and `e2e/frameworks.e2e.ts`,
  // and `tests/examples.test.ts` checks that a test imports each file.
  if (!block.sample.startsWith("packages/element/examples/") && !OTHER_SAMPLES.has(block.sample)) {
    return [`${block.page}: ${block.sample} is not an example file`];
  }
  const file = await readFile(join(repositoryRoot, normalize(block.sample)), "utf8");
  if (dedent(block.lines).join("\n").trim() === file.trim()) return [];
  if (block.lines.length < MIN_EXCERPT_LINES) {
    return [`${block.page}: a ${block.language} block from ${block.sample} is too short`];
  }
  return isExcerptOf(file, block.lines)
    ? []
    : [`${block.page}: a ${block.language} block is not in ${block.sample}`];
};

/** The first cell of each row of the first table whose header's first cell is `header`. */
const firstColumn = (page: Page, header: string): string[] => {
  const lines = page.text.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^\\|\\s*${header}\\s*\\|`).test(line));
  if (start === -1) throw new Error(`${page.name} has no table headed "${header}"`);
  const cells: string[] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    const cell = line.split("|")[1]?.trim() ?? "";
    for (const match of cell.matchAll(/`([^`]+)`/g)) cells.push(match[1] ?? "");
  }
  return cells;
};

/** Every inline code span and every fenced block, which is where the pages write names. */
const codeText = (page: Page): string =>
  [
    ...Array.from(page.text.matchAll(/`([^`\n]+)`/g), (match) => match[1] ?? ""),
    ...codeBlocks(page).map((block) => block.lines.join("\n")),
  ].join("\n");

type Manifest = {
  modules: {
    declarations?: {
      tagName?: string;
      members?: { kind: string; name: string; privacy?: string }[];
      attributes?: { name: string }[];
      events?: { name: string }[];
    }[];
  }[];
};

const readElementSurface = async () => {
  const manifest = JSON.parse(
    await readFile(join(elementDirectory, "custom-elements.json"), "utf8"),
  ) as Manifest;
  const element = manifest.modules
    .flatMap((module) => module.declarations ?? [])
    .find((declaration) => declaration.tagName === "bcd-compat-table");
  if (element === undefined) throw new Error("The manifest has no bcd-compat-table");
  const fields = (element.members ?? []).filter(
    (member) => member.kind === "field" && member.privacy !== "private",
  );
  return {
    tagName: "bcd-compat-table",
    inputs: new Set([
      ...(element.attributes ?? []).map((attribute) => attribute.name),
      ...fields.map((field) => field.name),
    ]),
    events: new Set((element.events ?? []).map((event) => event.name)),
  };
};

const readErrorReasons = async (): Promise<Set<string>> => {
  const source = await readFile(join(elementDirectory, "src/public-types.ts"), "utf8");
  const union = /export type BcdErrorReason =([^;]+);/.exec(source)?.[1] ?? "";
  return new Set(Array.from(union.matchAll(/"([a-z-]+)"/g), (match) => match[1] ?? ""));
};

const readStylesheet = async (): Promise<string> => {
  const directory = join(elementDirectory, "src/styles");
  const names = (await readdir(directory)).filter((name) => name.endsWith(".css"));
  const texts = await Promise.all(names.map((name) => readFile(join(directory, name), "utf8")));
  return texts.join("\n");
};

/** The `bcd-` class names the stylesheet styles, with numbered depths written as `{n}`. */
const stylesheetClasses = (css: string): Set<string> =>
  new Set(
    Array.from(css.matchAll(/\.(bcd-[a-z0-9-]+)/g), (match) =>
      (match[1] ?? "").replace(/-\d+$/, "-{n}"),
    ),
  );

/** The `bcd-` class names the element writes, from the string literals of its render code. */
const renderedClasses = async (): Promise<Set<string>> => {
  const files = ["src/render/table.ts", "src/render/error.ts", "src/render/status.ts"];
  const sources = await Promise.all(
    files.map((file) => readFile(join(elementDirectory, file), "utf8")),
  );
  const elementSource = await readFile(join(elementDirectory, "src/bcd-compat-table.ts"), "utf8");
  const names = [...sources, elementSource].flatMap((source) =>
    Array.from(source.matchAll(/"(bcd-[a-z-]+)"/g), (match) => match[1] ?? ""),
  );
  // A literal that ends in a dash is a prefix the renderer completes, such as
  // `bcd-feature-depth-` with the row's depth.
  return new Set(names.map((name) => (name.endsWith("-") ? `${name}{n}` : name)));
};

describe("the component's documentation pages", () => {
  it("cover every input of the element in the attributes and properties table, and no other", async () => {
    const pages = await readPages();
    const surface = await readElementSurface();
    const documented = firstColumn(pageNamed(pages, "attributes-and-properties.md"), "Name");
    expect(new Set(documented)).toEqual(surface.inputs);
    expect(documented).toHaveLength(surface.inputs.size);
  });

  it("name every event and every error reason, and no other reason", async () => {
    const pages = await readPages();
    const surface = await readElementSurface();
    const events = pageNamed(pages, "events.md");
    for (const event of surface.events) expect(events.text).toContain(`\`${event}\``);
    expect(new Set(firstColumn(events, "Reason"))).toEqual(await readErrorReasons());
  });

  it("use only the stylesheet's tokens, and the styling page lists every one", async () => {
    const pages = await readPages();
    const css = await readStylesheet();
    const tokens = new Set(Array.from(css.matchAll(/--bcd-[a-z-]+/g), (match) => match[0]));
    const used = new Set(
      pages.flatMap((page) =>
        Array.from(page.text.matchAll(/--bcd-[a-z-]+/g), (match) => match[0]),
      ),
    );
    expect([...used].filter((token) => !tokens.has(token))).toEqual([]);
    const styling = pageNamed(pages, "styling.md").text;
    expect([...tokens].filter((token) => !styling.includes(`\`${token}\``))).toEqual([]);
  });

  it("use only names the element, its manifest, or its stylesheet defines", async () => {
    const pages = await readPages();
    const surface = await readElementSurface();
    const classes = new Set([
      ...stylesheetClasses(await readStylesheet()),
      ...(await renderedClasses()),
    ]);
    const known = new Set([surface.tagName, ...surface.events, ...classes]);
    // Names that are not the element's API: the project and package name (also the prefix of the
    // layer `bcd-embed.base`), the API's snapshot header, and the `id` convention of source mode.
    // A snapshot name such as `bcd-8.1.9-gen-0.0.0` does not match, because a name starts with a
    // letter after `bcd-`.
    const isOther = (name: string): boolean =>
      name === "bcd-embed" || name === "bcd-embed-snapshot" || /^bcd-data(?:-|$)/.test(name);
    // `bcd-icon-{state}` stands for every name that starts with `bcd-icon-`.
    const isKnownPattern = (name: string): boolean => {
      const prefix = /^(bcd-[a-z-]+-)\{[a-z]+\}$/.exec(name)?.[1];
      return prefix !== undefined && [...known].some((candidate) => candidate.startsWith(prefix));
    };
    const unknown = pages.flatMap((page) =>
      Array.from(codeText(page).matchAll(/(?<![\w-])(bcd-[a-z][a-z0-9-]*(?:\{[a-z]+\})?)/g))
        .map((match) => (match[1] ?? "").replace(/-$/, ""))
        .filter((name) => !known.has(name) && !isOther(name) && !isKnownPattern(name))
        .map((name) => `${page.name}: ${name}`),
    );
    expect(unknown).toEqual([]);

    const styling = pageNamed(pages, "styling.md").text;
    expect([...classes].filter((name) => !styling.includes(name))).toEqual([]);
  });

  it("take every code sample from a file that a test runs", async () => {
    const pages = await readPages();
    const blocks = pages.flatMap(codeBlocks);
    expect(blocks.length).toBeGreaterThan(0);
    const problems: string[] = [];
    for (const block of blocks) problems.push(...(await sampleProblems(block)));
    expect(problems).toEqual([]);
  });

  it("checks samples strictly enough to catch a short, a misplaced, or an invented one", async () => {
    const problemsOf = async (text: string) =>
      (await Promise.all(codeBlocks({ name: "fixture.md", text }).map(sampleProblems))).flat();
    const fence = "```";
    // One line, such as an import, appears in many files, so it proves nothing.
    expect(
      await problemsOf(
        `<!-- sample: packages/element/examples/data-mode.js -->\n${fence}js\nimport "@schalkneethling/bcd-embed";\n${fence}`,
      ),
    ).toHaveLength(1);
    // A file outside the examples, even one that holds the lines.
    expect(
      await problemsOf(
        `<!-- sample: packages/element/src/index.ts -->\n${fence}ts\nexport { en } from "./strings/en.js";\nexport { formatMessage, MissingPlaceholderError, selectStrings } from "./strings/format.js";\n\n${fence}`,
      ),
    ).toHaveLength(1);
    expect(
      await problemsOf(
        `${fence}sh\npnpm --filter @schalkneethling/bcd-embed test:imaginary\n${fence}`,
      ),
    ).toHaveLength(1);
    expect(await problemsOf(`${fence}sh\npnpm add left-pad\n${fence}`)).toHaveLength(1);
    expect(
      await problemsOf(`${fence}sh\npnpm --filter @schalkneethling/bcd-embed test:e2e\n${fence}`),
    ).toEqual([]);
  });

  it("write the source-mode escape as the literal six characters", async () => {
    const dataModes = pageNamed(await readPages(), "data-modes.md").text;
    // A tool that decodes the escape would leave a bare `<` here, which says the opposite.
    expect(dataModes).toContain("with the six characters\n`\\u003c` (a backslash");
    expect(dataModes).toContain("`JSON.parse` turns `\\u003c` back into `<`");
  });
});

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".xml": "application/xml",
  ".txt": "text/plain",
};

/** Reads the report-only policy that `public/_headers` sends with every page. */
const readPolicy = async (): Promise<string> => {
  const headers = await readFile(join(websiteDirectory, "public/_headers"), "utf8");
  const line = headers
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("Content-Security-Policy-Report-Only:"));
  if (line === undefined) throw new Error("_headers sends no report-only policy");
  return line.slice(line.indexOf(":") + 1).trim();
};

// Serves the built site with the policy from `_headers`, as Cloudflare does, so the browser reports
// a violation for anything the policy does not allow.
const serve = async (directory: string, policy: string) => {
  const server: Server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? "/").split("?")[0] ?? "/");
    const file = join(directory, path.endsWith("/") ? `${path}index.html` : path);
    readFile(file).then(
      (body) => {
        response.writeHead(200, {
          "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
          "content-security-policy-report-only": policy,
        });
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
  return { server, origin: `http://127.0.0.1:${address.port}` };
};

/** The violation that Pagefind's worker reports under the site's policy (see the test below). */
const KNOWN_PAGEFIND_VIOLATION = "script-src wasm-eval";

/** The environment without the variables that Vitest and Vite add, and with NODE_ENV=production. */
const productionEnvironment = (): NodeJS.ProcessEnv => {
  const added = /^(?:VITEST.*|TEST|NODE_ENV|MODE|DEV|PROD|SSR|BASE_URL)$/;
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !added.test(name))),
    NODE_ENV: "production",
  };
};

describe("the getting-started page's live example", () => {
  let outDirectory = "";
  let browser: Browser | undefined;
  const servers: Server[] = [];

  // The site is built into a temporary directory, as in `website-deploy.test.ts`, because
  // `pnpm check` runs the tests before the build.
  //
  // These tests run in Chromium only, because the CI `check` job installs only Chromium's headless
  // shell. Firefox 159 and WebKit 27.2 were measured by hand with the same policy, and the
  // deployment page records the result.
  beforeAll(async () => {
    outDirectory = await mkdtemp(join(tmpdir(), "bcd-embed-website-docs-"));
    // Vitest puts its own variables in the environment, among them NODE_ENV=test, and a build
    // that inherits them is not the production build that is deployed: Starlight's search dialog
    // then never shows its search box. The build gets the environment without them.
    await buildWebsite(outDirectory, productionEnvironment());
    browser = await chromium.launch();
  }, 120_000);

  afterAll(async () => {
    try {
      await browser?.close();
      await Promise.all(
        servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
      );
    } finally {
      if (outDirectory !== "") await rm(outDirectory, { recursive: true, force: true });
    }
  });

  const launched = (): Browser => {
    if (browser === undefined) throw new Error("The browser did not launch.");
    return browser;
  };

  /** Serves the built site with a policy and returns the getting-started page's address. */
  const exampleUrl = async (policy: string): Promise<string> => {
    const { server, origin } = await serve(outDirectory, policy);
    servers.push(server);
    return `${origin}/component/getting-started/`;
  };

  const fallbackLink =
    '.live-example bcd-compat-table > p > a[href="https://developer.mozilla.org/en-US/docs/Web/CSS/display#browser_compatibility"]';

  it("shows the fallback link to MDN Web Docs when script is turned off", async () => {
    const context = await launched().newContext({ javaScriptEnabled: false });
    try {
      const page = await context.newPage();
      await page.goto(await exampleUrl(await readPolicy()));
      await page.locator(fallbackLink).waitFor({ state: "visible" });
      expect(await page.locator(".live-example table").count()).toBe(0);
    } finally {
      await context.close();
    }
  });

  type Visit = {
    readonly violations: string[];
    readonly requests: string[];
    readonly errors: string[];
    readonly fallbackVisible: boolean;
  };

  /**
   * Opens the page under a policy, waits for the live example's table, then opens the search
   * dialog and types a query, which loads the search index from the site. It returns every
   * `securitypolicyviolation` the page reported, as "directive address".
   */
  const visit = async (policy: string): Promise<Visit> => {
    const context = await launched().newContext();
    try {
      const page = await context.newPage();
      const requests: string[] = [];
      // Playwright answers for the hosted API, so the test sends nothing to production. The
      // policy is checked before a request leaves the page, so a missing `connect-src` entry is
      // still reported.
      await page.route("https://api.browser-compat.dev/**", async (route) => {
        requests.push(route.request().url());
        await route.fulfill({
          status: 200,
          headers: {
            "content-type": "application/json",
            "access-control-allow-origin": "*",
            "access-control-expose-headers": "etag, retry-after, bcd-embed-snapshot",
            "bcd-embed-snapshot": "bcd-8.1.9-gen-0.0.0",
          },
          body: JSON.stringify({ ...v1NormalizedFixture, query: "css.properties.display" }),
        });
      });
      await page.addInitScript(() => {
        const violations: string[] = [];
        Object.assign(window, { cspViolations: violations });
        document.addEventListener("securitypolicyviolation", (event) => {
          violations.push(`${event.effectiveDirective} ${event.blockedURI}`);
        });
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      // Pagefind fetches its index from a dedicated worker, and a violation in a worker fires on
      // the worker's global scope, not on the document. The worker starts at page load, and it
      // fetches the index and the result fragments only once a query is typed, so a listener
      // added when the worker appears hears those requests.
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

      await page.goto(await exampleUrl(policy));
      // The element is lazy, so it asks once it comes near the viewport.
      await page.locator(".live-example bcd-compat-table").scrollIntoViewIfNeeded();
      await page
        .locator(".live-example bcd-compat-table[loaded] table")
        .waitFor({ state: "visible" });

      // Starlight's search dialog loads Pagefind's index from the site with `fetch`, which is
      // what `'self'` in `connect-src` allows.
      await page.locator("button[data-open-modal]").first().click();
      await page.locator("dialog .pagefind-ui__search-input").fill("component");
      await page.locator("dialog .pagefind-ui__result").first().waitFor({ state: "visible" });

      const workerViolations = await Promise.all(
        workers.map((worker) =>
          worker.evaluate(() => (Reflect.get(self, "cspViolations") as string[] | undefined) ?? []),
        ),
      );
      expect(workers.length).toBeGreaterThan(0);
      return {
        violations: [
          ...(await page.evaluate(() => Reflect.get(window, "cspViolations") as string[])),
          ...workerViolations.flat(),
        ],
        requests,
        errors,
        fallbackVisible: await page.locator(fallbackLink).isVisible(),
      };
    } finally {
      await context.close();
    }
  };

  it(
    "renders the table from the API, and the site's policy reports no violation",
    { timeout: 60_000 },
    async () => {
      const result = await visit(await readPolicy());
      expect(result.requests).toEqual([
        "https://api.browser-compat.dev/v1/current/features/css.properties.display.json",
      ]);
      expect(result.fallbackVisible).toBe(false);
      // One violation predates the component's pages: Pagefind's worker compiles WebAssembly, which
      // `script-src` reports as `wasm-eval` because the policy has no 'wasm-unsafe-eval'. The #193
      // measurement listened on the document only, so it did not hear the worker. Whether to allow
      // it is the owner's decision, so the test names it and allows nothing else.
      expect(result.violations.filter((entry) => entry !== KNOWN_PAGEFIND_VIOLATION)).toEqual([]);
      expect(result.errors).toEqual([]);
    },
  );

  // The two controls show that the test above can fail: each removes one part of `connect-src`.
  it(
    "reports the API request when the policy has no connect-src",
    { timeout: 60_000 },
    async () => {
      const policy = (await readPolicy()).replace(/;\s*connect-src[^;]*/, "");
      expect(policy).not.toContain("connect-src");
      const result = await visit(policy);
      expect(result.violations).toContain(
        "connect-src https://api.browser-compat.dev/v1/current/features/css.properties.display.json",
      );
    },
  );

  it(
    "reports the search index requests when connect-src leaves out 'self'",
    { timeout: 60_000 },
    async () => {
      const policy = (await readPolicy()).replace("connect-src 'self' ", "connect-src ");
      expect(policy).toContain("connect-src https://api.browser-compat.dev");
      const result = await visit(policy);
      expect(
        result.violations.some((entry) =>
          /^connect-src http:\/\/127\.0\.0\.1:\d+\/pagefind\//.test(entry),
        ),
      ).toBe(true);
      expect(result.violations.every((entry) => !entry.includes("api.browser-compat.dev"))).toBe(
        true,
      );
    },
  );
});
