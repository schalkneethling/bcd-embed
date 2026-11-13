import { DiffApprovalMismatchError } from "@bcd-embed/generator";

/** Only reviewed, publisher-owned guidance belongs in this error type. */
export class PublisherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublisherError";
  }
}

/** A request that ran out of time. Unlike an integrity failure, it is worth trying again. */
export class PublisherTimeoutError extends PublisherError {
  constructor(message: string) {
    super(message);
    this.name = "PublisherTimeoutError";
  }
}

/** Never expose names or messages from filesystem, schema, stream, or SDK failures. */
export const formatPublisherError = (error: unknown): string =>
  error instanceof PublisherError || error instanceof DiffApprovalMismatchError
    ? error.message
    : "UnknownError";
