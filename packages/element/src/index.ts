import { BcdCompatTable } from "./bcd-compat-table.js";

export type {
  BcdCompatTableElement,
  BcdErrorDetail,
  BcdErrorReason,
  BcdLoadDetail,
  BcdMode,
  CompatTableData,
  CompatTableLoading,
  MessageId,
  MessageValues,
  StringTable,
} from "./public-types.js";
export { en } from "./strings/en.js";
export { formatMessage, MissingPlaceholderError, selectStrings } from "./strings/format.js";

// Importing the package defines the element, which is why `package.json` lists this file under
// `sideEffects`. The class itself is not exported: a page reaches the element through the tag
// name and the hand-written `BcdCompatTableElement` type, so no type from Lit is public. A second
// copy of the package on the same page leaves the first definition in place instead of throwing.
// The tag name is written out in the call so the Custom Elements Manifest analyzer can read it.
if (customElements.get("bcd-compat-table") === undefined) {
  customElements.define("bcd-compat-table", BcdCompatTable);
}
