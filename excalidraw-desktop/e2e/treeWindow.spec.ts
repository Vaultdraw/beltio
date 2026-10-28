import { expect } from "@playwright/test";

import { test } from "./fixture";

import { openVault, trackErrors } from "./helpers";

// A 500-drawing folder mounts only the rows near the viewport, and keyboard,
// context menu, selection and scrolling still work across the whole list.
const ROWS = ".vault-tree-item[data-tree-path]";

test("big folder renders a window of rows and stays navigable", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?seed=bigfolder");
  const folder = page.locator('.vault-tree-item[data-tree-path="Zbig"]');
  await folder.click();
  await expect(
    page.locator('.vault-tree-item[data-tree-path="Zbig/note 000.excalidraw"]'),
  ).toBeVisible();
  const mounted = await page.locator(ROWS).count();
  expect(mounted).toBeGreaterThan(10);
  expect(mounted).toBeLessThan(120);

  // Scroll to the end: the last drawing mounts, the first one unmounts.
  const container = page.locator(".vault-tree-container");
  await container.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const last = page.locator(
    '.vault-tree-item[data-tree-path="Zbig/note 499.excalidraw"]',
  );
  await expect(last).toBeVisible();
  await expect(
    page.locator('.vault-tree-item[data-tree-path="Zbig/note 000.excalidraw"]'),
  ).toHaveCount(0);
  expect(await page.locator(ROWS).count()).toBeLessThan(120);

  // Context menu on a windowed row.
  await last.click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");

  // Keyboard: from the top, arrow down far past the first window.
  await container.evaluate((el) => {
    el.scrollTop = 0;
  });
  await folder.click(); // collapse
  await folder.click(); // expand again, focus on the folder
  await container.focus();
  for (let i = 0; i < 150; i++) {
    await page.keyboard.press("ArrowDown");
  }
  const focused = page.locator(".vault-tree-item--focused");
  await expect(focused).toHaveAttribute(
    "data-tree-path",
    "Zbig/note 149.excalidraw",
  );
  await expect(focused).toBeInViewport();

  // Enter opens the focused drawing.
  await page.keyboard.press("Enter");
  await expect(
    page.locator(".vault-tree-item--active[data-tree-path]"),
  ).toHaveAttribute("data-tree-path", "Zbig/note 149.excalidraw");
  expect(errors).toEqual([]);
});
