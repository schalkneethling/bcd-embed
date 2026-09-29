if (typeof process.send === "function" && process.channel !== undefined) {
  let peakRssBytes = process.memoryUsage().rss;

  const sample = () => {
    const rssBytes = process.memoryUsage().rss;
    peakRssBytes = Math.max(peakRssBytes, rssBytes);
    if (process.connected) process.send?.({ type: "bcd-embed-memory", peakRssBytes });
  };

  const timer = setInterval(sample, 50);
  timer.unref();
  process.channel.unref();

  process.once("beforeExit", () => {
    sample();
    if (process.connected) {
      process.send?.({ type: "bcd-embed-memory-final", peakRssBytes });
      process.disconnect?.();
    }
  });
}
