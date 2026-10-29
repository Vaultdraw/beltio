import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";

import {
  canvasBox,
  openDrawing,
  openVault,
  readScene,
  trackErrors,
} from "../helpers";

// Cross-feature (bug utilizer, 2026-10-30): Markdown typing mode on, then the usual pastes still
// work on the canvas: a picture and plain text. (A paste inside the text editor cannot be
// faked: an untrusted paste event inserts nothing into a textarea.)

const DRAWING = "DSA/Graphs.excalidraw";
// A 1x1 red PNG.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

const elements = async (p: Page) =>
  (await readScene(p, DRAWING)).elements.filter((e: any) => !e.isDeleted);

const paste = (page: Page, kind: "png" | "text", text = "") =>
  page.evaluate(
    ({ kind, text, png }) => {
      const dt = new DataTransfer();
      if (kind === "png") {
        const bin = atob(png);
        const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        dt.items.add(new File([bytes], "dot.png", { type: "image/png" }));
      } else {
        dt.setData("text/plain", text);
      }
      (document.activeElement ?? document).dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { kind, text, png: PNG },
  );

test("Markdown mode on: a pasted picture and pasted text land on the canvas", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
  const editor = page.locator(".vault-editor");
  await editor.getByTestId("markdown-chip").click();
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  const before = (await elements(page)).length;

  await test.step("a picture", async () => {
    await paste(page, "png");
    await expect
      .poll(
        async () => (await elements(page)).some((e: any) => e.type === "image"),
        {
          timeout: 15_000,
        },
      )
      .toBe(true);
  });

  await test.step("plain text", async () => {
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.7);
    await paste(page, "text", "pasted plain words");
    await expect
      .poll(
        async () =>
          (
            await elements(page)
          ).some(
            (e: any) =>
              e.type === "text" && e.text.includes("pasted plain words"),
          ),
        { timeout: 15_000 },
      )
      .toBe(true);
  });

  expect((await elements(page)).length).toBeGreaterThan(before);
  expect(errors).toEqual([]);
});
