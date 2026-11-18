// Issue #187: React 19.3.1 as the parent that rendered the author's children, and React setting
// `data` on the element.
import { expect, test } from "./spike-fixtures.js";

type SpikeTableShape = HTMLElement & {
  data: unknown;
  updateComplete: Promise<boolean>;
};

type ReactSpike = {
  renderFallback: (props: {
    data: unknown;
    label: string;
    showLink: boolean;
    mode: "hide" | "remove";
  }) => void;
  renderData: (data: unknown) => void;
  renderLate: (data: unknown, viaRef: boolean) => void;
  defineLate: () => void;
  renderText: (text: string, data: unknown) => void;
};

// `window.reactSpike` is declared in react-page.ts for the page; the test process sees it only
// through this cast.
type SpikeWindow = Window & { reactSpike: ReactSpike };

test.beforeEach(async ({ page }) => {
  await page.goto("/react.html");
  await page.waitForFunction(() => "reactSpike" in window);
});

for (const mode of ["hide", "remove"] as const) {
  test(`React re-renders after the element ${mode === "hide" ? "hid" : "removed"} its children`, async ({
    page,
    pageErrors,
  }) => {
    const result = await page.evaluate(async (fallbackMode) => {
      const { reactSpike } = window as unknown as SpikeWindow;
      const data = { contract: "spike" };
      const snapshot = () => {
        const host = document.getElementById("react-fallback");
        const text = document.getElementById("react-child-text");
        const link = document.getElementById("react-child-link");
        return {
          order: host
            ? [...host.children].map((child) =>
                child.hasAttribute("data-render-container") ? "render-container" : child.id,
              )
            : null,
          textContent: text?.textContent ?? null,
          textHidden: text?.hidden ?? null,
          textConnected: text?.isConnected ?? false,
          linkConnected: link?.isConnected ?? false,
          linkHidden: link?.hidden ?? null,
          reactRootChildren: document.getElementById("fallback-root")?.childElementCount ?? 0,
        };
      };
      const run = (step: () => void) => {
        try {
          step();
          return null;
        } catch (error) {
          return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        }
      };

      // 1. React renders the fallback children; the element has no data yet.
      run(() =>
        reactSpike.renderFallback({
          data: undefined,
          label: "first",
          showLink: true,
          mode: fallbackMode,
        }),
      );
      const host = document.getElementById("react-fallback") as SpikeTableShape;
      await host.updateComplete;
      const initial = snapshot();

      // 2. Data arrives; the element hides or removes the children React rendered.
      run(() =>
        reactSpike.renderFallback({ data, label: "first", showLink: true, mode: fallbackMode }),
      );
      await host.updateComplete;
      const afterData = snapshot();

      // 3. The parent re-renders with changed props: new text, and the link is dropped.
      const changeError = run(() =>
        reactSpike.renderFallback({ data, label: "second", showLink: false, mode: fallbackMode }),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      const afterChange = snapshot();

      // 4. The link comes back, which makes React insert a new node among the children.
      const reinsertError = run(() =>
        reactSpike.renderFallback({ data, label: "third", showLink: true, mode: fallbackMode }),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      const afterReinsert = snapshot();

      return { initial, afterData, changeError, afterChange, reinsertError, afterReinsert };
    }, mode);

    test.info().annotations.push({ type: "observed", description: JSON.stringify(result) });

    expect(result.initial.order).toEqual([
      "react-child-text",
      "react-child-link",
      "render-container",
    ]);

    if (mode === "hide") {
      expect(result.afterData).toMatchObject({ textHidden: true, linkHidden: true });
      // React updates the hidden text in place and drops the link, without an error.
      expect(result.changeError).toBeNull();
      expect(result.afterChange).toEqual({
        order: ["react-child-text", "render-container"],
        textContent: "second",
        textHidden: true,
        textConnected: true,
        linkConnected: false,
        linkHidden: null,
        reactRootChildren: 1,
      });
      // A child React adds later lands after the render container, and it is not hidden,
      // because the element hid only the children present when `data` changed.
      expect(result.reinsertError).toBeNull();
      expect(result.afterReinsert).toMatchObject({
        order: ["react-child-text", "render-container", "react-child-link"],
        textHidden: true,
        linkHidden: false,
      });
      expect(pageErrors).toEqual([]);
    } else {
      expect(result.afterData.order).toEqual(["render-container"]);
      // React's removeChild throws during the commit. The error does not reach the flushSync
      // caller; it surfaces as an uncaught page error, and React unmounts the whole root,
      // element included.
      expect(result.changeError).toBeNull();
      expect(pageErrors).toHaveLength(1);
      expect(pageErrors[0]).toMatch(/removeChild|can not be found/);
      expect(result.afterChange).toMatchObject({ order: null, reactRootChildren: 0 });
      // The next render mounts a new element from scratch, which removes its fresh children
      // again as soon as it receives `data`.
      expect(result.reinsertError).toBeNull();
      expect(result.afterReinsert).toMatchObject({
        order: ["render-container"],
        reactRootChildren: 1,
      });
    }
  });
}

test("React 19 sets `data` as a property when the element is defined before React renders", async ({
  page,
  pageErrors,
}) => {
  const result = await page.evaluate(async () => {
    const { reactSpike } = window as unknown as SpikeWindow;
    const data = { contract: "spike" };
    reactSpike.renderData(data);
    const host = document.getElementById("react-data") as SpikeTableShape;
    await host.updateComplete;
    return {
      sameObject: host.data === data,
      hasDataAttribute: host.hasAttribute("data"),
      renderedType: host.querySelector("[data-rendered-data-type]")?.textContent,
    };
  });

  expect(result.sameObject).toBe(true);
  expect(result.hasDataAttribute).toBe(false);
  expect(result.renderedType).toBe("object");
  expect(pageErrors).toEqual([]);
});

test("React 19 sets `data` as an attribute when the element is defined after React renders", async ({
  page,
  pageErrors,
}) => {
  const result = await page.evaluate(async () => {
    const { reactSpike } = window as unknown as SpikeWindow;
    const data = { contract: "spike" };
    reactSpike.renderLate(data, false);
    const before = document.getElementById("react-late") as SpikeTableShape;
    const attributeBeforeDefine = before.getAttribute("data");
    reactSpike.defineLate();
    const host = document.getElementById("react-late") as SpikeTableShape;
    await host.updateComplete;
    const afterDefine = {
      sameObject: host.data === data,
      renderedType: host.querySelector("[data-rendered-data-type]")?.textContent,
    };
    // A later React render with a new object, now that the accessor exists.
    const next = { contract: "spike-2" };
    reactSpike.renderLate(next, false);
    await host.updateComplete;
    return {
      attributeBeforeDefine,
      afterDefine,
      afterRerender: {
        sameObject: host.data === next,
        renderedType: host.querySelector("[data-rendered-data-type]")?.textContent,
      },
    };
  });

  expect(result.attributeBeforeDefine).toBe("[object Object]");
  expect(result.afterDefine).toEqual({ sameObject: false, renderedType: "undefined" });
  expect(result.afterRerender).toEqual({ sameObject: true, renderedType: "object" });
  expect(pageErrors).toEqual([]);
});

test("a ref callback sets `data` as a property even when the element is defined late", async ({
  page,
  pageErrors,
}) => {
  const result = await page.evaluate(async () => {
    const { reactSpike } = window as unknown as SpikeWindow;
    const data = { contract: "spike" };
    reactSpike.renderLate(data, true);
    reactSpike.defineLate();
    const host = document.getElementById("react-late") as SpikeTableShape;
    await host.updateComplete;
    return {
      sameObject: host.data === data,
      hasDataAttribute: host.hasAttribute("data"),
      renderedType: host.querySelector("[data-rendered-data-type]")?.textContent,
    };
  });

  expect(result).toEqual({ sameObject: true, hasDataAttribute: false, renderedType: "object" });
  expect(pageErrors).toEqual([]);
});

// Review item M4: React updates a single string child through `setTextContent`
// (react-dom-client.development.js, lines 2834–2847), which assigns `textContent` when the
// element has more than one child node.
test("React changing a string child of the element", async ({ page, pageErrors }) => {
  const result = await page.evaluate(async () => {
    const { reactSpike } = window as unknown as SpikeWindow;
    const snapshot = () => {
      const host = document.getElementById("react-text");
      return {
        childNodes: host
          ? [...host.childNodes].map((node) =>
              node instanceof Element && node.hasAttribute("data-render-container")
                ? "render-container"
                : `#text ${node.textContent}`,
            )
          : null,
        renderedTypeInPage: host?.querySelector("[data-rendered-data-type]")?.textContent ?? null,
      };
    };

    // 1. A text-only fallback, no data yet.
    reactSpike.renderText("Loading…", undefined);
    const host = document.getElementById("react-text") as SpikeTableShape;
    await host.updateComplete;
    // A handle on the container, to see where it goes.
    const container = host.querySelector(":scope > [data-render-container]") as HTMLElement;
    const initial = snapshot();

    // 2. Data arrives with the same text. The element hides element children only.
    const data = { contract: "spike" };
    reactSpike.renderText("Loading…", data);
    await host.updateComplete;
    const afterData = snapshot();

    // 3. React changes the text.
    reactSpike.renderText("Loaded", data);
    await host.updateComplete;
    const afterTextChange = snapshot();

    // 4. A later property change: does Lit's output reach the page?
    host.data = ["spike-2"];
    await host.updateComplete;
    return {
      initial,
      afterData,
      afterTextChange,
      afterLaterUpdate: snapshot(),
      containerConnected: container.isConnected,
      detachedContainerRendered:
        container.querySelector("[data-rendered-data-type]")?.textContent ?? null,
    };
  });

  test.info().annotations.push({ type: "observed", description: JSON.stringify(result) });

  expect(result.initial.childNodes).toEqual(["#text Loading…", "render-container"]);
  // A text node cannot carry `hidden`, so the text fallback stays visible next to the table.
  expect(result.afterData).toEqual({
    childNodes: ["#text Loading…", "render-container"],
    renderedTypeInPage: "object",
  });
  // React's text update replaces every child, the render container included.
  expect(result.afterTextChange).toEqual({
    childNodes: ["#text Loaded"],
    renderedTypeInPage: null,
  });
  // Lit keeps rendering into the detached container, silently: nothing reaches the page.
  expect(result.afterLaterUpdate).toEqual({
    childNodes: ["#text Loaded"],
    renderedTypeInPage: null,
  });
  expect(result.containerConnected).toBe(false);
  expect(result.detachedContainerRendered).toBe("object");
  expect(pageErrors).toEqual([]);
});
