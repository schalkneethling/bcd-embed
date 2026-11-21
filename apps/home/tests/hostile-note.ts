/**
 * A note with the two sequences that cut a JSON script short or swallow the rest of the page when
 * they are written into it unescaped (packages/element/README.md, "Source mode"): a closing script
 * tag followed by an opening one that would run `alert(1)`, and `<!--<script>`, which moves the
 * HTML tokenizer into its "script data double escaped" state.
 */
export const HOSTILE_NOTE = "</script><script>alert(1)</script> and <!--<script> then </script>";
