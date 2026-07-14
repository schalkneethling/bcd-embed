import "./styles.css";

const app = document.querySelector<HTMLElement>("#app");

if (!app) {
  throw new Error("The documentation root element is missing.");
}

app.innerHTML = `
  <h1>bcd-embed</h1>
  <p>Embeddable browser compatibility tables backed by live MDN Browser Compatibility Data.</p>
  <p>The documentation application is intentionally minimal while the v1 contract is established.</p>
`;
