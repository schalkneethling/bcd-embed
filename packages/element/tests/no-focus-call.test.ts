// The component never moves focus (issue #204). A native <details> keeps focus on the <summary>
// that was activated, so a script that calls `focus()` could only take focus from the reader. This
// test scans the source for every form that reaches `focus`, `autofocus`, or a `tabindex` other
// than the scroll region's `tabindex="0"` (see focus-scan.ts for the rules).
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { findFocusOffences } from "./focus-scan.js";

const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));

/** Every `.ts` file below `directory`. */
const sourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return entry.name.endsWith(".ts") ? [path] : [];
    }),
  );
  return nested.flat();
};

describe("the element source", () => {
  it("calls focus() nowhere, sets no autofocus, and adds no tab stop but the region's", async () => {
    const files = await sourceFiles(sourceRoot);
    expect(files.length).toBeGreaterThan(5);

    const offences: string[] = [];
    for (const file of files) {
      for (const offence of findFocusOffences(await readFile(file, "utf8"))) {
        offences.push(`${file}: ${offence}`);
      }
    }
    expect(offences).toEqual([]);
  });
});

describe("the focus scanner", () => {
  const forms: [string, string][] = [
    ["a call", "el.focus();"],
    ["an optional call", "el.focus?.();"],
    ["an element access", 'el["focus"]();'],
    ["a template element access", "el[`focus`]();"],
    ["a prototype call", "HTMLElement.prototype.focus.call(el);"],
    ["a destructured method", "const { focus } = el;"],
    ["an autofocus attribute", "const t = html`<input autofocus>`;"],
    ["an autofocus property", "el.autofocus = true;"],
    ["a computed tabindex attribute", 'const t = html`<div tabindex="${n}"></div>`;'],
    ["a positive tabindex attribute", 'const t = html`<div tabindex="1"></div>`;'],
    ["a negative tabindex attribute", 'const t = html`<div tabindex="-1"></div>`;'],
    ["setAttribute", 'el.setAttribute("tabindex", "1");'],
    ["a tabIndex property", "el.tabIndex = 1;"],
    ["a tabIndex key", "const o = { tabIndex: 1 };"],
    ["a tabIndex of 0 as a property", "el.tabIndex = 0;"],
    ["a call after a template", "const t = html`${a}`; el.focus();"],
    ["a call inside a template part", "const t = html`<p>${el.focus()}</p>`;"],
  ];
  for (const [name, source] of forms) {
    it(`flags ${name}`, () => {
      expect(findFocusOffences(source)).not.toEqual([]);
    });
  }

  const allowed: [string, string][] = [
    ["the region's attribute", 'const t = html`<div role="region" tabindex="0"></div>`;'],
    ["a comment that names focus()", "// el.focus() would take focus\nconst a = 1;"],
    ["a block comment that names tabindex", "/* tabindex=1 */ const a = 1;"],
    ["a word that only contains focus", "const refocusLater = 1; const focused = 2;"],
    ["a template that closes before a later brace", "const t = html`${a}`; const o = { b: 1 };"],
  ];
  for (const [name, source] of allowed) {
    it(`allows ${name}`, () => {
      expect(findFocusOffences(source)).toEqual([]);
    });
  }
});
