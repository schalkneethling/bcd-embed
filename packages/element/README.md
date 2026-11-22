# `@schalkneethling/bcd-embed`

`<bcd-compat-table>` is a web component that renders the browser compatibility table of a web
platform feature, and of every feature nested under it, from
[MDN Browser Compatibility Data](https://github.com/mdn/browser-compat-data) (BCD). By default it
asks the hosted API at [`https://api.browser-compat.dev`](https://api.browser-compat.dev) for the
data, so a page needs one element and one import.

The full guide is on the documentation site, starting at
[Getting started](https://docs.browser-compat.dev/component/getting-started/).

## Beta status

Releases of this package are betas, published under the `beta` dist-tag, until version 1.0. A
beta's attributes, events, and styling tokens can still change. To see which versions npm has,
run `npm view @schalkneethling/bcd-embed versions`. Each release lists its changes in the package's
[changelog](https://github.com/schalkneethling/bcd-embed/blob/main/packages/element/CHANGELOG.md)
and on the [GitHub releases page](https://github.com/schalkneethling/bcd-embed/releases).

## Install

```sh
npm install @schalkneethling/bcd-embed@beta
```

`lit` and `@lit/task`, the two libraries the element is built with, are installed with it.

## Use it

The package has two entry points:

| Import                                | What it gives you                                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `@schalkneethling/bcd-embed`          | Importing it defines `<bcd-compat-table>`. It also exports the TypeScript types, such as `BcdCompatTableElement` and `CompatTableData`.     |
| `@schalkneethling/bcd-embed/base.css` | The optional base stylesheet: borders, spacing, focus rings, icon colours, and the rule that hides the fallback content once a table loads. |

Import the package once, before anything renders the element. The import itself defines the
element, so it needs no name. The bare import needs a bundler, such as Vite, or an import map to
resolve it. Then write the element where the table belongs, name the feature in
`query` with its BCD key, and put a link to the same table on MDN Web Docs inside it:

```html
<link rel="stylesheet" href="/node_modules/@schalkneethling/bcd-embed/dist/base.css" />

<bcd-compat-table query="css.properties.display">
  <p>
    <a href="https://developer.mozilla.org/en-US/docs/Web/CSS/display#browser_compatibility"
      >Browser compatibility for <code>display</code> on MDN Web Docs</a
    >
  </p>
</bcd-compat-table>

<script type="module">
  import "@schalkneethling/bcd-embed";
</script>
```

The element's children are its fallback content. A reader sees them before the script runs, while
the table loads, after an error, and when script is turned off. Once the table renders, the base
stylesheet hides them.

The documentation site covers the rest:

- [Attributes and properties](https://docs.browser-compat.dev/component/attributes-and-properties/)
  lists every input the element reads.
- [Data modes](https://docs.browser-compat.dev/component/data-modes/) renders a table with no
  request, from data a build step saved.
- [Events](https://docs.browser-compat.dev/component/events/) shows how a page learns that a
  table loaded or failed.
- [Styling and tokens](https://docs.browser-compat.dev/component/styling/) explains why a CSS
  minifier can lose the stylesheet's colours, and how to change colours, spacing, and layout.
- [Frameworks](https://docs.browser-compat.dev/component/frameworks/) covers React, Vue, and
  Svelte.
- [Self-hosting](https://docs.browser-compat.dev/component/self-hosting/) points the element at
  your own copy of the API.

## Screen reader users: tell us how it sounds

The table is tested in CI with VoiceOver, NVDA, and Orca, but recorded speech is not the same as
someone using a screen reader every day. If you use one, please try the table on the
[documentation site](https://docs.browser-compat.dev/component/getting-started/) and
[open an issue](https://github.com/schalkneethling/bcd-embed/issues/new) that says which screen
reader and browser you used, what you heard, and what you expected to hear. Reports that something
is confusing, too long, or in the wrong order are as useful as reports that something is broken.

## Report a problem

Report bugs and ask questions in the
[GitHub issues](https://github.com/schalkneethling/bcd-embed/issues). The source, and the
maintainers' guide in `packages/element/DEVELOPMENT.md`, live in the
[repository](https://github.com/schalkneethling/bcd-embed).

## License

MIT. The compatibility data comes from MDN Browser Compatibility Data, which is published under
CC0.
