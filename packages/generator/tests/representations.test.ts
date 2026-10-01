import { createHash } from "node:crypto";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createRepresentations } from "../src/representations.js";

describe("offline representations", () => {
  it("emits deterministic encoded bytes, distinct byte-specific validators, and metadata addressing", () => {
    const bytes = Buffer.from('{"features":[]}\n');
    const first = createRepresentations("v1/meta.json", bytes);
    const second = createRepresentations("v1/meta.json", bytes);
    expect(first).toEqual(second);
    expect(first.map(({ encoding }) => encoding)).toEqual(["identity", "br", "gzip"]);
    expect(new Set(first.map(({ etag }) => etag)).size).toBe(3);
    expect(first[1]!.path).toBe(`v1/_meta/${first[0]!.sha256}.json.br`);
    for (const representation of first) {
      expect(representation.size).toBe(representation.bytes.length);
      expect(representation.sha256).toBe(
        createHash("sha256").update(representation.bytes).digest("hex"),
      );
      expect(representation.etag).toBe(`"${representation.sha256}"`);
    }
    expect(brotliDecompressSync(first[1]!.bytes)).toEqual(bytes);
    expect(gunzipSync(first[2]!.bytes)).toEqual(bytes);
    expect(first[2]!.bytes.slice(4, 8)).toEqual(Buffer.from([0, 0, 0, 0]));
  });
});
