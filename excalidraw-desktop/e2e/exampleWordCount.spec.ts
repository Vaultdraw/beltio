import { expect } from "@playwright/test";

import { test } from "./fixture";

import { canvasBox, openDrawing, openVault, trackErrors } from "./helpers";

// word-count example plugin (sdk/examples/word-count) through the real UI.

test("word-count: the Drawing stats panel shows counts and follows canvas edits", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?plugins=word-count");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");

  await page.getByRole("button", { name: "Drawing stats" }).click();
  const total = page.getByTestId("stat-total");
  const words = page.getByTestId("stat-words");
  await expect(total).toHaveText(/^[1-9]\d*$/);
  await expect(words).toHaveText(/^\d+$/);
  const before = Number(await words.innerText());

  // Text tool: click an empty canvas spot, type two words, Escape commits.
  const box = await canvasBox(page);
  await page.keyboard.press("t");
  await page.mouse.click(box.x + 40, box.y + box.height - 60);
  await page.keyboard.type("zebra crossing");
  await page.keyboard.press("Escape");

  await expect(words).toHaveText(String(before + 2));
  expect(errors).toEqual([]);
});
