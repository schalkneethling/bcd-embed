// Types the element for JSX. React's own types know no `bcd-compat-table`, and the package ships no
// React typings (#207 is out of scope for a wrapper), so the fixture declares what it uses.
import type {
  BcdCompatTableElement,
  BcdErrorDetail,
  BcdLoadDetail,
  CompatTableData,
} from "@bcd-embed/element";
import type { ReactNode, Ref } from "react";

type BcdCompatTableProps = {
  readonly ref?: Ref<BcdCompatTableElement>;
  readonly id?: string;
  readonly browsers?: string;
  readonly data?: CompatTableData | null;
  // React 19 reads a prop named `on` plus the event name as a listener, whatever the case or
  // characters of the event name (react-dom-client.development.js, `setPropOnCustomElement`).
  readonly "onbcd-load"?: (event: CustomEvent<BcdLoadDetail>) => void;
  readonly "onbcd-error"?: (event: CustomEvent<BcdErrorDetail>) => void;
  readonly children?: ReactNode;
};

declare module "react" {
  // An interface, because the declaration adds one tag to React's `IntrinsicElements`, which only
  // interface merging can do.
  namespace JSX {
    interface IntrinsicElements {
      "bcd-compat-table": BcdCompatTableProps;
    }
  }
}
