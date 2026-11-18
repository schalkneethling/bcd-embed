// Issue #187: render root, <slot>, reconnection, and `declare` properties in a light-DOM element.
import { expect, test } from "./spike-fixtures.js";

// The parts of the spike element the page scripts read. The tests cannot import the element
// class, because it runs in the browser, not in the test process.
type SpikeTableShape = HTMLElement & {
  label: string;
  renderCount: number;
  createRenderRootCalls: number;
  updateComplete: Promise<boolean>;
};

test.beforeEach(async ({ page }) => {
  await page.goto("/light-dom.html");
  await page.evaluate(async () => {
    await customElements.whenDefined("bcd-spike-table");
    await customElements.whenDefined("bcd-spike-slot");
    for (const id of ["basic", "slotted"]) {
      await (document.getElementById(id) as SpikeTableShape).updateComplete;
    }
  });
});

test("renders the template inside the appended <div> and leaves the author's children untouched", async ({
  page,
  pageErrors,
}) => {
  const result = await page.evaluate(() => {
    const host = document.getElementById("basic") as SpikeTableShape;
    const container = host.querySelector(":scope > [data-render-container]");
    return {
      shadowRoot: host.shadowRoot,
      childOrder: [...host.children].map((child) =>
        child.hasAttribute("data-render-container") ? "render-container" : child.id,
      ),
      renderedLabel: container?.querySelector("[data-rendered-label]")?.textContent,
      renderedOutsideContainer: host.querySelectorAll(":scope > [data-rendered-label]").length,
      authorA: document.getElementById("author-a")?.outerHTML,
      authorB: document.getElementById("author-b")?.outerHTML,
    };
  });

  expect(result.shadowRoot).toBeNull();
  expect(result.childOrder).toEqual(["author-a", "author-b", "render-container"]);
  expect(result.renderedLabel).toBe("first label");
  expect(result.renderedOutsideContainer).toBe(0);
  expect(result.authorA).toBe('<p id="author-a">Author fallback paragraph</p>');
  expect(result.authorB).toBe(
    '<a id="author-b" href="https://developer.mozilla.org/">MDN link</a>',
  );
  expect(pageErrors).toEqual([]);
});

test("a <slot> in a light-DOM template projects nothing", async ({ page, pageErrors }) => {
  const result = await page.evaluate(() => {
    const host = document.getElementById("slotted") as HTMLElement;
    const slot = host.querySelector("slot") as HTMLSlotElement;
    const author = document.getElementById("slot-author") as HTMLElement;
    return {
      assignedNodes: slot.assignedNodes().length,
      assignedNodesFlattened: slot.assignedNodes({ flatten: true }).length,
      authorAssignedSlot: author.assignedSlot,
      authorParentIsHost: author.parentElement === host,
      slotDisplay: getComputedStyle(slot).display,
      slotFallbackRendered: host.innerText.includes("slot fallback text"),
      authorRendered: host.innerText.includes("Author child"),
    };
  });

  // Nothing is assigned: the author's child is not projected into the slot.
  expect(result.assignedNodes).toBe(0);
  expect(result.authorAssignedSlot).toBeNull();
  expect(result.authorParentIsHost).toBe(true);
  // Outside a shadow tree, the slot is an ordinary `display: contents` element, so its own
  // fallback text renders and the author's child renders where it already was.
  expect(result.slotDisplay).toBe("contents");
  expect(result.assignedNodesFlattened).toBe(0);
  expect(result.slotFallbackRendered).toBe(true);
  expect(result.authorRendered).toBe(true);
  expect(pageErrors).toEqual([]);
});

test("removing and re-adding the element does not create a second render container", async ({
  page,
  pageErrors,
}) => {
  const result = await page.evaluate(async () => {
    const host = document.getElementById("basic") as SpikeTableShape;
    host.remove();
    document.body.append(host);
    await host.updateComplete;
    // A property change after reconnection still reaches the same container.
    host.label = "after reconnect";
    await host.updateComplete;
    const containers = host.querySelectorAll(":scope > [data-render-container]");
    return {
      containers: containers.length,
      createRenderRootCalls: host.createRenderRootCalls,
      renderedLabel: containers[0]?.querySelector("[data-rendered-label]")?.textContent,
    };
  });

  expect(result.containers).toBe(1);
  expect(result.createRenderRootCalls).toBe(1);
  expect(result.renderedLabel).toBe("after reconnect");
  expect(pageErrors).toEqual([]);
});

test("a `declare` property with a constructor default renders again when it is set", async ({
  page,
  pageErrors,
}) => {
  const result = await page.evaluate(async () => {
    const host = document.getElementById("basic") as SpikeTableShape;
    const ownLabelBefore = Object.hasOwn(host, "label");
    const rendersBefore = host.renderCount;
    host.label = "second label";
    await host.updateComplete;
    return {
      ownLabelBefore,
      rendersAdded: host.renderCount - rendersBefore,
      renderedLabel: host.querySelector("[data-rendered-label]")?.textContent,
    };
  });

  // No own `label` property, so Lit's accessor on the prototype is the one that runs.
  expect(result.ownLabelBefore).toBe(false);
  expect(result.rendersAdded).toBe(1);
  expect(result.renderedLabel).toBe("second label");
  expect(pageErrors).toEqual([]);
});
