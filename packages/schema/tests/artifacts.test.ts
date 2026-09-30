import { describe, expect, it } from "vitest";
import { artifactManifestSchema, representationPath } from "../src/index.js";

const sha256 = "a".repeat(64);
const fixture = () => ({
  version: 1 as const,
  snapshotId: "bcd-8.1.3-gen-0.0.0",
  artifacts: ["v1/meta.json", "v1/bcd-8.1.3-gen-0.0.0/features/api.Foo.json"].flatMap(
    (logicalPath) =>
      (["identity", "br", "gzip"] as const).map((encoding) => ({
        logicalPath,
        encoding,
        path: representationPath(logicalPath, encoding, sha256),
        size: 100,
        sha256,
        etag: `"${sha256}"`,
      })),
  ),
});

describe("internal publication manifest", () => {
  it("validates exact paths, ownership, and complete representation groups", () => {
    expect(artifactManifestSchema.parse(fixture())).toEqual(fixture());
  });
  it.each([
    (value: ReturnType<typeof fixture>) => {
      value.artifacts.pop();
    },
    (value: ReturnType<typeof fixture>) => {
      value.artifacts[0]!.path = "../private.json";
    },
    (value: ReturnType<typeof fixture>) => {
      value.artifacts[0]!.size = Number.MAX_SAFE_INTEGER + 1;
    },
    (value: ReturnType<typeof fixture>) => {
      value.artifacts[0]!.etag = 'W/"weak"';
    },
    (value: ReturnType<typeof fixture>) => {
      value.artifacts[0]!.sha256 = "0";
    },
    (value: ReturnType<typeof fixture>) => {
      value.artifacts.push(value.artifacts[0]!);
    },
    (value: ReturnType<typeof fixture>) => {
      value.artifacts[3]!.logicalPath = "v1/bcd-9-gen-0/features/api.Foo.json";
    },
    (value: ReturnType<typeof fixture>) => {
      value.artifacts[1]!.path = `v1/_meta/${"b".repeat(64)}.json.br`;
    },
  ])("rejects malformed, unsafe, duplicate, and inconsistent inventories", (change) => {
    const value = fixture();
    change(value);
    expect(artifactManifestSchema.safeParse(value).success).toBe(false);
  });
});
