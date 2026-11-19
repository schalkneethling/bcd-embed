import { createHash } from "node:crypto";

import type { StoredMetaResponse } from "@bcd-embed/schema";
import { describe, expect, it } from "vitest";

import { formatPublisherError } from "../src/errors.js";
import { deleteLegacySnapshot, summarizeBucket } from "../src/legacy.js";
import { MemoryStore } from "./support/memory-store.js";

const live = "bcd-8.1.9-gen-0.0.0";
const legacy = "bcd-8.1.8-gen-0.0.0";
// The live bucket as published on 14 November 2026, before contract 1.1.0.
const metadata: StoredMetaResponse = {
  contract: "1.0.0",
  generated: "2026-11-14T00:00:00Z",
  current: live,
  snapshots: [
    {
      id: live,
      source: { package: "@mdn/browser-compat-data", version: "8.1.9" },
      generatorVersion: "0.0.0",
      generated: "2026-11-14T00:00:00Z",
      expires: "2027-02-12",
    },
  ],
  namespaces: ["css"],
};

const put = (store: MemoryStore, key: string, text = "{}\n") => {
  const bytes = Buffer.from(text);
  store.objects.set(key, {
    bytes,
    etag: `"${key}"`,
    metadata: { sha256: createHash("sha256").update(bytes).digest("hex") },
    modified: new Date("2026-11-10T00:00:00Z"),
  });
};

/** A bucket with the live content tree and a folder left by the pre-Document 8 publisher. */
const bucket = () => {
  const store = new MemoryStore();
  put(store, "v1/meta.json", `${JSON.stringify(metadata)}\n`);
  put(store, `v1/snapshots/${live}.json`);
  put(store, `v1/_publication/${legacy}.json`);
  for (const suffix of ["", ".br", ".gz"]) put(store, `v1/blobs/${"a".repeat(64)}.json${suffix}`);
  for (const name of ["css.properties.gap", "css.properties.display"])
    for (const kind of ["features", "raw"])
      for (const suffix of ["", ".br", ".gz"])
        put(store, `v1/${legacy}/${kind}/${name}.json${suffix}`);
  // A lookalike that shares the start of the prefix but is not inside the folder.
  put(store, `v1/${legacy}x/browsers.json`);
  return store;
};

describe("legacy snapshot folders", () => {
  it("counts the bucket by top-level group without changing it", async () => {
    const store = bucket();
    const before = store.keys("v1/");
    expect(await summarizeBucket(store)).toEqual({
      groups: {
        "_publication/": 1,
        [`${legacy}/`]: 12,
        [`${legacy}x/`]: 1,
        "blobs/": 3,
        "meta.json": 1,
        "snapshots/": 1,
      },
    });
    expect(store.keys("v1/")).toEqual(before);
  });

  it("deletes nothing on a dry run and reports what a real run would delete", async () => {
    const store = bucket();
    const before = store.keys("v1/");
    expect(await deleteLegacySnapshot(store, legacy)).toEqual({
      prefix: `v1/${legacy}/`,
      dryRun: true,
      matched: 12,
      deleted: 0,
      remaining: 12,
    });
    expect(store.keys("v1/")).toEqual(before);
  });

  it("deletes only the folder, across pages, and confirms nothing is left", async () => {
    const store = bucket();
    store.maxPage = 5;
    const others = store.keys("v1/").filter((key) => !key.startsWith(`v1/${legacy}/`));
    expect(await deleteLegacySnapshot(store, legacy, { dryRun: false })).toEqual({
      prefix: `v1/${legacy}/`,
      dryRun: false,
      matched: 12,
      deleted: 12,
      remaining: 0,
    });
    expect(store.keys("v1/")).toEqual(others);
  });

  it.each([
    [live, "meta.json lists this snapshot"],
    ["blobs", "Invalid snapshot identifier."],
    ["bcd-1-gen-0/../blobs", "Invalid snapshot identifier."],
    ["", "Invalid snapshot identifier."],
  ])("refuses %s", async (snapshot, message) => {
    const store = bucket();
    const before = store.keys("v1/");
    const failure = deleteLegacySnapshot(store, snapshot, { dryRun: false });
    await expect(failure).rejects.toThrow(message);
    await failure.catch((error: unknown) => expect(formatPublisherError(error)).toContain(message));
    expect(store.keys("v1/")).toEqual(before);
  });

  it("refuses to run without metadata, and stops on a listing it cannot trust", async () => {
    const empty = new MemoryStore();
    await expect(deleteLegacySnapshot(empty, legacy)).rejects.toThrow("Canonical metadata");

    const store = bucket();
    store.repeatedPage = true;
    await expect(deleteLegacySnapshot(store, legacy, { dryRun: false })).rejects.toThrow(
      `Listing v1/${legacy}/ failed on page 2: R2 returned a continuation token it had already returned.`,
    );
  });
});
