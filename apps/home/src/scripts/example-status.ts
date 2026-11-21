// Announces which example is showing. The page switches its panels with CSS alone, which changes
// what a sighted reader sees but says nothing to a screen reader, so this script adds a status
// region and fills it when the choice changes.
//
// The region does not exist in the HTML. The script creates it, empty, when the page loads, so a
// page without script has no empty region, and the region is in the page before the
// first sentence arrives. The sentences come from the radios' `data-announcement` attributes, which
// the build writes (src/pages/index.astro).
//
// The script is a file, never inline, so the page can be served with `script-src 'self'` (#211).

const choices = document.querySelector(".examples .example-choices");

if (choices !== null) {
  const status = document.createElement("div");
  status.className = "example-status";
  status.setAttribute("role", "status");
  // After the choices and before the panels, so it sits with the control that changes it.
  choices.after(status);

  // `change` fires when the checked radio changes, for a click, a tap, and the arrow keys alike. It
  // does not fire again for the radio that is already checked, so nothing repeats.
  choices.addEventListener("change", (event) => {
    const radio = event.target;
    if (radio instanceof HTMLInputElement && radio.type === "radio" && radio.checked) {
      status.textContent = radio.dataset.announcement ?? "";
    }
  });
}
