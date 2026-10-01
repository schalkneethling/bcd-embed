const UPLOAD_CONCURRENCY = 4;

export const runBounded = async <T>(
  values: readonly T[],
  action: (value: T) => Promise<void>,
): Promise<void> => {
  let next = 0;
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
    }
  });
  await Promise.allSettled(workers).then((settled) => {
    const failure = settled.find((item) => item.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  });
};
