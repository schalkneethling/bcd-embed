import { describe, expect, it } from "vitest";

import { parsePublishCommand, usage } from "../src/cli.js";
import { PublisherError, formatPublisherError } from "../src/errors.js";

describe("safe publisher diagnostics", () => {
  it("prints reviewed publisher guidance", () => {
    const message = "Metadata compare-and-swap lost a concurrent publication race.";
    expect(formatPublisherError(new PublisherError(message))).toBe(message);
  });

  it("redacts unknown messages and attacker-controlled names", () => {
    const secret = "/private/credentials?token=do-not-print";
    const upstream = new Error(secret);
    upstream.name = secret;
    expect(formatPublisherError(upstream)).toBe("UnknownError");
    expect(formatPublisherError({ name: "PublisherError", message: secret })).toBe("UnknownError");
    expect(formatPublisherError(secret)).toBe("UnknownError");
    expect(formatPublisherError(undefined)).toBe("UnknownError");
  });

  it("reports CLI misuse without echoing unknown arguments", () => {
    const argument = "--secret-token=do-not-print";
    try {
      parsePublishCommand([argument]);
      expect.fail("Unknown argument must fail closed");
    } catch (error) {
      expect(error).toBeInstanceOf(PublisherError);
      expect(formatPublisherError(error)).toBe(`Unknown or repeated argument.\n${usage}`);
      expect(formatPublisherError(error)).not.toContain(argument);
    }
  });
});
