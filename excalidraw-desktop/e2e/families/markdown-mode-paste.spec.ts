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
// work on the canvas: a picture, plain text, and text pasted while typing a Markdown heading.

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

  await test.step(
    "text pasted while typing a heading stays in that heading",
    async () => {
      await editor.getByTestId("toolbar-text").click();
      await page.mouse.click(
        box.x + box.width * 0.6,
        box.y + box.height * 0.85,
      );
      await expect(page.locator("textarea.excalidraw-wysiwyg")).toBeFocused();
      await page.keyboard.type("# Big ", { delay: 15 });
      await paste(page, "text", "title");
      await page.keyboard.press("Escape");
      await expect
        .poll(
          async () => {
            const t = (await elements(page)).find(
              (e: any) => e.type === "text" && e.text.includes("title"),
            );
            return t ? `${t.customData?.role ?? "none"}:${t.text}` : "";
          },
          { timeout: 15_000 },
        )
        .toMatch(/^h1:.*title/);
    },
  );

  expect((await elements(page)).length).toBeGreaterThan(before);
  expect(errors).toEqual([]);
});
