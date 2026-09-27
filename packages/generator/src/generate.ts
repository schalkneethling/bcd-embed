import { createRequire } from "node:module";
import type { Identifier } from "@mdn/browser-compat-data/types";
import { normalizeFeatureSubtree } from "@bcd-embed/core";
import {
  CONTRACT_VERSION,
  featureKeySchema,
  namespaceSchema,
  generatedTimestampSchema,
  snapshotSchema,
  featureResponseSchema,
  browsersResponseSchema,
  indexResponseSchema,
  metaResponseSchema,
  type Snapshot,
  type FeatureResponse,
  type BrowsersResponse,
  type IndexResponse,
  type MetaResponse,
} from "@bcd-embed/schema";
import packageManifest from "../package.json" with { type: "json" };
import { validateBcdInput, validateRawArtifact, BcdInputError } from "./input.js";

export const GENERATOR_VERSION = packageManifest.version;
const require = createRequire(import.meta.url);

export type GenerateSnapshotOptions = { generated: string; expires: string; data?: unknown };
export type GeneratedArtifact =
  | { kind: "feature"; path: string; data: FeatureResponse }
  | { kind: "raw"; path: string; data: Identifier }
  | { kind: "browsers"; path: string; data: BrowsersResponse }
  | { kind: "index"; path: string; data: IndexResponse }
  | { kind: "meta"; path: string; data: MetaResponse };
export type GeneratedSnapshot = {
  snapshot: Snapshot;
  namespaces: readonly string[];
  artifacts: Iterable<GeneratedArtifact>;
};

type AddressableNode = { key: string; subtree: Identifier };

/** Validate/discover once; normalize overlapping subtrees only as their artifacts are consumed. */
export const generateSnapshot = ({
  generated,
  expires,
  data = require("@mdn/browser-compat-data"),
}: GenerateSnapshotOptions): GeneratedSnapshot => {
  generatedTimestampSchema.parse(generated);
  validateBcdInput(data);
  const source = { package: "@mdn/browser-compat-data" as const, version: data.__meta.version };
  const snapshot = snapshotSchema.parse({
    id: `bcd-${source.version}-gen-${GENERATOR_VERSION}`,
    source,
    generatorVersion: GENERATOR_VERSION,
    generated,
    expires,
  });
  if (Date.parse(expires) <= Date.parse(generated)) {
    throw new BcdInputError("Expiry must be later than the generation timestamp.");
  }
  const envelope = { contract: CONTRACT_VERSION, generated, source };
  const nodes: AddressableNode[] = [];
  const shards = new Map<string, string[]>();
  const keys = new Set<string>();
  const visit = (key: string, subtree: Identifier, shard: string[]) => {
    if (Object.hasOwn(subtree, "__compat")) {
      featureKeySchema.parse(key);
      if (keys.has(key)) throw new BcdInputError(`Duplicate generated key '${key}'.`);
      keys.add(key);
      nodes.push({ key, subtree });
      shard.push(key);
    }
    for (const [segment, child] of Object.entries(subtree)) {
      if (segment !== "__compat") {
        if (segment.length === 0)
          throw new BcdInputError(`Empty BCD key segment beneath '${key}'.`);
        visit(`${key}.${segment}`, child as Identifier, shard);
      }
    }
  };
  for (const [namespace, tree] of Object.entries(data)) {
    if (namespace === "__meta" || namespace === "browsers") continue;
    namespaceSchema.parse(namespace);
    const shard: string[] = [];
    visit(namespace, tree as Identifier, shard);
    if (shard.length > 0) shards.set(namespace, shard);
  }
  if (nodes.length === 0) throw new BcdInputError("BCD contains no addressable features.");
  const namespaces = Object.freeze([...shards.keys()]);
  const root = `v1/${snapshot.id}`;
  let consumed = false;
  const artifacts: Iterable<GeneratedArtifact> = {
    [Symbol.iterator]() {
      if (consumed)
        throw new BcdInputError(
          "Snapshot artifacts are single-use; create a new generation to rerun.",
        );
      consumed = true;
      return (function* (): Generator<GeneratedArtifact> {
        for (const { key, subtree } of nodes) {
          // Validate before either member of the feature/raw pair becomes observable.
          let response: FeatureResponse;
          try {
            validateRawArtifact(subtree);
          } catch (cause) {
            throw new BcdInputError(`Invalid raw artifact '${root}/raw/${key}.json'.`, { cause });
          }
          try {
            response = featureResponseSchema.parse({
              ...envelope,
              query: key,
              ...normalizeFeatureSubtree({ key, subtree, browsers: data.browsers }),
            });
          } catch (cause) {
            throw new BcdInputError(`Invalid normalized artifact '${root}/features/${key}.json'.`, {
              cause,
            });
          }
          yield { kind: "feature", path: `${root}/features/${key}.json`, data: response };
          yield { kind: "raw", path: `${root}/raw/${key}.json`, data: subtree };
        }
        const browsers = browsersResponseSchema.parse({
          ...envelope,
          browsers: Object.fromEntries(
            Object.entries(data.browsers).map(([id, browser]) => [
              id,
              {
                name: browser.name,
                type: browser.type,
                previewName: browser.preview_name ?? null,
                releases: Object.entries(browser.releases).map(([version, release]) => ({
                  version,
                  releaseDate: release.release_date ?? null,
                  status: release.status,
                })),
              },
            ]),
          ),
        });
        yield { kind: "browsers", path: `${root}/browsers.json`, data: browsers };
        yield {
          kind: "index",
          path: `${root}/index.json`,
          data: indexResponseSchema.parse({
            ...envelope,
            namespace: null,
            keys: nodes.map(({ key }) => key),
          }),
        };
        for (const [namespace, shard] of shards) {
          yield {
            kind: "index",
            path: `${root}/index/${namespace}.json`,
            data: indexResponseSchema.parse({ ...envelope, namespace, keys: shard }),
          };
        }
        yield {
          kind: "meta",
          path: "v1/meta.json",
          data: metaResponseSchema.parse({
            contract: CONTRACT_VERSION,
            generated,
            current: snapshot.id,
            snapshots: [snapshot],
            namespaces,
          }),
        };
      })();
    },
  };
  return { snapshot, namespaces, artifacts };
};
