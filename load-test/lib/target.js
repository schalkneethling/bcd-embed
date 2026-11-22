// Validates the base URL. The script has no default host, so it can never reach production by
// accident, and it refuses a non-loopback host unless CONFIRM_REMOTE names that exact host.

const ORIGIN = /^(https?):\/\/([^/:?#]+|\[[0-9a-fA-F:]+\])(?::(\d{1,5}))?$/;

const isLoopbackHost = (host) =>
  host === "localhost" || host === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(host);

/**
 * Returns the origin without a trailing slash, or throws with the reason.
 * `confirmRemote` is the value of the CONFIRM_REMOTE environment variable. A remote host is
 * allowed only when it equals the host name, such as `api.browser-compat.dev` (no scheme or port).
 */
export const resolveBaseUrl = (baseUrl, confirmRemote) => {
  if (baseUrl === undefined || baseUrl === "") {
    throw new Error("BASE_URL is required, for example BASE_URL=http://127.0.0.1:8787.");
  }
  const origin = baseUrl.replace(/\/$/, "");
  const match = ORIGIN.exec(origin);
  if (match === null) {
    throw new Error("BASE_URL must be an origin with no path, query or fragment.");
  }
  const host = match[2];
  if (!isLoopbackHost(host) && confirmRemote !== host) {
    throw new Error(
      `BASE_URL points at ${host}, which is not a loopback address. Set CONFIRM_REMOTE=${host} to run against it.`,
    );
  }
  return origin;
};
