import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const envelopeUrl = (dsn) => {
  const parsed = new URL(dsn);
  if (parsed.protocol !== "https:" || parsed.username === "")
    throw new Error("SENTRY_DSN must be an HTTPS DSN.");
  const parts = parsed.pathname.split("/").filter(Boolean);
  const projectId = parts.pop();
  if (projectId === undefined || !/^\d+$/.test(projectId))
    throw new Error("SENTRY_DSN must contain a numeric project ID.");
  const path = [...parts, "api", projectId, "envelope"].join("/");
  return new URL(
    `/${path}/?sentry_version=7&sentry_key=${encodeURIComponent(parsed.username)}`,
    parsed.origin,
  );
};

export const notifySentry = async ({ dsn, event, fetchImpl = fetch, status }) => {
  if (dsn === undefined || dsn.trim() === "") {
    return {
      delivered: false,
      prerequisite: "Configure the SENTRY_DSN secret to enable pipeline alerts.",
    };
  }
  if (!/^[a-z0-9_-]{1,64}$/i.test(event) || !/^[a-z0-9_-]{1,64}$/i.test(status)) {
    throw new Error("Pipeline event and status must be bounded identifiers.");
  }
  const body = [
    JSON.stringify({
      event_id: randomUUID().replaceAll("-", ""),
      sent_at: new Date().toISOString(),
    }),
    JSON.stringify({ type: "event" }),
    JSON.stringify({
      fingerprint: [`pipeline-${event}-${status}`],
      level: "error",
      logger: "bcd-embed.pipeline",
      tags: { event, status },
    }),
    "",
  ].join("\n");
  const response = await fetchImpl(envelopeUrl(dsn), {
    body,
    headers: { "content-type": "application/x-sentry-envelope" },
    method: "POST",
    signal: AbortSignal.timeout(2_000),
  });
  // The response payload is not needed; never buffer untrusted or stalled bytes.
  await response.body?.cancel();
  if (!response.ok)
    throw new Error(`Sentry pipeline notification failed with HTTP ${response.status}.`);
  return { delivered: true };
};

const main = async () => {
  const [event, status] = process.argv.slice(2);
  if (event === undefined || status === undefined || process.argv.length !== 4) {
    throw new Error("Usage: notify-sentry <event> <status>");
  }
  const result = await notifySentry({ dsn: process.env.SENTRY_DSN, event, status });
  if (!result.delivered) console.warn(`${result.prerequisite} No alert was delivered.`);
  else console.log("Sentry pipeline notification delivered.");
};

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
