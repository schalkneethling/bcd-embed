// Serves a built copy of the introduction page over HTTP on 127.0.0.1, for the page test and the
// deployment test.
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, sep } from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export type ServeOptions = {
  /** The response headers to add for a request path, as Cloudflare adds those of `_headers`. */
  readonly headers?: (pathname: string) => Record<string, string>;
  /** Rewrites a response body, to play a page that holds something the build does not write. */
  readonly transform?: (pathname: string, body: Buffer) => Buffer | string;
};

/** Serves the built site. A path that leaves the directory, or names no file, answers 404. */
export const serve = async (
  directory: string,
  options: ServeOptions = {},
): Promise<{ server: Server; url: string }> => {
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
        response
          .writeHead(200, { "content-type": type, ...options.headers?.(path) })
          .end(options.transform?.(path, body) ?? body);
      },
      () => response.writeHead(404).end(),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}/` };
};
