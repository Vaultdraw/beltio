import { expect, test } from "@playwright/test";

import { canvasBox, openVault, readScene, trackErrors } from "./helpers";
import { seedAndOpen } from "./pageHelpers";

// Table plugin, reached by what a user does: paste spreadsheet cells (a paste event with tab-separated
// text), see the toast "That looks like a table", click "Insert as table", and see the cells as
// rectangle, line and text elements in one group. (Numeric columns would open the editor's own
// "Paste charts" dialog first, so the spec pastes words.)
test("Table: pasting spreadsheet cells offers Insert as table, and clicking it draws the table", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  await seedAndOpen(page, "Sketch.excalidraw", { elements: [] });
  const elements = async () =>
    ((await readScene(page, "Sketch.excalidraw")).elements as any[])
      .filter((e) => !e.isDeleted)
      .map((e) => ({ type: e.type, text: e.text, groups: e.groupIds }));

  // The editor takes a paste while the pointer is over the canvas and the canvas has focus.
  const box = await canvasBox(page);
  await page.mouse.click(box.x + 200, box.y + 200);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "Name\tColour\nApple\tRed\nPear\tGreen");
    document.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  await expect(page.getByText("That looks like a table")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Insert as table" }).click();

  await expect
    .poll(async () => (await elements()).some((e: any) => e.type === "line"), {
      timeout: 10_000,
    })
    .toBe(true);
  const els = await elements();
  const texts = els
    .filter((e: any) => e.type === "text")
    .map((e: any) => e.text);
  expect(texts.sort()).toEqual([
    "Apple",
    "Colour",
    "Green",
    "Name",
    "Pear",
    "Red",
  ]);
  expect(els.some((e: any) => e.type === "rectangle")).toBe(true);
  // One group holds the whole table.
  expect(new Set(els.map((e: any) => (e.groups ?? []).join()))).toEqual(
    new Set([els[0].groups.join()]),
  );
  expect(errors).toEqual([]);
});
