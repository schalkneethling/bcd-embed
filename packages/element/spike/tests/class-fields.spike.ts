// Issue #187, contrast case: a reactive property written as an ordinary class field instead of
// a `declare` field. It shows what the `declare` pattern protects against under Vite 8's
// transform and the root tsconfig.json (target ESNext, so `useDefineForClassFields` is on).
import { buildMode, expect, test } from "./spike-fixtures.js";

type FieldTableShape = HTMLElement & {
  label: string;
  updateComplete: Promise<boolean>;
};

test("a class field initializer shadows Lit's accessor", async ({ page, pageErrors }, testInfo) => {
  await page.goto("/class-fields.html");
  const result = await page.evaluate(async () => {
    await customElements.whenDefined("bcd-spike-field-table");
    const host = document.getElementById("field") as FieldTableShape;
    // The first update throws in Lit's development build, so wait for a task, not updateComplete.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const ownLabel = Object.hasOwn(host, "label");
    const before = host.querySelector("[data-rendered-label]")?.textContent ?? null;
    host.label = "changed";
    await new Promise((resolve) => setTimeout(resolve, 50));
    return {
      ownLabel,
      before,
      after: host.querySelector("[data-rendered-label]")?.textContent ?? null,
    };
  });

  // The field was emitted as an own property, which hides the accessor on the prototype.
  expect(result.ownLabel).toBe(true);

  if (buildMode(testInfo.project.metadata) === "dev") {
    // Lit's development build refuses to render and throws a class-field-shadowing error.
    expect(pageErrors.join("\n")).toContain("set using class fields");
    expect(result.before).toBeNull();
    expect(result.after).toBeNull();
  } else {
    // The production build renders once and then ignores the change without any error.
    expect(pageErrors).toEqual([]);
    expect(result.before).toBe("default label");
    expect(result.after).toBe("default label");
  }
});
