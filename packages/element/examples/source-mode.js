// Runs in a page's build step, not in the browser. It writes the two HTML fragments of source
// mode: a JSON script that holds the payload, and the element that names the script.

/** Writes a payload as script text that the HTML parser cannot end early. */
export const toScriptJson = (payload) => JSON.stringify(payload).replaceAll("<", "\\u003c");

/** The `id` convention: `bcd-data-` and the query, with each dot written as a dash. */
export const scriptIdFor = (query) => `bcd-data-${query.replaceAll(".", "-")}`;

export const sourceModeHtml = (payload, fallbackHtml) => {
  const id = scriptIdFor(payload.query);
  return [
    `<script type="application/json" id="${id}">${toScriptJson(payload)}</script>`,
    `<bcd-compat-table source="${id}">${fallbackHtml}</bcd-compat-table>`,
  ].join("\n");
};
