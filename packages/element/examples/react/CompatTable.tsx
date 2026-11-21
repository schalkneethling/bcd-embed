import "@bcd-embed/element";
import type { BcdCompatTableElement, BcdLoadDetail, CompatTableData } from "@bcd-embed/element";

export const CompatTable = ({ data }: { data: CompatTableData }) => (
  <bcd-compat-table
    browsers="chrome firefox safari"
    ref={(element: BcdCompatTableElement | null) => {
      if (element !== null) element.data = data;
    }}
    onbcd-load={(event: CustomEvent<BcdLoadDetail>) => {
      console.log("Table loaded:", event.detail.mode);
    }}
  >
    <p>Browser compatibility for this feature is on MDN Web Docs.</p>
  </bcd-compat-table>
);
