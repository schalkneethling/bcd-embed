// The English string table. Every sentence the component renders is a message here, keyed by id,
// with `{placeholders}` for the values that change (Document 3 section 4). A template never holds a
// string literal, and a sentence is never built by joining fragments, because word order differs
// between languages. The ids and wording follow the string inventory in
// `docs/planning/07-component-phase1-markup.md`.
export const en = {
  // Table structure.
  caption: "Browser compatibility: {query}",
  "header-feature": "Feature",

  // Support target groups, named by the contract's support target `type`, plus the fallback group.
  "platform-desktop": "Desktop",
  "platform-mobile": "Mobile",
  "platform-xr": "Extended reality",
  "platform-server": "Server",
  "platform-other": "Other",

  // A cell's accessible name states the whole fact, including the support target.
  "supported-since": "Supported since {target} {version}",
  "supported-since-or-earlier": "Supported since {target} {version} or earlier",
  "supported-prefixed": "Supported since {target} {version} with the prefix {prefix}",
  "supported-flagged": "Supported since {target} {version} behind a flag",
  "supported-alternative-name": "Supported since {target} {version} under the name {name}",
  "supported-preview": "Supported in {target} {version}, a preview release",
  // For BCD's literal `version_added: "preview"`, which names no version, so `{version}` would
  // read "Supported in Safari preview, a preview release".
  "supported-preview-unversioned": "Supported in a preview release of {target}",
  "supported-preview-flagged": "Supported behind a flag in {target} {version}, a preview release",
  "supported-preview-unversioned-flagged":
    "Supported behind a flag in a preview release of {target}",
  "partial-since": "Partial support since {target} {version}",
  "partial-prefixed": "Partial support since {target} {version} with the prefix {prefix}",
  "partial-alternative-name": "Partial support since {target} {version} under the name {name}",
  "partial-flagged": "Partial support since {target} {version} behind a flag",
  "partial-preview": "Partial support in {target} {version}, a preview release",
  "partial-preview-unversioned": "Partial support in a preview release of {target}",
  "no-support": "No support in {target}",
  unknown: "Support unknown in {target}",
  "no-data": "No data for {target}",

  // Values for the `{version}`, `{added}`, and `{removed}` placeholders above and below. An
  // approximate version (BCD's `≤`) is passed as `version-or-earlier`, except in the plain
  // supported sentence, which has its own message, `supported-since-or-earlier`. A removal or
  // last-supported version that is BCD's literal "preview" is passed as the target's preview
  // name, such as "Nightly", or as `version-preview` when the target has none.
  "version-or-earlier": "{version} or earlier",
  "version-preview": "preview",

  // The short visible text beside a cell's icon. It is hidden from assistive technology, which
  // reads the cell's full sentence instead.
  "compact-or-earlier": "≤{version}",
  "compact-range": "{added} – {removed}",
  "compact-preview": "{version} (preview)",
  "compact-preview-unversioned": "preview",

  // Row headers.
  "part-of": "(part of {parent})",

  // Names for a cell's disclosure.
  "disclosure-history": "History for {feature} in {target}",
  "disclosure-history-notes": "History and notes for {feature} in {target}",
  "disclosure-notes": "Notes for {feature} in {target}",
  "disclosure-flag": "Flag details for {feature} in {target}",
  // The text of a disclosure's summary: the cell's fact, then the label that names the cell.
  "disclosure-summary": "{fact}. {label}",

  // The history inside a disclosure: one sentence for each support statement, in the order of
  // the payload's branches. A statement with a prefix or an alternative name has its own
  // sentences for the four commonest forms. Any other form uses the plain sentence followed by
  // `history-uses-prefix` or `history-uses-alternative-name`, so the name is never lost.
  "history-supported": "Supported since {target} {version}.",
  "history-flagged": "Supported since {target} {version} behind a flag.",
  "history-partial": "Partial support since {target} {version}.",
  "history-partial-flagged": "Partial support since {target} {version} behind a flag.",
  "history-preview": "Supported in {target} {version}, a preview release.",
  "history-partial-preview": "Partial support in {target} {version}, a preview release.",
  "history-preview-unversioned": "Supported in a preview release of {target}.",
  "history-partial-preview-unversioned": "Partial support in a preview release of {target}.",
  "history-removed": "Supported from {target} {added}, removed in {target} {removed}.",
  "history-partial-removed":
    "Partially supported from {target} {added}, removed in {target} {removed}.",
  "history-no-support": "No support in {target}.",
  "history-unknown": "Support unknown in {target}.",
  "history-prefixed": "With the prefix {prefix}: supported since {target} {version}.",
  "history-prefixed-partial": "With the prefix {prefix}: partial support since {target} {version}.",
  "history-prefixed-removed":
    "With the prefix {prefix}: supported from {target} {added}, removed in {target} {removed}.",
  "history-prefixed-partial-removed":
    "With the prefix {prefix}: partially supported from {target} {added}, removed in {target} {removed}.",
  "history-alternative": "Under the name {name}: supported since {target} {version}.",
  "history-alternative-partial": "Under the name {name}: partial support since {target} {version}.",
  "history-alternative-removed":
    "Under the name {name}: supported from {target} {added}, removed in {target} {removed}.",
  "history-alternative-partial-removed":
    "Under the name {name}: partially supported from {target} {added}, removed in {target} {removed}.",
  "history-uses-prefix": "This uses the prefix {prefix}.",
  "history-uses-alternative-name": "This uses the name {name}.",
  "history-last-supported": "Last supported in {target} {version}.",

  // Flag details inside a disclosure. A preference is a setting that the user changes inside the
  // browser. A runtime flag is a command-line option, and BCD uses it for browsers (Chrome's
  // `--enable-blink-features`) as well as for runtimes (Node.js). BCD's `value_to_set` is optional,
  // so a preference has a message without a value, and so does a runtime flag.
  "flag-preference": "To enable it, set the preference {name} to {value}.",
  "flag-preference-no-value": "To enable it, set the preference {name}.",
  "flag-runtime": "To enable it, start {target} with the command-line flag {name}.",
  "flag-runtime-value":
    "To enable it, start {target} with the command-line flag {name} set to {value}.",

  note: "Note: {text}",

  // Loading and error states.
  loading: "Loading browser compatibility data for {query}.",
  error: "Browser compatibility data for {query} could not be loaded.",
} as const;
