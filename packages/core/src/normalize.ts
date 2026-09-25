import type {
  BrowserName,
  Browsers,
  Identifier,
  SupportStatement as BcdSupportStatement,
} from "@mdn/browser-compat-data/types";
import type { Feature, SupportTarget } from "@bcd-embed/schema";

import { flattenFeatureSubtree } from "./flatten.js";
import { normalizeTargetSupport } from "./support.js";

export type NormalizeFeatureSubtreeInput = {
  key: string;
  subtree: Identifier;
  browsers: Browsers;
};

export type NormalizedFeatureSubtree = {
  features: Feature[];
  browsers: Record<string, SupportTarget>;
};

export class BcdNormalizationError extends Error {
  readonly key: string;

  constructor(key: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BcdNormalizationError";
    this.key = key;
  }
}

const list = <Value>(value: Value | [Value, Value, ...Value[]] | undefined): Value[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

/** Normalize one addressable BCD subtree without adding response-envelope concerns. */
export const normalizeFeatureSubtree = ({
  key,
  subtree,
  browsers,
}: NormalizeFeatureSubtreeInput): NormalizedFeatureSubtree => {
  let records;
  try {
    records = flattenFeatureSubtree(key, subtree);
  } catch (error) {
    throw new BcdNormalizationError(key, `Failed to flatten BCD subtree '${key}'.`, {
      cause: error,
    });
  }

  const describedTargets: Record<string, SupportTarget> = {};
  const features = records.map(({ key: featureKey, name, depth, compat }) => {
    try {
      const support = Object.fromEntries(
        Object.entries(compat.support).map(([target, rawSupport]) => {
          const metadata = browsers[target as BrowserName];
          if (metadata === undefined) {
            throw new Error(`Missing BCD browser metadata for support target '${target}'.`);
          }
          describedTargets[target] ??= {
            name: metadata.name,
            type: metadata.type,
            previewName: metadata.preview_name ?? null,
          };
          return [target, normalizeTargetSupport(rawSupport as BcdSupportStatement, metadata)];
        }),
      );

      return {
        key: featureKey,
        name,
        depth,
        description: compat.description ?? null,
        mdnUrl: compat.mdn_url ?? null,
        specUrls: list(compat.spec_url),
        status:
          compat.status === undefined
            ? null
            : {
                experimental: compat.status.experimental,
                standardTrack: compat.status.standard_track,
                deprecated: compat.status.deprecated,
              },
        tags: compat.tags ?? [],
        support,
      } as Feature;
    } catch (error) {
      throw new BcdNormalizationError(
        featureKey,
        `Failed to normalize BCD feature '${featureKey}'.`,
        { cause: error },
      );
    }
  });

  return { features, browsers: describedTargets };
};
