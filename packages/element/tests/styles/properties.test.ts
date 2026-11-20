// Every custom property the base stylesheet defines or reads is registered with @property, or is
// listed in properties.css with the reason it is not (Document 3 section 4, "Styling surface").
import { describe, expect, it } from "vitest";

import { readStylesheet, readStylesheets } from "./stylesheets.js";

const CUSTOM_PROPERTY = /--[A-Za-z0-9-]+/g;

/** The registrations in properties.css, by name, with their descriptors. */
const registrations = (() => {
  const found = new Map<string, Record<string, string>>();
  readStylesheet("properties.css").root.walkAtRules("property", (rule) => {
    const descriptors: Record<string, string> = {};
    rule.walkDecls((declaration) => {
      descriptors[declaration.prop] = declaration.value;
    });
    found.set(rule.params.trim(), descriptors);
  });
  return found;
})();

/** The `@unregistered --name: reason` lines in properties.css's comments, by name. */
const unregistered = (() => {
  const found = new Map<string, string>();
  readStylesheet("properties.css").root.walkComments((comment) => {
    for (const [, name = "", reason = ""] of comment.text.matchAll(
      /@unregistered\s+(--[A-Za-z0-9-]+):\s*(.+)/g,
    )) {
      found.set(name, reason.trim());
    }
  });
  return found;
})();

/** Every custom property a declaration sets or reads with var(), outside @property rules. */
const used = (() => {
  const found = new Set<string>();
  for (const { root } of readStylesheets()) {
    root.walkDecls((declaration) => {
      if (declaration.parent?.type === "atrule") return;
      if (declaration.prop.startsWith("--")) found.add(declaration.prop);
      for (const [name] of declaration.value.matchAll(CUSTOM_PROPERTY)) found.add(name);
    });
  }
  return found;
})();

describe("the base stylesheet's custom properties", () => {
  it("registers some and lists the unregistered ones with a reason", () => {
    expect(registrations.size).toBeGreaterThan(0);
    expect(unregistered.size).toBeGreaterThan(0);
    for (const [name, reason] of unregistered) {
      expect(reason.length, name).toBeGreaterThan(20);
      expect(registrations.has(name), name).toBe(false);
    }
  });

  it("are all registered or listed as unregistered with a reason", () => {
    const unaccounted = [...used].filter(
      (name) => !registrations.has(name) && !unregistered.has(name),
    );
    expect(unaccounted).toEqual([]);
  });

  it("include no registration or listing that nothing uses", () => {
    const declared = [...registrations.keys(), ...unregistered.keys()];
    expect(declared.filter((name) => !used.has(name))).toEqual([]);
  });

  it("are namespaced with --bcd-", () => {
    expect([...used].filter((name) => !name.startsWith("--bcd-"))).toEqual([]);
  });

  it("each give a syntax, inherit, and have an initial value", () => {
    for (const [name, descriptors] of registrations) {
      expect(Object.keys(descriptors).toSorted(), name).toEqual([
        "inherits",
        "initial-value",
        "syntax",
      ]);
      expect(descriptors.inherits, name).toBe("true");
    }
  });

  it("pair each colour token with its other scheme", () => {
    const colours = [...registrations]
      .filter(([, descriptors]) => descriptors.syntax === '"<color>"')
      .map(([name]) => name);
    const unpaired = colours.filter((name) => {
      const twin = name.endsWith("-light")
        ? name.replace(/-light$/, "-dark")
        : name.replace(/-dark$/, "-light");
      return twin === name || !registrations.has(twin);
    });
    expect(colours.length).toBeGreaterThan(0);
    expect(unpaired).toEqual([]);
  });
});
