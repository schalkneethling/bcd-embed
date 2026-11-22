import "@schalkneethling/bcd-embed";

// One listener on the document hears every table on the page, because both events bubble.
document.addEventListener("bcd-load", (event) => {
  const { mode, snapshot } = event.detail;
  console.info(`Compatibility table loaded in ${mode} mode`, snapshot);
});

document.addEventListener("bcd-error", (event) => {
  const table = event.target;
  const { mode, reason, status, code } = event.detail;
  console.warn(`Compatibility table failed in ${mode} mode: ${reason}`, { status, code });

  // A network failure or a server error is temporary, so offer to ask again. Any other reason
  // needs a change to the page, and asking again would fail the same way.
  const temporary = reason === "network" || (reason === "http" && status >= 500);
  if (!temporary || table.nextElementSibling?.matches(".retry-table")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "retry-table";
  button.textContent = "Try loading the compatibility table again";
  button.addEventListener("click", () => {
    button.remove();
    const query = table.getAttribute("query");
    table.removeAttribute("query");
    // Let the element update without a query first, so that setting it again is a new request.
    setTimeout(() => table.setAttribute("query", query));
  });
  table.after(button);
});
