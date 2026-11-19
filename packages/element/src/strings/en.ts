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
  "supported-preview": "Supported in {target} {version}, a preview release",
  "partial-since": "Partial support since {target} {version}",
  "partial-preview": "Partial support in {target} {version}, a preview release",
  "no-support": "No support in {target}",
  unknown: "Support unknown in {target}",
  "no-data": "No data for {target}",

  // Row headers.
  "part-of": "(part of {parent})",

  // Names for a cell's disclosure.
  "disclosure-history": "History for {feature} in {target}",
  "disclosure-history-notes": "History and notes for {feature} in {target}",
  "disclosure-notes": "Notes for {feature} in {target}",
  "disclosure-flag": "Flag details for {feature} in {target}",

  // The history inside a disclosure.
  "history-prefixed": "With the prefix {prefix}: supported since {target} {version}.",
  "history-alternative-removed":
    "Under the name {name}: supported from {target} {added}, removed in {target} {removed}.",
  "history-removed": "Supported from {target} {added}, removed in {target} {removed}.",
  "history-partial-removed":
    "Partially supported from {target} {added}, removed in {target} {removed}.",
  "history-last-supported": "Last supported in {target} {version}.",

  // Flag details inside a disclosure. A preference is a browser setting, and a runtime flag is a
  // command-line option of a runtime such as Node.js.
  "flag-preference": "To enable it, set the preference {name} to {value}.",
  "flag-runtime": "To enable it, start the runtime with the flag {name}.",
  "flag-runtime-value": "To enable it, start the runtime with the flag {name} set to {value}.",

  note: "Note: {text}",

  // Loading and error states.
  loading: "Loading browser compatibility data for {query}.",
  error: "Browser compatibility data for {query} could not be loaded.",
} as const;
