import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openDrawing, openVault, readScene, trackErrors } from "./helpers";

// OS file drops reach Excalidraw as HTML5 drop events (tauri.conf.json sets
// dragDropEnabled: false). Real Finder drags are a manual check.

const GRAPHS = "DSA/Graphs.excalidraw";
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const dropFile = (page: Page, name: string, type: string, base64: string) =>
  page.evaluate(
    ({ name, type, base64 }) => {
      const target = document.querySelector(".vault-editor .excalidraw")!;
      const r = target.getBoundingClientRect();
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File([bytes], name, { type }));
      const init = {
        bubbles: true,
        cancelable: true,
        dataTransfer,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
      };
      for (const t of ["dragenter", "dragover", "drop"]) {
        target.dispatchEvent(new DragEvent(t, init));
      }
    },
    { name, type, base64 },
  );

const liveCount = async (page: Page) =>
  (await readScene(page, GRAPHS)).elements.filter(
    (e: { isDeleted?: boolean }) => !e.isDeleted,
  ).length;

test("dropping a plain image inserts an image element", async ({ page }) => {
  const errors = trackErrors(page);
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
  const before = await liveCount(page);
  await dropFile(page, "dropped.png", "image/png", PNG);
  await expect
    .poll(
      async () => {
        const scene = await readScene(page, GRAPHS);
        return scene.elements.some(
          (e: { type: string; isDeleted?: boolean }) =>
            e.type === "image" && !e.isDeleted,
        );
      },
      { timeout: 10000 },
    )
    .toBe(true);
  expect(await liveCount(page)).toBe(before + 1);
  expect(errors).toEqual([]);
});

test("dropping a .excalidraw file does not replace the open drawing", async ({
  page,
}) => {
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
  const before = await liveCount(page);
  await dropFile(
    page,
    "other.excalidraw",
    "application/vnd.excalidraw+json",
    btoa('{"type":"excalidraw","version":2,"elements":[]}'),
  );
  await expect(page.getByRole("alert")).toContainText(
    "copy it into your vault",
  );
  await page.waitForTimeout(1500);
  expect(await liveCount(page)).toBe(before);
});
