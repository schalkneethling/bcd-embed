import type { CompatStatement, Identifier } from "@mdn/browser-compat-data/types";

export type FlatFeatureRecord = {
  key: string;
  name: string;
  depth: number;
  compat: CompatStatement;
};

const isIdentifierNode = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Flatten one addressable BCD subtree while preserving its published key order. */
export const flattenFeatureSubtree = (key: string, subtree: Identifier): FlatFeatureRecord[] => {
  if (!isIdentifierNode(subtree) || !isIdentifierNode(subtree.__compat)) {
    throw new Error(`Addressable BCD root '${key}' must contain __compat.`);
  }

  const records: FlatFeatureRecord[] = [];
  const visit = (nodeKey: string, node: Record<string, unknown>, depth: number) => {
    if (node.__compat !== undefined) {
      if (!isIdentifierNode(node.__compat)) {
        throw new Error(`Malformed BCD compatibility data at '${nodeKey}'.`);
      }
      records.push({
        key: nodeKey,
        name: nodeKey.split(".").at(-1) ?? nodeKey,
        depth,
        compat: node.__compat as unknown as CompatStatement,
      });
    }

    for (const [segment, child] of Object.entries(node)) {
      if (segment === "__compat") continue;
      const childKey = `${nodeKey}.${segment}`;
      if (!isIdentifierNode(child)) throw new Error(`Malformed BCD node at '${childKey}'.`);
      visit(childKey, child, depth + 1);
    }
  };

  visit(key, subtree, 0);
  return records;
};
