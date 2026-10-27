import { expect, test, type Locator, type Page } from "@playwright/test";

import { openVault, trackErrors } from "./helpers";

/** Tree row whose name is exactly `name`. */
const treeRow = (page: Page, name: string): Locator =>
  page
    .locator(".vault-tree-item")
    .filter({
      has: page.locator(".vault-tree-item__name", {
        hasText: new RegExp(`^${name}$`),
      }),
    })
    .first();

test("an Obsidian-style vault lists its notes and opens an Excalidraw plugin file read-only", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?seed=obsidian");

  // Notes sit in the tree next to drawings, shown without their extension.
  await expect(treeRow(page, "Welcome")).toHaveAttribute(
    "data-tree-kind",
    "note",
  );
  await expect(treeRow(page, "Ideas")).toHaveAttribute(
    "data-tree-kind",
    "note",
  );
  await treeRow(page, "Daily").locator(".vault-tree-item__toggle").click();
  await expect(treeRow(page, "2026-10-27")).toBeVisible();
  await treeRow(page, "Drawings").locator(".vault-tree-item__toggle").click();
  await expect(treeRow(page, "Sketch")).toHaveAttribute(
    "data-tree-kind",
    "drawing",
  );
  await expect(treeRow(page, "Plugin Sketch")).toHaveAttribute(
    "data-tree-kind",
    "excalidrawMd",
  );

  // A note offers no edit actions from the tree: only Reveal.
  await treeRow(page, "Welcome").click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Reveal in file manager" }),
  ).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Rename" })).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "Move to Trash" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The Excalidraw plugin file opens as a drawing, read-only, with a notice.
  await treeRow(page, "Plugin Sketch")
    .locator(".vault-tree-item__name")
    .click();
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  await expect(page.getByTestId("excalidraw-md-banner")).toContainText(
    "read-only",
  );
  await expect(page.locator(".vault-editor-container--readonly")).toBeVisible();

  // A note opens in a tab: rendered, with its [[link]] working.
  await treeRow(page, "Welcome").locator(".vault-tree-item__name").click();
  const reading = page.getByTestId("note-reading");
  await expect(reading.getByRole("heading", { name: "Welcome" })).toBeVisible();
  // A [[Note#Heading]] link opens the note scrolled to that heading.
  await reading.getByText("Ideas > Later").click();
  await expect(
    reading.getByRole("heading", { name: "Later" }),
  ).toBeInViewport();
  await expect(reading.getByRole("heading", { name: "Ideas" })).toBeVisible();
  await expect(page.getByTestId("note-properties")).toContainText("tags");

  // Ticking a task in the reading view writes through the guarded save.
  await reading.getByRole("checkbox").first().click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { __noteFiles: { textOf(p: string): string } }
        ).__noteFiles.textOf("Ideas.md"),
      ),
    )
    .toContain("- [x] ship the follow-ups");
  await expect(page.getByTestId("note-status")).toHaveAttribute(
    "data-status",
    "saved",
  );

  // Edit it: the file on disk changes through the guarded save.
  await page.getByRole("button", { name: "Edit note" }).click();
  await page.getByTestId("note-editor").locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n- three added in the editor\n");
  await expect(page.getByTestId("note-status")).toHaveAttribute(
    "data-status",
    "saved",
  );
  const onDisk = await page.evaluate(() =>
    (
      window as unknown as { __noteFiles: { textOf(p: string): string } }
    ).__noteFiles.textOf("Ideas.md"),
  );
  expect(onDisk).toContain("- three added in the editor");
  await page.getByRole("button", { name: "Show reading view" }).click();
  await expect(reading).toContainText("three added in the editor");

  expect(errors).toEqual([]);
});
