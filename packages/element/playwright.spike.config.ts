// Spike for issue #187: runs the Lit and React behaviour checks in Chromium, Firefox, and WebKit,
// once against the Vite dev server (development builds of Lit and React) and once against a
// production build served by `vite preview`. Not part of `pnpm check`; run it with
// `pnpm --filter @bcd-embed/element test:spike`.
import { defineConfig, devices } from "@playwright/test";

const servers = [
  {
    mode: "dev",
    port: 5187,
    command: "vite --config spike/vite.config.ts --host 127.0.0.1 --port 5187 --strictPort",
  },
  {
    mode: "build",
    port: 5188,
    command:
      "vite build --config spike/vite.config.ts && vite preview --config spike/vite.config.ts --host 127.0.0.1 --port 5188 --strictPort",
  },
] as const;

const engines = [
  { name: "chromium", device: devices["Desktop Chrome"] },
  { name: "firefox", device: devices["Desktop Firefox"] },
  { name: "webkit", device: devices["Desktop Safari"] },
] as const;

export default defineConfig({
  testDir: "./spike/tests",
  testMatch: "**/*.spike.ts",
  reporter: "list",
  webServer: servers.map(({ mode, port, command }) => ({
    name: `vite ${mode}`,
    command,
    url: `http://127.0.0.1:${port}/light-dom.html`,
    reuseExistingServer: false,
  })),
  projects: servers.flatMap(({ mode, port }) =>
    engines.map(({ name, device }) => ({
      name: `${name}-${mode}`,
      metadata: { mode },
      use: { ...device, baseURL: `http://127.0.0.1:${port}` },
    })),
  ),
});
