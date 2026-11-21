// The default page background of each engine, which the base stylesheet's colours are checked
// against. The stylesheet sets no background, so a table sits on its page's background, and a page
// that sets none shows the browser's Canvas colour. `e2e/base-stylesheet.e2e.ts` checks these
// values in Playwright 1.65.1's Chromium 159, Firefox 159, and WebKit 27.2, so a browser upgrade
// that changes one fails there.

export type Engine = "chromium" | "firefox" | "webkit";

/** Canvas as `#rrggbb`, under `color-scheme: light` and `color-scheme: dark`. */
export const CANVAS: Readonly<Record<Engine, { readonly light: string; readonly dark: string }>> = {
  chromium: { light: "#ffffff", dark: "#121212" },
  firefox: { light: "#ffffff", dark: "#1c1b22" },
  webkit: { light: "#ffffff", dark: "#1e1e1e" },
};
