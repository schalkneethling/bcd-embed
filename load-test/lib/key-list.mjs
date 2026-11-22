// Builds the load test's key list from a snapshot's feature index. Node only.
//
// Cost: one pass over the N index keys to build a set (O(N) time and space), one stride pass for
// the sample, one filter for the deep keys, and one pass that collects dot-boundary prefixes.
// The output holds a few thousand keys whatever N is.

/** The feature-key grammar of `featureKeySchema` in @bcd-embed/schema, without empty segments. */
export const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._$@-]*$/;

export const isPublicFeatureKey = (key) =>
  typeof key === "string" &&
  key.length <= 512 &&
  KEY_PATTERN.test(key) &&
  key.split(".").every((segment) => segment.length > 0);

/** Keys that real pages embed most, chosen by judgement. See the plan for what this cannot show. */
export const POPULAR_CANDIDATES = [
  "api.AbortController",
  "api.CSS",
  "api.Document",
  "api.Element",
  "api.IntersectionObserver",
  "api.Navigator",
  "api.Request",
  "api.ResizeObserver",
  "api.Response",
  "api.URL",
  "api.WebSocket",
  "api.Window",
  "api.fetch",
  "css.at-rules.container",
  "css.at-rules.media",
  "css.properties.animation",
  "css.properties.aspect-ratio",
  "css.properties.background-color",
  "css.properties.color",
  "css.properties.container-type",
  "css.properties.display",
  "css.properties.flex",
  "css.properties.gap",
  "css.properties.grid",
  "css.properties.margin",
  "css.properties.padding",
  "css.properties.position",
  "css.properties.transform",
  "css.properties.transition",
  "css.selectors.has",
  "css.selectors.is",
  "html.elements.a",
  "html.elements.button",
  "html.elements.dialog",
  "html.elements.div",
  "html.elements.img",
  "html.elements.input",
  "html.elements.table",
  "html.elements.video",
  "http.headers.Content-Security-Policy",
  "javascript.builtins.Array",
  "javascript.builtins.JSON",
  "javascript.builtins.Map",
  "javascript.builtins.Object",
  "javascript.builtins.Promise",
  "javascript.builtins.String",
  "javascript.operators.optional_chaining",
  "javascript.statements.async_function",
  "svg.elements.svg",
];

/** Keys under an unknown top-level segment, which the handler answers without an index read. */
const UNKNOWN_NAMESPACE_KEYS = [
  "unknown_namespace.load_test_missing_a",
  "unknown_namespace.load_test_missing_b",
];

/**
 * @param {object} input
 * @param {readonly string[]} input.indexKeys every feature key of the snapshot, from `index.json`
 * @param {readonly string[]} input.namespaces the snapshot's top-level namespaces
 * @param {string} input.snapshot the snapshot identifier
 * @param {string} input.sourceVersion the BCD version the snapshot came from
 * @param {string} input.contract the contract version
 */
export const buildKeyList = ({
  indexKeys,
  namespaces,
  snapshot,
  sourceVersion,
  contract,
  popularCandidates = POPULAR_CANDIDATES,
  sampledCount = 1000,
  deepCount = 100,
  deepMinSegments = 6,
  missingPerNamespace = 2,
}) => {
  const keys = new Set(indexKeys);
  const absent = popularCandidates.filter((key) => !keys.has(key));
  if (absent.length > 0) {
    throw new Error(`Popular candidates missing from the index: ${absent.join(", ")}`);
  }
  const everyKey = [...keys].sort();

  const stride = Math.max(1, Math.floor(everyKey.length / sampledCount));
  const sampled = [];
  for (let index = 0; index < everyKey.length && sampled.length < sampledCount; index += stride) {
    sampled.push(everyKey[index]);
  }

  const deepStride = (candidates) => Math.max(1, Math.floor(candidates.length / deepCount));
  const deepCandidates = everyKey.filter((key) => key.split(".").length >= deepMinSegments);
  const deep = [];
  const step = deepStride(deepCandidates);
  for (let index = 0; index < deepCandidates.length && deep.length < deepCount; index += step) {
    deep.push(deepCandidates[index]);
  }

  // A key that exists as a dot-boundary prefix of indexed keys but is not itself indexed is an
  // organizational namespace, which the API answers with namespace_not_queryable.
  const prefixes = new Set();
  for (const key of everyKey) {
    const segments = key.split(".");
    for (let length = 1; length < segments.length && length <= 2; length += 1) {
      const prefix = segments.slice(0, length).join(".");
      if (!keys.has(prefix)) prefixes.add(prefix);
    }
  }
  const grouping = [...prefixes].sort();

  const missing = [];
  for (let n = 1; n <= missingPerNamespace; n += 1) {
    for (const namespace of namespaces) {
      const key = `${namespace}.load_test_missing_${String(n).padStart(2, "0")}`;
      if (!keys.has(key)) missing.push(key);
    }
  }
  missing.push(...UNKNOWN_NAMESPACE_KEYS);

  return {
    snapshot,
    sourceVersion,
    contract,
    namespaces: [...namespaces],
    popular: [...popularCandidates],
    deep,
    sampled,
    grouping,
    missing,
  };
};

/** Every key in the list, for tests and checks. */
export const allListedKeys = (list) => [
  ...list.popular,
  ...list.deep,
  ...list.sampled,
  ...list.grouping,
  ...list.missing,
];
