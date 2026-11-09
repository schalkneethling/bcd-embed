import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

describe("Worker deploy configuration", () => {
  it("deploys through varlock-wrangler with Varlock's files kept away from Wrangler", async () => {
    const worker = JSON.parse(await read("../apps/worker/package.json"));
    expect(worker.scripts.deploy).toBe("varlock-wrangler deploy");
    // Wrangler reads a .env.local beside wrangler.jsonc and adds its keys to the generated types,
    // which would make the typecheck fail on a machine that has the Sentry DSN.
    expect(worker.varlock).toEqual({ loadPath: "./env/" });
  });

  it("uploads the Sentry DSN as a secret, and lets the Worker deploy without one", async () => {
    const schema = await read("../apps/worker/env/.env.schema");
    const lines = schema.split("\n");
    const item = lines.indexOf("SENTRY_DSN=");
    expect(item).toBeGreaterThan(0);
    // A blank line ends the decorators that belong to an item.
    const start = lines.lastIndexOf("", item) + 1;
    const decorators = lines.slice(start, item).join("\n");
    expect(decorators).toContain("@sensitive");
    expect(decorators).toContain("@optional");
  });
});
