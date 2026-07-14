import { describe, expect, it } from "vitest";

import { CONTRACT_VERSION } from "../src/index.js";

describe("contract package foundation", () => {
  it("exposes the documented initial contract version", () => {
    expect(CONTRACT_VERSION).toBe("1.0.0");
  });
});
