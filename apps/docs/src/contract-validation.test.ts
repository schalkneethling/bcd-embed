import { describe, expect, it } from "vitest";

import { contractKinds, validateContract } from "./contract-validation.js";
import { sampleDocuments } from "./samples.js";

describe("playground contract validation", () => {
  it.each(contractKinds)("accepts the built-in %s sample in both validators", (kind) => {
    const result = validateContract(kind, sampleDocuments[kind]);

    expect(result.valid).toBe(true);
    expect(result.zod.errors).toEqual([]);
    expect(result.jsonSchema.errors).toEqual([]);
  });

  it("shows structural failures from both validators", () => {
    const result = validateContract("index-response", { keys: [] });

    expect(result.valid).toBe(false);
    expect(result.zod.errors.length).toBeGreaterThan(0);
    expect(result.jsonSchema.errors.length).toBeGreaterThan(0);
  });
});
