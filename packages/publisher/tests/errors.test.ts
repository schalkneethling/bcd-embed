import { DiffApprovalMismatchError } from "@bcd-embed/generator";
import { describe, expect, it } from "vitest";

import { parsePublishCommand, usage } from "../src/cli.js";
import { PublisherError, describeFailure, formatPublisherError } from "../src/errors.js";

describe("safe publisher diagnostics", () => {
  it("prints reviewed publisher guidance", () => {
    const message = "Metadata compare-and-swap lost a concurrent publication race.";
    expect(formatPublisherError(new PublisherError(message))).toBe(message);
  });

  it("prints the reviewed message of a stale or mismatched approval", () => {
    const message = "Approval digest does not match these exact baseline and candidate trees.";
    expect(formatPublisherError(new DiffApprovalMismatchError(message))).toBe(message);
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

  it("adds only a valid HTTP status from an SDK failure", () => {
    const secret = "/private/credentials?token=do-not-print";
    const sdk = (status: unknown) =>
      Object.assign(new Error(secret), { name: secret, $metadata: { httpStatusCode: status } });
    expect(describeFailure(sdk(503))).toBe("R2 responded with HTTP 503.");
    expect(describeFailure(sdk(secret))).toBe("UnknownError");
    expect(describeFailure(sdk(42))).toBe("UnknownError");
    expect(describeFailure({ message: secret, $metadata: { httpStatusCode: 403 } })).toBe(
      "UnknownError",
    );
    expect(describeFailure(new PublisherError("Reviewed guidance."))).toBe("Reviewed guidance.");
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
