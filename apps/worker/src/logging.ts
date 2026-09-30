/** Log a bounded diagnostic without leaking URL, key, or upstream error text. */
export const reportError = (error: unknown): void => {
  const errorType =
    error instanceof TypeError
      ? "TypeError"
      : error instanceof RangeError
        ? "RangeError"
        : error instanceof Error
          ? "Error"
          : "Unknown";
  console.error(
    JSON.stringify({
      event: "bcd_embed_worker_error",
      errorType,
    }),
  );
};
