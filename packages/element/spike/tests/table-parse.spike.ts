// Issue #187: what the HTML parser does with <bcd-compat-table> written directly inside a
// <table>. The page has no script, so this is the parser alone; whether the element is defined
// does not change where the parser puts it.
import { expect, test } from "./spike-fixtures.js";

test("the parser moves <bcd-compat-table> out of a <table> but not out of a <td>", async ({
  page,
  pageErrors,
}) => {
  await page.goto("/table-parse.html");
  const result = await page.evaluate(() => {
    const direct = document.getElementById("direct") as HTMLElement;
    const table = document.getElementById("direct-table") as HTMLTableElement;
    const inCell = document.getElementById("in-cell") as HTMLElement;
    return {
      directParentId: direct.parentElement?.id,
      directIsBeforeTable: direct.nextElementSibling === table,
      directInsideTable: table.contains(direct),
      directChildStillInside: document.getElementById("direct-child")?.parentElement === direct,
      rowStillInTable: table.contains(document.getElementById("direct-row")),
      inCellParentId: inCell.parentElement?.id,
    };
  });

  // Foster parenting: the element is inserted before the table, in the table's parent.
  expect(result.directParentId).toBe("direct-wrapper");
  expect(result.directIsBeforeTable).toBe(true);
  expect(result.directInsideTable).toBe(false);
  expect(result.directChildStillInside).toBe(true);
  expect(result.rowStillInTable).toBe(true);
  // Inside a cell, the element is ordinary flow content and stays where it was written.
  expect(result.inCellParentId).toBe("cell");
  expect(pageErrors).toEqual([]);
});
