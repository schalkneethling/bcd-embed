import "./styles.css";

import { featureResponseSchema } from "../../../packages/schema/src/schemas.js";

import {
  contractKinds,
  isContractKind,
  validateContract,
  type ContractKind,
  type ContractValidationResult,
} from "./contract-validation.js";
import { sampleDocuments } from "./samples.js";

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("The documentation root element is missing.");

app.innerHTML = `
  <header class="hero">
    <p class="eyebrow">bcd-embed · contract v1</p>
    <h1>Inspect the wire contract.</h1>
    <p class="lede">Validate normalized responses with the canonical Zod schema and the published JSON Schema, side by side.</p>
  </header>
  <section class="workspace" aria-label="Contract playground">
    <div class="editor-panel panel">
      <div class="controls">
        <label>Resource<select id="resource-kind"></select></label>
        <button id="load-sample" type="button">Load sample</button>
        <label class="file-button">Upload JSON<input id="file-input" type="file" accept="application/json,.json" /></label>
      </div>
      <label class="editor-label" for="json-input">Response JSON</label>
      <textarea id="json-input" spellcheck="false" aria-describedby="parse-error"></textarea>
      <p id="parse-error" class="parse-error" role="alert"></p>
      <button id="validate" class="primary" type="button">Validate response</button>
    </div>
    <div class="results-panel">
      <div id="overall-result" class="overall-result panel" aria-live="polite"></div>
      <div class="validator-grid">
        <article id="zod-result" class="validator panel"></article>
        <article id="json-schema-result" class="validator panel"></article>
      </div>
      <article id="feature-inspector" class="panel inspector" hidden></article>
    </div>
  </section>
  <footer><p>Paste API output, upload a JSON file, or begin with the adversarial golden fixture.</p></footer>
`;

const requireElement = <ElementType extends HTMLElement>(selector: string): ElementType => {
  const element = document.querySelector<ElementType>(selector);
  if (!element) throw new Error(`Missing playground element: ${selector}`);
  return element;
};

const kindSelect = requireElement<HTMLSelectElement>("#resource-kind");
const jsonInput = requireElement<HTMLTextAreaElement>("#json-input");
const fileInput = requireElement<HTMLInputElement>("#file-input");
const parseError = requireElement<HTMLParagraphElement>("#parse-error");
const overallResult = requireElement<HTMLElement>("#overall-result");
const zodResult = requireElement<HTMLElement>("#zod-result");
const jsonSchemaResult = requireElement<HTMLElement>("#json-schema-result");
const inspector = requireElement<HTMLElement>("#feature-inspector");

for (const kind of contractKinds) {
  const option = document.createElement("option");
  option.value = kind;
  option.textContent = kind;
  kindSelect.append(option);
}

const selectedKind = (): ContractKind => {
  if (!isContractKind(kindSelect.value)) throw new Error("Invalid contract kind selection.");
  return kindSelect.value;
};

const resultCard = (
  container: HTMLElement,
  title: string,
  result: ContractValidationResult["zod"],
) => {
  container.replaceChildren();
  const heading = document.createElement("h2");
  heading.textContent = title;
  const status = document.createElement("p");
  status.className = `status ${result.valid ? "pass" : "fail"}`;
  status.textContent = result.valid
    ? "Pass"
    : `${result.errors.length} issue${result.errors.length === 1 ? "" : "s"}`;
  container.append(heading, status);

  if (!result.valid) {
    const list = document.createElement("ul");
    for (const error of result.errors) {
      const item = document.createElement("li");
      const path = document.createElement("code");
      path.textContent = error.path;
      item.append(path, document.createTextNode(` ${error.message}`));
      list.append(item);
    }
    container.append(list);
  }
};

const renderInspector = (value: unknown) => {
  const parsed = featureResponseSchema.safeParse(value);
  inspector.replaceChildren();
  inspector.hidden = !parsed.success;
  if (!parsed.success) return;

  const heading = document.createElement("h2");
  heading.textContent = "Feature summaries and branches";
  const intro = document.createElement("p");
  intro.className = "muted";
  intro.textContent = `${parsed.data.features.length} normalized features for ${parsed.data.query}`;
  const featureSelect = document.createElement("select");
  featureSelect.setAttribute("aria-label", "Feature to inspect");
  for (const feature of parsed.data.features) {
    const option = document.createElement("option");
    option.value = feature.key;
    option.textContent = feature.key;
    featureSelect.append(option);
  }
  const details = document.createElement("div");

  const updateDetails = () => {
    details.replaceChildren();
    const feature = parsed.data.features.find(({ key }) => key === featureSelect.value);
    if (!feature) return;

    for (const [target, support] of Object.entries(feature.support)) {
      const targetCard = document.createElement("section");
      targetCard.className = "target-card";
      const targetHeading = document.createElement("h3");
      targetHeading.textContent = parsed.data.browsers[target]?.name ?? target;
      const summary = document.createElement("p");
      const identity = support.summary.prefix
        ? `prefix ${support.summary.prefix}`
        : support.summary.alternativeName
          ? `alternative ${support.summary.alternativeName}`
          : "canonical";
      summary.textContent = `${support.summary.state} · from ${String(support.summary.versionAdded)} · ${identity}`;
      const branchList = document.createElement("ul");
      for (const branch of support.branches) {
        const branchItem = document.createElement("li");
        const branchIdentity = branch.canonical
          ? "canonical"
          : branch.prefix
            ? `prefix ${branch.prefix}`
            : `alternative ${branch.alternativeName}`;
        branchItem.textContent = `${branchIdentity}: ${branch.statements.length} statement${branch.statements.length === 1 ? "" : "s"}`;
        branchList.append(branchItem);
      }
      targetCard.append(targetHeading, summary, branchList);
      details.append(targetCard);
    }
  };

  featureSelect.addEventListener("change", updateDetails);
  inspector.append(heading, intro, featureSelect, details);
  updateDetails();
};

function runValidation() {
  parseError.textContent = "";
  let value: unknown;
  try {
    value = JSON.parse(jsonInput.value);
  } catch (error) {
    parseError.textContent = `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`;
    overallResult.className = "overall-result panel invalid";
    overallResult.textContent = "Fix the JSON syntax before validating the contract.";
    zodResult.replaceChildren();
    jsonSchemaResult.replaceChildren();
    inspector.hidden = true;
    return;
  }

  const kind = selectedKind();
  const result = validateContract(kind, value);
  overallResult.className = `overall-result panel ${result.valid ? "valid" : "invalid"}`;
  overallResult.textContent = result.valid
    ? `${kind} satisfies both validators.`
    : `${kind} does not satisfy the complete contract.`;
  resultCard(zodResult, "Canonical Zod", result.zod);
  resultCard(jsonSchemaResult, "Published JSON Schema", result.jsonSchema);
  if (kind === "feature-response") renderInspector(value);
  else inspector.hidden = true;
}

const setSample = () => {
  jsonInput.value = JSON.stringify(sampleDocuments[selectedKind()], null, 2);
  runValidation();
};

requireElement<HTMLButtonElement>("#load-sample").addEventListener("click", setSample);
requireElement<HTMLButtonElement>("#validate").addEventListener("click", runValidation);
kindSelect.addEventListener("change", setSample);
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  jsonInput.value = await file.text();
  runValidation();
});

setSample();
