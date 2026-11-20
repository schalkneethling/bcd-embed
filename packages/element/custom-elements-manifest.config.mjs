// `packagejson: false` stops the analyzer from adding a `customElements` field to package.json
// on every run. `litelement: true` makes it read Lit's `static properties` as fields and attributes.
export default {
  globs: ["src/**/*.ts"],
  outdir: "dist",
  litelement: true,
  packagejson: false,
};
