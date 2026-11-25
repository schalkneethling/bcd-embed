---
"@schalkneethling/bcd-embed": patch
---

The base stylesheet now keeps each support cell at least 12em wide, capped at the viewport's width minus 12em. Before, the table gave its spare width to the feature column, and with several targets an open cell's notes wrapped every word or two. Where the columns no longer fit, the region now scrolls sideways.
