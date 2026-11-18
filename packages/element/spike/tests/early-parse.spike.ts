// Issue #187, review item M3: the element is defined before the HTML parser reaches it, so the
// parser creates an upgraded element and connects it before parsing its children.
import { expect, test } from "./spike-fixtures.js";

type SpikeTableShape = HTMLElement & {
  label: string;
  createRenderRootCalls: number;
  updateComplete: Promise<boolean>;
};

test("an element defined before parsing puts its render container before the author's children", async ({
  page,
  pageErrors,
}) => {
  await page.goto("/early-parse.html");
  const result = await page.evaluate(async () => {
    const host = document.getElementById("early") as SpikeTableShape;
    await host.updateComplete;
    const container = host.querySelector(":scope > [data-render-container]");
    return {
      definedBeforeParse: (window as Window & { definedBeforeParse?: boolean }).definedBeforeParse,
      childOrder: [...host.children].map((child) =>
        child.hasAttribute("data-render-container") ? "render-container" : child.id,
      ),
      createRenderRootCalls: host.createRenderRootCalls,
      renderedLabel: container?.querySelector("[data-rendered-label]")?.textContent,
      authorA: document.getElementById("early-a")?.outerHTML,
    };
  });

  test.info().annotations.push({ type: "observed", description: JSON.stringify(result) });

  // Guard: without this, the page would only repeat the upgrade-after-parse case.
  expect(result.definedBeforeParse).toBe(true);
  expect(result.childOrder).toEqual(["render-container", "early-a", "early-b"]);
  expect(result.createRenderRootCalls).toBe(1);
  expect(result.renderedLabel).toBe("early label");
  expect(result.authorA).toBe('<p id="early-a">Author fallback paragraph</p>');
  expect(pageErrors).toEqual([]);
});
