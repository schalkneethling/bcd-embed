// Finds the ways a source text could move focus or add a tab stop (issue #204), by scanning its
// tokens. The installed TypeScript 7 has no parser a test can call in process: its in-process
// surface is the unstable scanner (`typescript/unstable/ast/scanner`), and its parser and
// checker run in a separate native process. A token scan is enough here, because every form that
// reaches `focus` or `tabindex` puts the name in an identifier, a string, or template text, and
// the scanner skips comments by itself.
//
// The rules are deliberately stricter than "a call to focus()":
//
// - An identifier `focus` or `autofocus`, so `el.focus()`, `el.focus?.()`, `focus.call(el)`, and
//   `HTMLElement.prototype.focus.call(el)` all match, whatever precedes the name.
// - A string or template text that is exactly `focus`, which catches `el["focus"]()`, and any
//   string or template text that contains `autofocus`.
// - Any `tabindex` or `tabIndex`, in an identifier, a string, or template text, except the exact
//   attribute text `tabindex="0"`. So `tabindex="${n}"`, `setAttribute("tabindex", "1")`,
//   `tabIndex: 1`, and `el.tabIndex = 0` all match: the element sets its tab stop in one place
//   and the scan allows only that one.
//
// Cost: O(n) in the length of the text, in one pass.
import { SyntaxKind } from "typescript/unstable/ast";
import { createScanner } from "typescript/unstable/ast/scanner";

/** The one tab stop the component adds: the scroll region's. */
const ALLOWED_TABINDEX = 'tabindex="0"';

/** A piece of text the scanner read: an identifier, or the text of a string or template part. */
type Piece = { readonly kind: "identifier" | "text"; readonly text: string };

/** Reads every identifier and every string and template text in `source`, skipping comments. */
const readPieces = (source: string): Piece[] => {
  const scanner = createScanner(true, undefined, source);
  const pieces: Piece[] = [];
  // One entry for each open `{`, and "template" for each `${` still waiting for its `}`.
  const open: ("brace" | "template")[] = [];
  for (let token = scanner.scan(); token !== SyntaxKind.EndOfFile; token = scanner.scan()) {
    if (token === SyntaxKind.CloseBraceToken && open.at(-1) === "template") {
      token = scanner.reScanTemplateToken(false);
    }
    if (token === SyntaxKind.Identifier || scanner.isIdentifier()) {
      pieces.push({ kind: "identifier", text: scanner.getTokenValue() });
    } else if (
      token === SyntaxKind.StringLiteral ||
      token === SyntaxKind.NoSubstitutionTemplateLiteral
    ) {
      pieces.push({ kind: "text", text: scanner.getTokenValue() });
    } else if (token === SyntaxKind.TemplateHead) {
      pieces.push({ kind: "text", text: scanner.getTokenValue() });
      open.push("template");
    } else if (token === SyntaxKind.TemplateMiddle) {
      pieces.push({ kind: "text", text: scanner.getTokenValue() });
    } else if (token === SyntaxKind.TemplateTail) {
      pieces.push({ kind: "text", text: scanner.getTokenValue() });
      open.pop();
    } else if (token === SyntaxKind.OpenBraceToken) {
      open.push("brace");
    } else if (token === SyntaxKind.CloseBraceToken) {
      open.pop();
    }
  }
  return pieces;
};

/** The ways `source` could move focus or add a tab stop, each as a short description. */
export const findFocusOffences = (source: string): string[] => {
  const offences: string[] = [];
  for (const { kind, text } of readPieces(source)) {
    const lower = text.toLowerCase();
    if (kind === "identifier" && (text === "focus" || lower === "autofocus")) {
      offences.push(`${text}`);
    } else if (kind === "text" && (text === "focus" || lower.includes("autofocus"))) {
      offences.push(`"${text}"`);
    }
    if (lower.includes("tabindex")) {
      // Every `tabindex` in the text must be the allowed attribute, exactly.
      const stripped = lower.replaceAll(ALLOWED_TABINDEX, "");
      if (kind === "identifier" || stripped.includes("tabindex")) offences.push(`${text}`);
    }
  }
  return offences;
};
