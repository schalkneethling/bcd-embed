const countCompatibilityFeatures = (value) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return 0;

  return (
    (Object.hasOwn(value, "__compat") ? 1 : 0) +
    Object.values(value).reduce((total, child) => total + countCompatibilityFeatures(child), 0)
  );
};

export const createFixtureReport = ({ normalized, cases, source }) => {
  const caseEntries = Object.entries(cases).flatMap(([name, keyOrKeys]) =>
    (Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys]).map((key) => {
      const feature = normalized.features.find((candidate) => candidate.key === key);
      if (!feature) throw new Error(`Fixture case '${name}' references missing feature '${key}'.`);

      return {
        name,
        key,
        depth: feature.depth,
        targets: Object.entries(feature.support).map(([target, support]) => ({
          target,
          state: support.summary.state,
          selectedIdentity: {
            prefix: support.summary.prefix,
            alternativeName: support.summary.alternativeName,
          },
          branches: support.branches.length,
          statements: support.branches.reduce(
            (total, branch) => total + branch.statements.length,
            0,
          ),
        })),
      };
    }),
  );

  const subtrees = Object.entries(source.subtrees).map(([key, subtree]) => ({
    key,
    compatibilityFeatures: countCompatibilityFeatures(subtree),
    bytes: Buffer.byteLength(JSON.stringify(subtree)),
  }));

  return {
    contract: normalized.contract,
    source: source.source,
    normalizedFeatures: normalized.features.length,
    namedCases: caseEntries,
    sourceFragments: Object.keys(source.fragments).length,
    subtrees,
  };
};

export const formatFixtureReport = (report) => {
  const lines = [
    `v${report.contract} golden fixtures from ${report.source.package}@${report.source.version}`,
    `${report.normalizedFeatures} normalized features; ${report.namedCases.length} named case entries; ${report.sourceFragments} source fragments`,
    "",
    "Named cases",
  ];

  for (const item of report.namedCases) {
    lines.push(`- ${item.name}: ${item.key} (depth ${item.depth})`);
    for (const target of item.targets) {
      const identity = target.selectedIdentity.prefix
        ? `prefix=${target.selectedIdentity.prefix}`
        : target.selectedIdentity.alternativeName
          ? `alternativeName=${target.selectedIdentity.alternativeName}`
          : "canonical";
      lines.push(
        `  ${target.target}: ${target.state}; ${identity}; ${target.branches} ${target.branches === 1 ? "branch" : "branches"} / ${target.statements} ${target.statements === 1 ? "statement" : "statements"}`,
      );
    }
  }

  lines.push("", "Source subtrees");
  for (const subtree of report.subtrees) {
    lines.push(
      `- ${subtree.key}: ${subtree.compatibilityFeatures} compatibility features; ${subtree.bytes} bytes`,
    );
  }

  return `${lines.join("\n")}\n`;
};
