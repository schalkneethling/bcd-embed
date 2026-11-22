---
title: Browser support
description: The browsers bcd-compat-table supports, the Baseline 2025 floor, and the engine bugs that affect it.
---

`<bcd-compat-table>` supports browsers that implement Baseline 2025 or newer.
Baseline is the web platform's measure of which features work in all of the
core browsers: Chrome (desktop and Android), Edge, Firefox (desktop and
Android), and Safari (macOS and iOS). "Baseline 2025" names the features that
became available in all of them during 2025. The floor covers that set and
the sets of every earlier year. The audience of a compatibility table is mostly
developers on current browsers, so the project chose this floor and declares
it, as a compatibility tool should.

## What the floor covers

The base stylesheet depends on features at or below the floor, among them:

- `@property`, which registers the design tokens with a type and a default;
- `light-dark()`, which picks the light or the dark colour of each token;
- `overflow-inline`, the logical form of `overflow-x`, for the scrolling
  region.

The element uses custom elements and JavaScript modules, which every browser
at the floor implements. The project's linter for Cascading Style Sheets
(CSS), Stylelint, checks the stylesheet against Baseline 2025 and reports
nothing at that floor. Raising the floor is a deliberate, announced decision
that comes with a new version of the package.

## Where the element is tested

| Engine   | What runs there                                                                                          |
| -------- | -------------------------------------------------------------------------------------------------------- |
| Chromium | Rendering tests on every change, and the three-engine tests with axe, an automated accessibility checker |
| Firefox  | The three-engine tests with axe, and the NVDA (NonVisual Desktop Access) and Orca screen reader walks    |
| WebKit   | The three-engine tests with axe, and the VoiceOver screen reader walk                                    |

The tests use the engine builds that the repository's pinned version of
Playwright installs, not the released Chrome, Firefox, and Safari. The
package's [maintainers' guide, section "Browser tests"](https://github.com/schalkneethling/bcd-embed/blob/main/packages/element/DEVELOPMENT.md#browser-tests) names the
Playwright version. The engine versions below are the ones the project
observed each behaviour in. [Accessibility](/component/accessibility/) lists what that
leaves to a manual pass.

## Engine behaviour that affects you

- **`@property` inside a shadow root.** Chromium 159, Firefox 159, and WebKit
  27.2 ignore an `@property` rule inside a shadow root. Load the base
  stylesheet from the document, even when the element sits inside a shadow
  root of your own, or the tokens stay unregistered.
- **WebKit and `document.importNode`.** WebKit 27.2 never upgrades a custom
  element that `document.importNode` created before anything on the page read
  `window.customElements`, not even through `customElements.upgrade`. Svelte
  builds its markup with `importNode`, so a Svelte page that defines the
  element after it first renders shows the fallback forever in WebKit. Import
  the element before the framework renders, as
  [Frameworks](/component/frameworks/) recommends. The project observed this
  on macOS.
- **Lazy loading in a cross-origin iframe.** The browser ignores the
  400-pixel margin of the lazy observer there, so the request starts only when
  the element enters the viewport.
- **Mixed content.** A browser blocks an `http:` request from an `https:`
  page, so an `http:` endpoint on an `https:` page fails with the reason
  `network`.
