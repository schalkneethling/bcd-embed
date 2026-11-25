# @schalkneethling/bcd-embed

## 0.1.0-beta.1

### Patch Changes

- 18fd632: The base stylesheet now sets `display: inline` on the status icon. A CSS reset that makes every `svg` a block, in a cascade layer ordered before `bcd-embed.base`, no longer splits a cell's compact status into three lines: the disclosure marker, the icon, and the version.
- 5a7f01a: The base stylesheet now keeps each support cell at least 12em wide, capped at the viewport's width minus 12em. Before, the table gave its spare width to the feature column, and with several targets an open cell's notes wrapped every word or two. Where the columns no longer fit, the region now scrolls sideways.

## 0.1.0-beta.0

### Minor Changes

- e83aff4: First beta of the `<bcd-compat-table>` web component. It renders a feature's browser compatibility table from the hosted API (fetch mode), from a payload assigned to its `data` property (data mode), or from inline JSON named by its `source` attribute (source mode), and it ships an optional base stylesheet, `@schalkneethling/bcd-embed/base.css`.
