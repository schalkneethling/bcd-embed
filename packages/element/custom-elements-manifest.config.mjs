// `globs` lists the files that describe the element: the element, the package entry (which holds
// the `customElements.define` call), and `public-types.ts`, whose interface documents each
// attribute and property. The manifest holds the element and its definition and none of the
// package's internal helpers. `outdir: "."` writes `custom-elements.json` beside `package.json`,
// where it is committed and published, and `tests/custom-elements-manifest.test.ts` fails when it
// differs from a fresh run. `packagejson: false` stops the analyzer from adding a `customElements`
// field to package.json on every run; the field is written by hand. `litelement: true` makes it
// read Lit's `static properties` as fields and attributes.
//
// The plugin below keeps the manifest to the public surface, so an internal refactor does not
// change it. The analyzer 0.11.0 has no option for private members: `exclude` takes file globs,
// and `@internal` or `@ignore` would have to tag all of them. The hooks and their parameters are
// those of `Plugin` in `@custom-elements-manifest/analyzer/index.d.ts`.
//
// - `analyzePhase` reads two things from `public-types.ts` into `context`: the description of each
//   member of the `BcdCompatTableElement` interface, and the right-hand side of each type alias.
// - `packageLinkPhase` removes the class's private members, copies a description onto each
//   remaining field and attribute, and expands a type that is exactly an alias name, so `loading`
//   reads `"eager" | "lazy"` and not `CompatTableLoading`.

const INTERFACE_NAME = "BcdCompatTableElement";

const oneLine = (text) => text.replace(/\s+/g, " ").trim();

const publicSurfacePlugin = {
  name: "bcd-embed-public-surface",
  analyzePhase({ ts, node, context }) {
    context.descriptions ??= new Map();
    context.aliases ??= new Map();
    if (ts.isTypeAliasDeclaration(node)) {
      context.aliases.set(node.name.text, oneLine(node.type.getText()));
    }
    if (ts.isInterfaceDeclaration(node) && node.name.text === INTERFACE_NAME) {
      for (const member of node.members) {
        // `jsDoc` is the property the analyzer itself reads (`src/utils/ast-helpers.js`).
        const comment = member.jsDoc?.at(-1)?.comment;
        if (ts.isPropertySignature(member) && typeof comment === "string") {
          context.descriptions.set(member.name.getText(), oneLine(comment));
        }
      }
    }
  },
  packageLinkPhase({ customElementsManifest, context }) {
    const descriptions = context.descriptions ?? new Map();
    const aliases = context.aliases ?? new Map();
    const expand = (entry) => {
      const expanded = aliases.get(entry.type?.text);
      if (expanded !== undefined) entry.type = { text: expanded };
    };
    for (const module of customElementsManifest.modules) {
      for (const declaration of module.declarations ?? []) {
        if (declaration.kind !== "class") continue;
        declaration.members = declaration.members?.filter((member) => member.privacy !== "private");
        for (const entry of [...(declaration.members ?? []), ...(declaration.attributes ?? [])]) {
          const name = entry.fieldName ?? entry.name;
          const description = descriptions.get(name);
          if (description !== undefined && entry.description === undefined) {
            entry.description = description;
          }
          expand(entry);
        }
      }
    }
  },
};

export default {
  globs: ["src/index.ts", "src/bcd-compat-table.ts", "src/public-types.ts"],
  outdir: ".",
  litelement: true,
  packagejson: false,
  plugins: [publicSurfacePlugin],
};
