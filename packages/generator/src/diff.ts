import { createHash } from "node:crypto";

import { loadContentTree } from "./load-content-tree.js";
import type { ContentTree } from "./content-tree.js";

/** Conservative defaults; operators may change these reviewed source constants. */
export const DEFAULT_DIFF_POLICY = Object.freeze({
  maxChangedFeatures: 2_500,
  maxChangedPercent: 10,
  maxAddedFeatures: 500,
  maxAddedPercent: 2,
  maxRemovedFeatures: 50,
  maxRemovedPercent: 0.25,
});

export type DiffApproval = {
  baselineDigest: string;
  candidateDigest: string;
  approved: true;
  reason: string;
};

/** Hash of an empty baseline, so that a bootstrap approval still names two exact digests. */
export const EMPTY_TREE_DIGEST = createHash("sha256").update("empty-content-tree").digest("hex");

export type DiffReport = {
  /** The hash of the baseline's root file, or `EMPTY_TREE_DIGEST` when there is no baseline. */
  baselineDigest: string;
  /** The hash of the candidate's root file, which covers its identifier and every pointer. */
  candidateDigest: string;
  /** Digest of the baseline's pointers alone; null when there is no baseline (bootstrap). */
  baselineSemanticDigest: string | null;
  semanticDigest: string;
  semanticChanged: boolean;
  baselineVersion: string | null;
  candidateVersion: string;
  features: {
    baseline: number;
    candidate: number;
    added: number;
    removed: number;
    changed: number;
  };
  indexes: {
    addedKeys: number;
    removedKeys: number;
    changedShards: number;
    globalIndexChanged: boolean;
  };
  browsersChanged: boolean;
  namespaces: { added: string[]; removed: string[] };
  bootstrap: boolean;
  policy: typeof DEFAULT_DIFF_POLICY;
  blocked: string[];
  approved: boolean;
};

const percent = (count: number, total: number): number => (total === 0 ? 0 : (count / total) * 100);

export class DiffApprovalMismatchError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DiffApprovalMismatchError";
  }
}

const validateApproval = (value: unknown): DiffApproval => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Approval must be a JSON object.");
  }
  const approval = value as Record<string, unknown>;
  if (
    Object.keys(approval).sort().join(",") !== "approved,baselineDigest,candidateDigest,reason" ||
    approval.approved !== true ||
    typeof approval.baselineDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(approval.baselineDigest) ||
    typeof approval.candidateDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(approval.candidateDigest) ||
    typeof approval.reason !== "string" ||
    approval.reason.trim().length < 8
  ) {
    throw new Error(
      "Approval must contain exact SHA-256 digests, approved:true, and a reason of at least 8 characters.",
    );
  }
  return approval as DiffApproval;
};

export const parseDiffApproval = (value: unknown): DiffApproval => validateApproval(value);

export type CompareOutputTreesOptions = {
  baselineRoot: string;
  candidateRoot: string;
  approval?: unknown;
};

/**
 * Compares two snapshots by their pointers. A feature counts as changed when the hash of its
 * normalized file or of its raw file differs, so no file body is read here.
 *
 * Time and space are O(N) for N feature keys. `baseline` is `null` when nothing is published yet.
 */
export const compareContentTrees = (
  baseline: ContentTree | null,
  candidate: ContentTree,
  unparsedApproval?: unknown,
): DiffReport => {
  const bootstrap = baseline === null;
  const baselineFeatures = baseline?.features ?? new Map<string, never>();
  const baselineDigest = baseline?.digest ?? EMPTY_TREE_DIGEST;

  let added = 0;
  let changed = 0;
  for (const [key, pointer] of candidate.features) {
    const previous = baselineFeatures.get(key);
    if (previous === undefined) added += 1;
    else if (previous.feature !== pointer.feature || previous.raw !== pointer.raw) changed += 1;
  }
  let removed = 0;
  for (const key of baselineFeatures.keys()) if (!candidate.features.has(key)) removed += 1;

  const baselineNamespaces = new Set(baseline?.namespaces ?? []);
  const candidateNamespaces = new Set(candidate.namespaces);
  const namespacesAdded = candidate.namespaces.filter((name) => !baselineNamespaces.has(name));
  const namespacesRemoved = [...baselineNamespaces].filter(
    (name) => !candidateNamespaces.has(name),
  );
  const structuralChanged = (path: string): boolean =>
    baseline === null || baseline.root.structural[path] !== candidate.root.structural[path];
  const changedShards = bootstrap
    ? 0
    : candidate.namespaces.filter(
        (name) => baselineNamespaces.has(name) && structuralChanged(`index/${name}.json`),
      ).length;

  const denominator = Math.max(baselineFeatures.size, candidate.features.size);
  const blocked: string[] = [];
  if (bootstrap) blocked.push("Bootstrap has no approved baseline.");
  if (
    changed > DEFAULT_DIFF_POLICY.maxChangedFeatures ||
    percent(changed, denominator) > DEFAULT_DIFF_POLICY.maxChangedPercent
  ) {
    blocked.push("Changed feature magnitude exceeds the reviewed policy.");
  }
  if (
    !bootstrap &&
    (added > DEFAULT_DIFF_POLICY.maxAddedFeatures ||
      percent(added, candidate.features.size) > DEFAULT_DIFF_POLICY.maxAddedPercent)
  )
    blocked.push("Added feature magnitude exceeds the reviewed policy.");
  if (
    removed > DEFAULT_DIFF_POLICY.maxRemovedFeatures ||
    percent(removed, baselineFeatures.size) > DEFAULT_DIFF_POLICY.maxRemovedPercent
  )
    blocked.push("Removed feature magnitude exceeds the reviewed policy.");
  if (!bootstrap && (namespacesAdded.length > 0 || namespacesRemoved.length > 0)) {
    blocked.push("Namespace structure changes require explicit review.");
  }

  let approved = false;
  if (unparsedApproval !== undefined) {
    const approval = validateApproval(unparsedApproval);
    if (
      approval.baselineDigest !== baselineDigest ||
      approval.candidateDigest !== candidate.digest
    ) {
      throw new DiffApprovalMismatchError(
        "Approval digest does not match these exact baseline and candidate trees.",
      );
    }
    approved = true;
  }
  return {
    baselineDigest,
    candidateDigest: candidate.digest,
    baselineSemanticDigest: baseline?.semanticDigest ?? null,
    semanticDigest: candidate.semanticDigest,
    semanticChanged: bootstrap || baseline.semanticDigest !== candidate.semanticDigest,
    baselineVersion: baseline?.sourceVersion ?? null,
    candidateVersion: candidate.sourceVersion,
    features: {
      baseline: baselineFeatures.size,
      candidate: candidate.features.size,
      added,
      removed,
      changed,
    },
    // The global index lists exactly the feature keys, so its key counts equal the feature counts.
    indexes: {
      addedKeys: added,
      removedKeys: removed,
      changedShards,
      globalIndexChanged: structuralChanged("index.json"),
    },
    browsersChanged: structuralChanged("browsers.json"),
    namespaces: { added: namespacesAdded, removed: namespacesRemoved.sort() },
    bootstrap,
    policy: DEFAULT_DIFF_POLICY,
    blocked,
    approved,
  };
};

/** Loads and fully checks two emitted snapshots, then compares their pointers. */
export const compareOutputTrees = async ({
  baselineRoot,
  candidateRoot,
  approval,
}: CompareOutputTreesOptions): Promise<DiffReport> => {
  const baseline = await loadContentTree(baselineRoot);
  const candidate = await loadContentTree(candidateRoot);
  if (candidate === null) throw new Error("Candidate artifact tree must not be empty.");
  return compareContentTrees(baseline, candidate, approval);
};
