import { featureResponseSchema } from "@bcd-embed/schema";
import type { SupportStatement } from "@bcd-embed/schema";
import { describe, expect, it } from "vitest";

import { messageCases } from "./fixtures/message-cases.js";

describe("the named fixtures that the schema package lacks", () => {
  for (const [name, fixture] of Object.entries(messageCases)) {
    it(`${name} is a valid feature response`, () => {
      expect(featureResponseSchema.safeParse(fixture).success).toBe(true);
    });
  }

  it("covers a mobile target and an XR target", () => {
    const types = Object.values(messageCases).flatMap((fixture) =>
      Object.values(fixture.browsers).map((target) => target.type),
    );

    expect(types).toContain("mobile");
    expect(types).toContain("xr");
  });

  it("has a runtime flag, a full-support preview, and a versionLast value", () => {
    const statements = (name: keyof typeof messageCases): SupportStatement[] =>
      Object.values(messageCases[name].features[0]?.support ?? {}).flatMap((support) =>
        support.branches.flatMap((branch): SupportStatement[] => [...branch.statements]),
      );

    expect(statements("runtimeFlag").flatMap((s) => s.flags.map((f) => f.type))).toEqual([
      "runtime_flag",
    ]);
    expect(
      statements("fullSupportPreview").every((s) => s.isPreview && !s.partialImplementation),
    ).toBe(true);
    expect(statements("versionLast").map((s) => s.versionLast)).toEqual(["10.1"]);
  });
});
