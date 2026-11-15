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

/**
 * The HTTP status of the last response behind an SDK failure. AWS SDK v3 errors carry it in
 * `$metadata.httpStatusCode`. A status is a number from the server, so printing it leaks no
 * names, messages, request IDs, paths, or credentials.
 */
const httpStatusOf = (error: unknown): number | undefined => {
  if (!(error instanceof Error)) return undefined;
  const status = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode;
  return Number.isInteger(status) && (status as number) >= 100 && (status as number) <= 599
    ? (status as number)
    : undefined;
};

/** Never expose names or messages from filesystem, schema, stream, or SDK failures. */
export const formatPublisherError = (error: unknown): string =>
  error instanceof PublisherError || error instanceof DiffApprovalMismatchError
    ? error.message
    : "UnknownError";

/** Like `formatPublisherError`, but reports the HTTP status of an SDK failure when it has one. */
export const describeFailure = (error: unknown): string => {
  const status = httpStatusOf(error);
  return status === undefined ? formatPublisherError(error) : `R2 responded with HTTP ${status}.`;
};

/** A retention cleanup failure, naming the step that failed and its safe cause. */
export class CleanupError extends PublisherError {
  constructor(step: string, cause: unknown) {
    super(`Retention cleanup failed while ${step}: ${describeFailure(cause)}`);
    this.name = "CleanupError";
  }
}
