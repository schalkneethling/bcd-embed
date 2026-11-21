// `globs` lists the two files that describe the element, so the manifest holds the element and its
// definition and none of the package's internal helpers. `outdir: "."` writes
// `custom-elements.json` beside `package.json`, where it is committed and published, and
// `tests/custom-elements-manifest.test.ts` fails when it differs from a fresh run.
// `packagejson: false` stops the analyzer from adding a `customElements` field to package.json on
// every run; the field is written by hand. `litelement: true` makes it read Lit's
// `static properties` as fields and attributes.
export default {
  globs: ["src/index.ts", "src/bcd-compat-table.ts"],
  outdir: ".",
  litelement: true,
  packagejson: false,
};
