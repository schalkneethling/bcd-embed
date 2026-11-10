/**
 * How many objects are uploaded or restored at the same time.
 *
 * Each object costs two sequential R2 requests (a PUT, then a GET that reads
 * the bytes back), so throughput is bound by request latency, not by CPU. A
 * live run with four workers verified about 230 objects per minute, which
 * needs roughly nine hours for a 125,640-object snapshot. 32 workers bring
 * that under the publish job's six-hour limit with room to spare, and stay
 * below the 50 sockets the S3 client opens by default.
 */
export const UPLOAD_CONCURRENCY = 32;

/**
 * Run `action` over `values` with at most UPLOAD_CONCURRENCY in flight.
 * The first failure stops new work from starting and is rethrown.
 * `onSettled` receives the number of values completed so far, after each one.
 * O(n) actions and O(UPLOAD_CONCURRENCY) auxiliary memory.
 */
export const runBounded = async <T>(
  values: readonly T[],
  action: (value: T) => Promise<void>,
  onSettled?: (completed: number) => void,
): Promise<void> => {
  let next = 0;
  let completed = 0;
  let failed = false;
  const workers = Array.from({ length: Math.min(UPLOAD_CONCURRENCY, values.length) }, async () => {
    while (!failed && next < values.length) {
      const value = values[next++]!;
      try {
        await action(value);
      } catch (error) {
        failed = true;
        throw error;
      }
      onSettled?.(++completed);
    }
  });
  await Promise.allSettled(workers).then((settled) => {
    const failure = settled.find((item) => item.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  });
};
