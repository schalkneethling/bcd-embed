// Serves the production build of the framework pages (`dist/`, written by e2e/global-setup.ts) for
// the framework tests' second web server. It reads each file from disk on each request, so it can
// start before the build has finished: Playwright starts web servers first and runs the global
// setup after them, and `vite preview` refuses to start without its output directory.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

// The port comes from the Playwright config, which names it once for the server and the tests.
const PORT = Number(process.argv[2]);
if (!Number.isInteger(PORT)) throw new Error("Pass the port as the first argument.");
const root = fileURLToPath(new URL("./dist", import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

/** The file a request path names inside `dist`, or `null` for a path outside it or a bad escape. */
const resolveInside = (pathname: string): string | null => {
  try {
    // `normalize` resolves `..` segments, and the prefix check keeps the path inside `dist`.
    const path = normalize(join(root, decodeURIComponent(pathname)));
    return path.startsWith(root + sep) ? path : null;
  } catch {
    return null;
  }
};

createServer(async (request, response) => {
  const path = resolveInside(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
  const type = path === null ? undefined : CONTENT_TYPES[extname(path)];
  if (path === null || type === undefined || !(await stat(path).catch(() => null))?.isFile()) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "content-type": type });
  createReadStream(path).pipe(response);
}).listen(PORT, "127.0.0.1");
