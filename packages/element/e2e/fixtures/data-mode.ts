// The script of `data-mode.html`. The Vite dev server that Playwright starts serves it, so the
// page runs the element's source, not a build.
import type { FeatureResponse } from "@bcd-embed/schema";

import { v1NormalizedFixture } from "../../../schema/src/fixtures/v1.js";
import "../../src/index.js";
import { buildLargePayload } from "../../tests/fixtures/large-payload.js";

/** What the page hands to the tests, which reach it through `window.bcdFixture`. */
export type DataModeFixture = {
  /** The adversarial fixture the Phase 1 markup was written from. */
  readonly payload: FeatureResponse;
  /** Builds a payload with the given number of features and four targets. */
  readonly buildLargePayload: (featureCount: number) => FeatureResponse;
};

declare global {
  // An interface, because only an interface can add a member to the DOM library's `Window`.
  interface Window {
    bcdFixture: DataModeFixture;
  }
}

window.bcdFixture = { payload: v1NormalizedFixture, buildLargePayload };

const table = document.querySelector("bcd-compat-table");
if (table !== null) table.data = v1NormalizedFixture;
