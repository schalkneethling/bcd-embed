// Proves the Chromium Vitest project: it runs in a real browser, so shadow DOM and computed style
// work, which the Node project cannot do.
import { afterEach, expect, test } from "vitest";

afterEach(() => {
  document.body.replaceChildren();
});

test("runs in a browser with a real shadow root", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = '<style>p { color: rgb(0, 128, 0); }</style><p id="message">Hello</p>';

  const message = root.querySelector("#message");

  expect(message).not.toBeNull();
  expect(getComputedStyle(message as Element).color).toBe("rgb(0, 128, 0)");
});
