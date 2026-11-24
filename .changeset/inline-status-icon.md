---
"@schalkneethling/bcd-embed": patch
---

The base stylesheet now sets `display: inline` on the status icon. A CSS reset that makes every `svg` a block, in a cascade layer ordered before `bcd-embed.base`, no longer splits a cell's compact status into three lines: the disclosure marker, the icon, and the version.
