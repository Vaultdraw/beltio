import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import {
  canvasBox,
  openDrawing,
  openVault,
  readScene,
  trackErrors,
} from "../helpers";

// Hunter B round 3: pasting a picture file and plain text into a drawing (clipboard events).
const DRAWING = "DSA/Graphs.excalidraw";
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const start = async (page: Page) => {
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
  const b = await canvasBox(page);
  await page.mouse.click(b.x + b.width - 8, b.y + b.height - 8);
};
const live = async (page: Page, type: string) =>
  (await readScene(page, DRAWING)).elements.filter(
    (e: any) => !e.isDeleted && e.type === type,
  );

test("hunter B: pasting a PNG file puts a picture on the canvas; pasting text makes a text", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await start(page);
  const before = (await live(page, "image")).length;
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "shot.png", { type: "image/png" }));
    const target =
      document.querySelector("canvas.interactive") ?? document.body;
    target.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, PNG);
  await expect
    .poll(async () => (await live(page, "image")).length, { timeout: 10_000 })
    .toBe(before + 1);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "pasted words");
    (
      document.querySelector("canvas.interactive") ?? document.body
    ).dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect
    .poll(
      async () =>
        (await live(page, "text")).some((e: any) => e.text === "pasted words"),
      { timeout: 10_000 },
    )
    .toBe(true);
  expect(errors()).toEqual([]);
});
