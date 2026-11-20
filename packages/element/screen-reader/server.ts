// The server that every screen reader config starts. It previews the built fixture page, so a
// missing or broken build fails the run: `vite preview` exits when `dist-screen-reader/` does not
// exist. `--strictPort` makes a port that is taken a failure instead of a silent move to another
// port that `baseURL` would not know about.
import type { PlaywrightTestConfig } from "@playwright/test";

const port = 5199;
export const origin = `http://127.0.0.1:${port}`;

/** The path of the built page, under the origin. */
export const fixturePath = "/screen-reader/fixtures/component.html";

export const webServer: NonNullable<PlaywrightTestConfig["webServer"]> = {
  command: `vite preview --config vite.screen-reader.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
  url: `${origin}${fixturePath}`,
  reuseExistingServer: false,
};
