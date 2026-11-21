---
title: Styling and tokens
description: The optional base stylesheet, its cascade layer, the design tokens, the class names, dark mode, and narrow containers.
---

`<bcd-compat-table>` renders its table into the page's own document tree, not
into a shadow root, so ordinary Cascading Style Sheets (CSS) reach every part
of it. Custom properties are the design-token surface: colours, spacing, the
border width, and the icon size. Layout and typography are not tokens. They go
through the normal cascade, with the class names below as the hooks, which
differs from components that hide their markup in a shadow root and expose only
custom properties.

## The base stylesheet

The package ships an optional stylesheet, `@bcd-embed/element/base.css`. It
makes the table usable with no other CSS: borders, padding, a visible focus
ring, the icons and their colours, the hidden sentences, the rule that hides
the fallback content once a table loads, and the layout in a narrow container
and in print. It sets no font, font size, text colour, or background, so the
table takes those from the page.

Link `dist/base.css` from the package with a `<link>` element in the document,
or import `@bcd-embed/element/base.css` through a bundler. Load it from the
document, not from inside a shadow root: Chromium 159, Firefox 159, and
WebKit 27.2 ignore an `@property` rule inside a shadow root, so the tokens
would stay unregistered.

### Overriding it

Every rule in the stylesheet sits in the cascade layer `bcd-embed.base`, which
the file declares first. A rule of yours that is in no layer beats every rule
in a layer, whatever the specificity, so `.bcd-table td { padding: 0; }` is
enough and `!important` is never needed.

A page that uses cascade layers itself can place `bcd-embed.base` among its
own layers with an `@layer` statement that comes before the base stylesheet:

<!-- sample: packages/element/examples/styles/author-layers.css -->

```css
/* Load this file before base.css, so this statement decides the order of all three layers. */
@layer reset, bcd-embed.base, components;

@layer reset {
  caption {
    font-weight: normal;
  }
}

@layer components {
  .bcd-table caption {
    text-align: center;
  }
}
```

Here the `reset` layer comes before `bcd-embed.base`, so the base
stylesheet's bold caption wins over it. The `components` layer comes after,
so its centred caption wins over the base stylesheet.

### If your bundler minifies the stylesheet

The published file is not minified, so a page can link it as it is. A bundler
that minifies CSS changes it. The project passed `dist/base.css` through a
Vite 8.3.8 library build with its default minifier, lightningcss, and found
three changes:

- The `@layer bcd-embed.base;` statement was dropped. Every rule stayed in the
  layer, so your unlayered rules still win.
- The `@property` rules moved inside the layer. Chromium, Firefox, and WebKit
  still register them there.
- The colours were lost. lightningcss rewrote each `light-dark()` into custom
  properties that it only defines next to a `color-scheme` declaration, which
  this stylesheet does not have, so every icon took the text colour. The
  icons' shapes stayed, so no support state was lost.

Link `dist/base.css` directly, or exclude it from minification, for example
with `build.cssMinify: false` in Vite. Issue #246 tracks a change to the
stylesheet itself.

## Tokens

The tokens are custom properties registered with `@property`, so each has a
type and a default. Each one inherits, so set it on the element, on any
ancestor, or on `:root`:

<!-- sample: packages/element/examples/styles/tokens.css -->

```css
bcd-compat-table {
  --bcd-color-supported-light: #116329;
  --bcd-color-unsupported-light: #a40e26;
  --bcd-cell-padding: 0.25rem;
  --bcd-border-width: 2px;
}
```

Each colour has a light and a dark token, and the stylesheet picks one with
`light-dark()` where the colour is used.

| Token                           | Type       | Default (light) | Default (dark) |
| ------------------------------- | ---------- | --------------- | -------------- |
| `--bcd-color-supported-light`   | `<color>`  | `#1a7f37`       |                |
| `--bcd-color-supported-dark`    | `<color>`  |                 | `#4ac26b`      |
| `--bcd-color-partial-light`     | `<color>`  | `#9a6700`       |                |
| `--bcd-color-partial-dark`      | `<color>`  |                 | `#d29922`      |
| `--bcd-color-preview-light`     | `<color>`  | `#0969da`       |                |
| `--bcd-color-preview-dark`      | `<color>`  |                 | `#4493f8`      |
| `--bcd-color-flagged-light`     | `<color>`  | `#6639ba`       |                |
| `--bcd-color-flagged-dark`      | `<color>`  |                 | `#ab7df8`      |
| `--bcd-color-unsupported-light` | `<color>`  | `#cf222e`       |                |
| `--bcd-color-unsupported-dark`  | `<color>`  |                 | `#ff7b72`      |
| `--bcd-color-unknown-light`     | `<color>`  | `#59636e`       |                |
| `--bcd-color-unknown-dark`      | `<color>`  |                 | `#9198a1`      |
| `--bcd-color-no-data-light`     | `<color>`  | `#59636e`       |                |
| `--bcd-color-no-data-dark`      | `<color>`  |                 | `#9198a1`      |
| `--bcd-color-border-light`      | `<color>`  | `#818b98`       |                |
| `--bcd-color-border-dark`       | `<color>`  |                 | `#656c76`      |
| `--bcd-border-width`            | `<length>` | `1px`           | `1px`          |

Four tokens are not registered, because `@property` cannot give them the
default they need. Three have defaults in `rem` or `em`, which an `@property`
initial value cannot be, and the fourth defaults to `Canvas`, which all three
engines resolved to white when it was registered, even in a dark scheme. The
stylesheet reads each with a fallback, so they behave like the others, except
that a value of the wrong type is not rejected.

| Token                           | Type       | Default  | What it sets                                     |
| ------------------------------- | ---------- | -------- | ------------------------------------------------ |
| `--bcd-cell-padding`            | `<length>` | `0.5rem` | The padding of every cell, and below the caption |
| `--bcd-indent`                  | `<length>` | `1rem`   | One step of a nested row's indent                |
| `--bcd-icon-size`               | `<length>` | `1em`    | The width and height of an icon                  |
| `--bcd-color-sticky-background` | `<color>`  | `Canvas` | The background of the sticky feature column      |

## Layout and typography

The table is in the page's own tree, so a rule of yours styles it as it styles
any other table:

<!-- sample: packages/element/examples/styles/typography.css -->

```css
.bcd-table {
  font-size: 0.875rem;
}

.bcd-table caption {
  font-size: 1rem;
  text-align: center;
}
```

These are the class names the element renders. They are part of its public
interface, so they change only with a new version of the package.

| Class                   | On                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `bcd-render-container`  | The `<div>` the element renders into. It belongs to the element; do not use it yourself. |
| `bcd-scroller`          | The region around the table, which scrolls sideways when the table is wider than it      |
| `bcd-table`             | The `<table>`                                                                            |
| `bcd-feature`           | Each row header, which names a feature                                                   |
| `bcd-feature-depth-{n}` | A row header nested `n` levels below the queried feature, from 1                         |
| `bcd-history`           | The `<details>` element in a cell that has a version history or notes                    |
| `bcd-history-list`      | The list inside that `<details>` element                                                 |
| `bcd-icon`              | Every support-state icon                                                                 |
| `bcd-icon-{state}`      | The icon of one support state (below)                                                    |
| `bcd-loading`           | The sentence the element shows while it loads, when the page gave no fallback content    |
| `bcd-error`             | The sentence the element shows after an error, when the page gave no fallback content    |
| `visually-hidden`       | The span that holds each cell's full sentence for screen readers                         |

`visually-hidden` is the one class without the `bcd-` prefix. A page that has
its own `.visually-hidden` rule applies it to those spans too, so keep two
properties in it: the span must stay an inline box, and it must not be
positioned. [Accessibility](/component/accessibility/) explains why.

## Icons and colours

Each support state has its own icon, so colour never carries the state alone.
The icons are inline Scalable Vector Graphics (SVG), drawn as strokes in
`currentColor`.

| Class                  | Shape                  | Shown for                                                  |
| ---------------------- | ---------------------- | ---------------------------------------------------------- |
| `bcd-icon-supported`   | A check mark           | Support                                                    |
| `bcd-icon-partial`     | A circle split in half | Partial support, including a partial preview behind a flag |
| `bcd-icon-preview`     | A laboratory flask     | Support in a preview release only                          |
| `bcd-icon-flagged`     | A flag on a pole       | Support behind a flag, unless it is a partial preview      |
| `bcd-icon-unsupported` | A cross                | No support                                                 |
| `bcd-icon-unknown`     | A question mark        | Unknown support                                            |
| `bcd-icon-no-data`     | A dash                 | A target the data says nothing about                       |

The default state colours reach a contrast of at least 4.87:1, and the border
colours at least 3.14:1, against each engine's default page background. The
Web Content Accessibility Guidelines (WCAG) ask for 3:1 for an icon. A test
checks these ratios from the token values. A page with its own background
should check the tokens against it.

The stroke comes from SVG presentation attributes on each icon, and any CSS
rule beats a presentation attribute. A common reset such as
`svg { fill: currentcolor; }` therefore fills the icons in, and the check, the
cross, and the dash turn into blobs. Exempt the table's icons in your reset:

<!-- sample: packages/element/examples/styles/svg-reset.css -->

```css
svg:not(.bcd-icon) {
  fill: currentcolor;
}
```

To replace an icon, hide `.bcd-icon` and draw your own.

## Dark mode

The stylesheet never sets `color-scheme`, because the background behind the
table is the page's. The dark colours apply when the table inherits a dark
scheme: `color-scheme: dark` on any ancestor, or `color-scheme: light dark` on
the page while the reader prefers a dark scheme. A page that declares no
scheme gets the light colours.

The element that sets a dark scheme must also paint a dark background:

<!-- sample: packages/element/examples/styles/dark-scheme.css -->

```css
.dark-panel {
  color-scheme: dark;
  background-color: Canvas;
  color: CanvasText;
}
```

`light-dark()` follows the inherited scheme whether or not anything dark is
painted behind it. On a white background, the dark state colours reach only
2.28:1 to 3.10:1, so every state colour except the preview colour fails the
3:1 an icon needs.

## Forced colours

When a reader turns on a forced colours mode, such as Windows High Contrast,
the browser replaces the icons' colour with a system colour, and the stroke
follows it, so the shapes stay. Focus on the scrolling region and on each
disclosure keeps a 2-pixel outline. The project's tests emulate forced colours
in Playwright, which replaced the colours in Firefox and Chromium but not in
WebKit, so a check on a real Windows machine is still a manual one.

## Narrow containers and the sticky column

The table never changes shape. At every width the `<table>`, its rows, and its
cells keep their table display values, so a screen reader reads the same
table. What changes is how it scrolls:

| Where                | What the stylesheet does                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| On screen, any width | The region (`.bcd-scroller`) scrolls sideways when the table is wider than it. The page does not.                                                      |
| On screen, any width | The feature column, its header included, is sticky: while the region scrolls, it stays at the start of the line and the other columns pass beneath it. |
| In print             | Nothing is sticky, and the region does not clip the table.                                                                                             |

While the table fits, nothing scrolls and the sticky column does not move. A
feature name may break anywhere, and a row header is at least 10em wide, so in
a narrow region the sticky column shrinks to 10em and leaves room for the
other columns to scroll into view beside it. In right-to-left text the column
sticks to the right.

The sticky cells paint over the cells that scroll beneath them, so they need a
background. It is `Canvas`, the browser's page colour for the inherited colour
scheme. On a page with its own background, set the token to the same colour:

<!-- sample: packages/element/examples/styles/sticky-background.css -->

```css
bcd-compat-table {
  --bcd-color-sticky-background: #fdf6e3;
}
```

To keep the column in the flow instead, override both properties with a rule
in no layer:

<!-- sample: packages/element/examples/styles/static-column.css -->

```css
.bcd-table thead tr:first-child > :first-child,
.bcd-table .bcd-feature {
  position: static;
  background-color: transparent;
}
```

Do not apply style containment to the table or to an ancestor of it, with
`container-type`, `contain: style`, or `content-visibility`. With style
containment, Chromium 159 laid out the largest real table, 314 rows, in 249
milliseconds instead of 51, and the cost grows with the square of the number of
rows. That is also why the stylesheet uses no container query.

The table uses `border-collapse: separate` with `border-spacing: 0`, and each
cell draws only its own borders. With `border-collapse: collapse`, all three
engines left the side borders of a scrolled sticky cell unpainted. If you
restyle the borders, keep each line on one cell.

## Without the stylesheet

A page that loads only the element still gets a complete, accessible table:
each cell reads as its full sentence, because the icon and the short version
stay hidden. The fallback content stays visible next to the table, because
the base stylesheet is what hides it.
