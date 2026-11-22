// A local stand-in for api.browser-compat.dev: the repository's own request handler
// (`createArtifactHandler` from @bcd-embed/server) over a folder that `bcd-embed-generate` wrote.
// It makes no network request except the ones clients send to it, and it listens on loopback only.
//
//   pnpm --filter @bcd-embed/server build
//   node load-test/local-server.mjs --artifacts <folder> [--port 8787]
//
// What it does not do: it has no edge cache, no rate limiting rule, no Cloudflare headers and no
// Browser Cache TTL, so it cannot show those behaviours. Its ETags are the SHA-256 of each stored
// file's bytes, which is what the Worker reads from R2 metadata.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const serverModule = join(
  dirname(fileURLToPath(import.meta.url)),
  "../packages/server/dist/index.js",
);

const parseArguments = (arguments_) => {
  const values = { port: "8787" };
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!["--artifacts", "--port"].includes(name ?? "") || value === undefined) {
      throw new Error("Usage: node load-test/local-server.mjs --artifacts <folder> [--port 8787]");
    }
    values[name.slice(2)] = value;
  }
  if (values.artifacts === undefined) throw new Error("--artifacts is required.");
  return values;
};

const main = async () => {
  const { artifacts, port } = parseArguments(process.argv.slice(2));
  const root = resolve(artifacts);
  const { createArtifactHandler, createTreeCache } = await import(pathToFileURL(serverModule).href);
  const handle = createArtifactHandler({
    treeCache: createTreeCache(),
    store: {
      async get(path) {
        const file = resolve(root, path);
        // The handler builds paths from validated tokens, but this guard keeps the read inside the root.
        if (!file.startsWith(root + sep)) return null;
        let bytes;
        try {
          bytes = await readFile(file);
        } catch {
          return null;
        }
        const etag = `"${createHash("sha256").update(bytes).digest("hex")}"`;
        return {
          body: new Response(bytes).body,
          etag,
          size: bytes.byteLength,
        };
      },
    },
    encodeJson: (bytes, encoding) =>
      encoding === "br"
        ? brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })
        : gzipSync(bytes, { level: 6 }),
    onError: (error) => console.error("handler error:", error),
  });

  const server = createServer(async (incoming, outgoing) => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    const request = new Request(`http://${incoming.headers.host ?? "127.0.0.1"}${incoming.url}`, {
      method: incoming.method,
      headers,
    });
    const response = await handle(request);
    outgoing.statusCode = response.status;
    response.headers.forEach((value, name) => outgoing.setHeader(name, value));
    if (response.body === null) outgoing.end();
    else Readable.fromWeb(response.body).pipe(outgoing);
  });
  server.listen(Number(port), "127.0.0.1", () => {
    console.log(`Serving ${root} on http://127.0.0.1:${port}`);
  });
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
