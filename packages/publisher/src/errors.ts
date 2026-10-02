/** Only reviewed, publisher-owned guidance belongs in this error type. */
export class PublisherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublisherError";
  }
}

/** Never expose names or messages from filesystem, schema, stream, or SDK failures. */
export const formatPublisherError = (error: unknown): string =>
  error instanceof PublisherError ? error.message : "UnknownError";
