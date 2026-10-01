import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createArtifactHandler } from "@bcd-embed/server";
import worker from "../src/index.js";

vi.mock("@bcd-embed/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bcd-embed/server")>()),
  createArtifactHandler: vi.fn(),
}));

describe("Worker cache boundary", () => {
  const entries = new Map<string, { body: string; status: number; headers: Headers }>();
  let pending: Promise<unknown>[];
  let origin: Mock<(request: Request) => Promise<Response>>;
  let match: ReturnType<typeof vi.fn>;
  let put: ReturnType<typeof vi.fn>;
  // The portable handler is mocked: neither the binding nor unused context
  // methods are accessed in these narrowly scoped cache tests.
  const env = {} as Env;
  const context = {
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
  } as ExecutionContext;
  const fetch = (url: string, init?: RequestInit) =>
    worker.fetch(new Request(url, init), env, context);

  beforeEach(() => {
    entries.clear();
    pending = [];
    origin = vi.fn(
      async (_request: Request) =>
        new Response("artifact", {
          headers: { etag: '"artifact"', "cache-control": "max-age=86400" },
        }),
    );
    vi.mocked(createArtifactHandler).mockReturnValue(origin);
    match = vi.fn(async (request: Request) => {
      const entry = entries.get(request.url);
      return entry === undefined ? undefined : new Response(entry.body, entry);
    });
    put = vi.fn(async (request: Request, response: Response) => {
      entries.set(request.url, {
        body: await response.text(),
        status: response.status,
        headers: response.headers,
      });
    });
    vi.stubGlobal("caches", { open: vi.fn(async () => ({ match, put })) });
  });

  afterEach(async () => {
    await Promise.all(pending);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses named, header-free GET keys and preserves the request authority", async () => {
    const address = "https://api.example.test:8443/v1/meta.json?ignored=1";
    await (
      await fetch(address, {
        headers: { range: "bytes=0-1", "if-modified-since": "Wed, 30 Sep 2026 00:00:00 GMT" },
      })
    ).text();
    await Promise.all(pending);
    expect(caches.open).toHaveBeenCalledWith("bcd-embed-api-v1");
    const key = match.mock.calls[0]?.[0] as Request;
    expect(key.url).toBe("https://api.example.test:8443/v1/meta.json?__bcd_encoding=identity");
    expect(key.method).toBe("GET");
    expect([...key.headers]).toEqual([]);
    await (await fetch(address)).text();
    expect(origin).toHaveBeenCalledOnce();
  });

  it("does not let immutable pinned edge entries bypass snapshot retirement", async () => {
    const address = "https://api.example.test/v1/bcd-8.1.3-gen-0.0.0/features/api.Element.json";
    const policy = "max-age=31536000, immutable";
    origin.mockResolvedValueOnce(
      new Response("artifact", { headers: { "cache-control": policy, etag: '"artifact"' } }),
    );
    const published = await fetch(address);
    expect(published.headers.get("cache-control")).toBe(policy);
    expect(await published.text()).toBe("artifact");
    await Promise.all(pending);
    origin.mockResolvedValueOnce(new Response("retired", { status: 404 }));
    const retired = await fetch(address);
    expect(retired.status).toBe(404);
    expect(await retired.text()).toBe("retired");
    expect(origin).toHaveBeenCalledTimes(2);
    expect(match).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("does not cache nested path lookalikes", async () => {
    await (await fetch("https://api.example.test//other.example.test/v1/meta.json")).text();
    expect(origin).toHaveBeenCalledOnce();
    expect(match).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("applies HEAD and weak/list conditionals to cached successful responses", async () => {
    const address = "https://api.example.test/v1/meta.json";
    await (await fetch(address)).text();
    await Promise.all(pending);
    const head = await fetch(address, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const conditional = await fetch(address, {
      headers: { "if-none-match": '"other", W/"artifact"' },
    });
    expect(conditional.status).toBe(304);
    expect(conditional.headers.get("etag")).toBe('"artifact"');
    expect(await conditional.text()).toBe("");
    expect(origin).toHaveBeenCalledOnce();
  });

  it.each([400, 404])("caches %i errors without converting them into 304", async (status) => {
    origin.mockResolvedValue(
      new Response("error", {
        status,
        headers: { etag: '"error"', "cache-control": "max-age=3600" },
      }),
    );
    const address = "https://api.example.test/v1/current/features/api.missing.json";
    await (await fetch(address)).text();
    await Promise.all(pending);
    const response = await fetch(address, { headers: { "if-none-match": '"error"' } });
    expect(response.status).toBe(status);
    expect(await response.text()).toBe("error");
    expect(origin).toHaveBeenCalledOnce();
  });

  it.each([429, 500, 503])("never caches no-store %i responses", async (status) => {
    origin.mockResolvedValue(
      new Response("failure", {
        status,
        headers: { "cache-control": "no-store" },
      }),
    );
    await (await fetch("https://api.example.test/v1/meta.json")).text();
    expect(put).not.toHaveBeenCalled();
  });

  it("falls back to the healthy origin when cache lookup fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    match.mockRejectedValue(new Error("cache unavailable"));
    const response = await fetch("https://api.example.test/v1/meta.json");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("artifact");
    expect(origin).toHaveBeenCalledOnce();
  });

  it("rejects corrupt private length metadata and falls back to the origin", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const address = "https://api.example.test/v1/meta.json";
    await (await fetch(address)).text();
    await Promise.all(pending);
    const entry = [...entries.values()][0]!;
    entry.headers.set("x-bcd-cache-representation-length", "-1");
    const response = await fetch(address);
    expect(await response.text()).toBe("artifact");
    expect(response.headers.has("x-bcd-cache-representation-length")).toBe(false);
    expect(origin).toHaveBeenCalledTimes(2);
  });

  it("isolates cache write failures through waitUntil", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    put.mockRejectedValue(new Error("cache unavailable"));
    const response = await fetch("https://api.example.test/v1/meta.json");
    expect(await response.text()).toBe("artifact");
    await expect(Promise.all(pending)).resolves.toBeDefined();
  });
});
