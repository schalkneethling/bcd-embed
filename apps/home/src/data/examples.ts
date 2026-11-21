import type { CompatData, Identifier } from "@mdn/browser-compat-data/types";
import { normalizeFeatureSubtree } from "@bcd-embed/core";
import { CONTRACT_VERSION, featureResponseSchema, type FeatureResponse } from "@bcd-embed/schema";

/** The four examples the page offers, in the order of their radio inputs. */
export type ExampleId = "html" | "css" | "javascript" | "api";

export type ExampleDefinition = {
  /** The radio input's value, and the suffix of the radio's and the panel's `id`. */
  readonly id: ExampleId;
  /** The radio input's visible label. */
  readonly label: string;
  /** The BCD dotted key of the feature. */
  readonly key: string;
  /** The feature's name as code, for the heading and the fallback link. */
  readonly name: string;
  /** One sentence under the panel heading that says what the feature does. */
  readonly summary: string;
};

export const EXAMPLES: readonly ExampleDefinition[] = [
  {
    id: "html",
    label: "HTML",
    key: "html.elements.video.loading",
    name: "loading",
    summary: "Lazy loading for the video element, set with its loading attribute.",
  },
  {
    id: "css",
    label: "CSS",
    key: "css.properties.line-clamp",
    name: "line-clamp",
    summary: "Limits a block of text to a number of lines.",
  },
  {
    // Partial implementations in Safari and Node.js, and a Node.js history, make this table more
    // interesting than a key that every engine supports in full (#209).
    id: "javascript",
    label: "JavaScript",
    key: "javascript.builtins.Error.isError",
    name: "Error.isError()",
    summary:
      "Tells whether a value is an error object, even one created in another window or frame.",
  },
  {
    id: "api",
    label: "Web API",
    key: "api.Navigator.share",
    name: "Navigator.share()",
    summary: "Opens the operating system's share dialog for a link, some text, or files.",
  },
];

/** The feature the fetch-mode table requests from the hosted API when it scrolls near. */
export const LIVE_EXAMPLE = { key: "html.elements.dialog", name: "<dialog>" } as const;

export class HomeDataError extends Error {
  readonly key: string;

  constructor(key: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HomeDataError";
    this.key = key;
  }
}

type Node = Record<string, unknown>;

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Walks from the root of BCD down the key's segments, calling `visit` with each node on the way.
 * `Object.hasOwn` keeps a segment such as `constructor` from reaching `Object.prototype`.
 * O(d) time for a key of d segments.
 */
const walk = (bcd: CompatData, key: string, visit: (node: Node) => void): Node => {
  let node: unknown = bcd;
  for (const segment of key.split(".")) {
    if (!isNode(node) || !Object.hasOwn(node, segment)) {
      throw new HomeDataError(key, `BCD ${bcd.__meta.version} has no feature '${key}'.`);
    }
    node = node[segment];
    if (isNode(node)) visit(node);
  }
  if (!isNode(node) || !isNode(node.__compat)) {
    throw new HomeDataError(key, `BCD ${bcd.__meta.version} has no feature '${key}'.`);
  }
  return node;
};

/** The feature's subtree. Throws `HomeDataError` when BCD has no feature at the key. */
export const findSubtree = (bcd: CompatData, key: string): Identifier =>
  walk(bcd, key, () => {}) as Identifier;

/**
 * The address of the feature's compatibility section on MDN Web Docs. A feature without its own
 * page, such as `html.elements.video.loading`, links to the nearest ancestor that has one.
 * O(d) time for a key of d segments.
 */
export const findMdnUrl = (bcd: CompatData, key: string): string => {
  let url: string | undefined;
  walk(bcd, key, (node) => {
    const compat = node.__compat;
    if (isNode(compat) && typeof compat.mdn_url === "string") url = compat.mdn_url;
  });
  if (url === undefined) {
    throw new HomeDataError(key, `No feature on the path to '${key}' has an MDN Web Docs page.`);
  }
  return `${url}#browser_compatibility`;
};

/**
 * The feature response the API would answer for the key: the normalized subtree in the contract's
 * envelope, checked against `featureResponseSchema`. O(s) time and space for a subtree of s
 * statements, notes and flags, which for the page's four keys is a few kilobytes each.
 */
export const buildFeatureResponse = (bcd: CompatData, key: string): FeatureResponse => {
  const subtree = findSubtree(bcd, key);
  return featureResponseSchema.parse({
    contract: CONTRACT_VERSION,
    query: key,
    ...normalizeFeatureSubtree({ key, subtree, browsers: bcd.browsers }),
  });
};

/**
 * The text of a `<script type="application/json">` that holds the payload. Every `<` becomes the
 * six characters `<`, which `JSON.parse` turns back into `<`. This is the page's one
 * injection control: a note that contains `</script>` or `<!--<script>` would otherwise end the
 * script early or swallow the rest of the page (packages/element/README.md, "Source mode").
 * O(n) time and space for n characters of JSON.
 */
export const toScriptJson = (payload: unknown): string =>
  JSON.stringify(payload).replaceAll("<", "\\u003c");

/** The `id` of the JSON script, written as the element's README recommends. */
export const dataScriptId = (key: string): string => `bcd-data-${key.replaceAll(".", "-")}`;

export type ExamplePanel = ExampleDefinition & {
  readonly scriptId: string;
  readonly scriptJson: string;
  readonly mdnUrl: string;
};

export type HomePageData = {
  readonly bcdVersion: string;
  readonly examples: readonly ExamplePanel[];
  readonly live: typeof LIVE_EXAMPLE & { readonly mdnUrl: string };
};

/**
 * Everything the page needs from BCD. Throws when any key is missing, so a BCD release that
 * renames or removes one fails the build instead of shipping an empty panel.
 */
export const buildHomePageData = (bcd: CompatData): HomePageData => ({
  bcdVersion: bcd.__meta.version,
  examples: EXAMPLES.map((example) => ({
    ...example,
    scriptId: dataScriptId(example.key),
    scriptJson: toScriptJson(buildFeatureResponse(bcd, example.key)),
    mdnUrl: findMdnUrl(bcd, example.key),
  })),
  live: { ...LIVE_EXAMPLE, mdnUrl: findMdnUrl(bcd, LIVE_EXAMPLE.key) },
});
