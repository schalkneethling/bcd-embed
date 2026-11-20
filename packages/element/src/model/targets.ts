import type { SupportTarget } from "@bcd-embed/schema";

import type { MessageId } from "../strings/format.js";

/**
 * Which support targets the table shows, and how their columns are grouped (Document 3 section 4,
 * "Support-target columns"). Every function here reads the payload's `browsers` object by key and
 * never reads the features, so choosing the columns costs O(T) for T displayed targets, plus
 * O(B) for the B targets in the payload in the one case that lists them all.
 */

/**
 * The targets shown when the `browsers` attribute is not set: the three independent rendering
 * engines and Node.js (Document 3 section 11).
 */
export const DEFAULT_TARGETS: readonly string[] = ["chrome", "firefox", "safari", "nodejs"];

/** A column group, named by the support target's `type`, or "other" for a target with none. */
export type ColumnGroupId = "desktop" | "mobile" | "server" | "xr" | "other";

/** The order of the column groups, which matches the tables on MDN Web Docs. */
export const COLUMN_GROUP_ORDER: readonly ColumnGroupId[] = [
  "desktop",
  "mobile",
  "server",
  "xr",
  "other",
];

/** The message that names each column group. */
export const COLUMN_GROUP_MESSAGES = {
  desktop: "platform-desktop",
  mobile: "platform-mobile",
  server: "platform-server",
  xr: "platform-xr",
  other: "platform-other",
} as const satisfies Readonly<Record<ColumnGroupId, MessageId>>;

/** One displayed support target. */
export type TableTarget = {
  /** The target's identifier, such as `chrome`. */
  readonly id: string;
  /** The display name from the payload, such as "Chrome", or the identifier when it is absent. */
  readonly name: string;
  /** The name of the target's preview release, such as "Canary", when the payload gives one. */
  readonly previewName: string | null;
  /** Whether the payload describes this target. An absent target fills its column with no data. */
  readonly inPayload: boolean;
  readonly group: ColumnGroupId;
};

/**
 * Reads the `browsers` attribute into a list of target identifiers, in the author's order, with
 * repeats removed. An attribute that names no target, such as `""` or only spaces, is treated as
 * not set, because an empty table answers nothing. O(n) time and space for an attribute of n
 * characters.
 */
export const parseBrowsersOption = (value: string | null | undefined): readonly string[] | null => {
  if (typeof value !== "string") return null;
  const ids = [...new Set(value.split(/\s+/).filter((id) => id !== ""))];
  return ids.length === 0 ? null : ids;
};

const groupOf = (target: SupportTarget | undefined): ColumnGroupId => {
  const type: unknown = target?.type;
  return type === "desktop" || type === "mobile" || type === "server" || type === "xr"
    ? type
    : "other";
};

/**
 * Chooses the displayed targets, in their order within each group.
 *
 * - An explicit list is honored literally: a listed target absent from the payload is still shown,
 *   in the "other" group, with no data in every cell.
 * - Without one, the default targets are intersected with the payload's targets.
 * - When that intersection is empty, every target in the payload is shown, in the payload's order,
 *   rather than an empty table.
 *
 * Time and space are O(T) for an explicit or default list, and O(B) for the payload's B targets in
 * the last case.
 */
export const selectTargets = (
  browsers: Readonly<Record<string, SupportTarget>>,
  explicit: readonly string[] | null,
): TableTarget[] => {
  const describe = (id: string): TableTarget => {
    const target = Object.hasOwn(browsers, id) ? browsers[id] : undefined;
    return {
      id,
      name: target?.name ?? id,
      previewName: target?.previewName ?? null,
      inPayload: target !== undefined,
      group: groupOf(target),
    };
  };

  if (explicit !== null) return explicit.map(describe);
  const defaults = DEFAULT_TARGETS.filter((id) => Object.hasOwn(browsers, id));
  return (defaults.length > 0 ? defaults : Object.keys(browsers)).map(describe);
};

/** A column group and its targets, in display order. */
export type TargetGroup = {
  readonly id: ColumnGroupId;
  readonly targets: readonly TableTarget[];
};

/**
 * Sorts the displayed targets into groups in `COLUMN_GROUP_ORDER`, keeping their order within a
 * group and leaving out any group with no target. One pass places each target in its group's
 * bucket, and one pass over the five groups collects the buckets: O(T) time and space.
 */
export const groupTargets = (targets: readonly TableTarget[]): TargetGroup[] => {
  const buckets = new Map<ColumnGroupId, TableTarget[]>(COLUMN_GROUP_ORDER.map((id) => [id, []]));
  for (const target of targets) buckets.get(target.group)?.push(target);
  return COLUMN_GROUP_ORDER.flatMap((id) => {
    const members = buckets.get(id) ?? [];
    return members.length === 0 ? [] : [{ id, targets: members }];
  });
};
