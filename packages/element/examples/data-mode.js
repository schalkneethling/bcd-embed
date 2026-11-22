import "@schalkneethling/bcd-embed";

// `payload` is a feature response that the page's build step fetched from the API and kept, such
// as the body of https://api.browser-compat.dev/v1/current/features/css.properties.display.json.
export const showTable = (payload) => {
  const table = document.querySelector("#display");
  table.data = payload;
};
