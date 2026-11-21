// Reads the files that configure a Cloudflare deploy (`wrangler.jsonc` and `_headers`) and a
// Content-Security-Policy value, for the deployment tests of both sites.

// A Wrangler configuration holds whole-line comments and trailing commas, which `JSON.parse`
// rejects. This handles those two, which is all the repository's configurations use.
export const parseJsonc = (text: string): Record<string, unknown> =>
  JSON.parse(text.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"));

export type HeaderRule = { path: string; headers: Map<string, string> };

// Wrangler's own `_headers` parser lives inside its bundle and is not exported, so this reads
// the same shape: a line that starts at column zero is a path, and the indented `Name: value`
// lines under it are that path's headers. Comments and blank lines are skipped.
export const parseHeadersFile = (text: string): HeaderRule[] => {
  const rules: HeaderRule[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("/")) {
      rules.push({ path: line, headers: new Map() });
      continue;
    }
    const separator = line.indexOf(":");
    const rule = rules.at(-1);
    if (rule === undefined || separator === -1) throw new Error(`Unexpected line: ${line}`);
    const name = line.slice(0, separator).trim().toLowerCase();
    // Cloudflare joins repeated names with a comma, so a repeat within one rule or across two
    // rules would change a value. The tests keep each name under one rule.
    rule.headers.set(name, line.slice(separator + 1).trim());
  }
  return rules;
};

/**
 * Splits a policy into its directives: each name, and the list of source expressions after it.
 * O(n) for a policy of n characters.
 */
export const parsePolicy = (policy: string): Map<string, string[]> => {
  const directives = new Map<string, string[]>();
  for (const part of policy.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name === undefined || name === "") continue;
    const key = name.toLowerCase();
    if (directives.has(key)) throw new Error(`The policy repeats the directive ${key}`);
    directives.set(key, sources);
  }
  return directives;
};
