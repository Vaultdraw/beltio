import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";

import { openVault, trackErrors } from "../helpers";
import { seedAndOpen } from "../pageHelpers";

// Cross-feature (bug utilizer, 2026-10-30): what a Markdown import writes is found by search,
// including text inside a table cell, a heading and a list item. One row per construct.

const NOTE = [
  "# Kernel notes",
  "",
  "A paragraph about zebrafish.",
  "",
  "| Concept | Meaning |",
  "|---|---|",
  "| Paging | Pages of quasarmemory |",
  "",
  "- a list item with walrusword",
  "",
].join("\n");

const ROWS: [string, string][] = [
  ["heading", "Kernel"],
  ["paragraph", "zebrafish"],
  ["table cell", "quasarmemory"],
  ["list item", "walrusword"],
];

const searchBox = (page: Page) =>
  page.getByPlaceholder("Search drawings and text…");

test("an imported note's text is found by search: heading, paragraph, table cell, list item", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Start.excalidraw");
  await page.locator(".vault-editor canvas.interactive").click({
    button: "right",
    position: { x: 300, y: 200 },
  });
  const chooser = page.waitForEvent("filechooser");
  await page
    .locator(".context-menu")
    .getByRole("button", { name: "Import file…" })
    .click();
  await (
    await chooser
  ).setFiles({
    name: "Kernel.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(NOTE),
  });
  // The import lands as its own drawing next to the open one.
  await expect(
    page.locator(".vault-tree-item__name", { hasText: "Kernel (imported)" }),
  ).toBeVisible({ timeout: 30_000 });
  // Written once the import finishes (the drawing fills in, then saves).
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const r = (window as any).__vaultRepo;
          const d = await r.readDrawing(
            r.handle,
            "Kernel (imported).excalidraw",
          );
          return JSON.stringify(JSON.parse(d.json).elements).includes(
            "walrusword",
          );
        }),
      { timeout: 30_000 },
    )
    .toBe(true);
  for (const [what, word] of ROWS) {
    await test.step(what, async () => {
      await searchBox(page).fill(word);
      await expect(
        page
          .locator('.vault-search-row[data-kind="snippet"]')
          .filter({ hasText: word })
          .first(),
        `${what}: "${word}" is found`,
      ).toBeVisible({ timeout: 15_000 });
    });
  }
  expect(errors).toEqual([]);
});
