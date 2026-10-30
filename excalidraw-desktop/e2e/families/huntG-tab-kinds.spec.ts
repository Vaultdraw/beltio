import { type Page } from "@playwright/test";

import { expect, test } from "../fixture";

import { openVault, reloadVault } from "../helpers";
import { readTabs } from "../tabsHelpers";

// Family (bug hunter G, 2026-10-30): every kind of file open in a tab behaves the same in the tab
// strip. One row per kind: a drawing in a folder, a note, a note in a folder, an Obsidian
// Excalidraw file (.excalidraw.md) and a note with an odd name. For each: the tab menu's Pin,
// "Reveal in navigator" (unfolds the folder and focuses the row) and "Close others" work, and
// after a reload the tab comes back with the same file, active, pinned. Obsidian restores its
// tabs (notes and drawings alike) on restart and "Reveal file in navigation" works for any file.
// The drawing-only version of the restore is in vaultEdgeCases ("tabs ... reload").

type Kind = { name: string; path: string; label: string };

const ODD = "Café — ünï 📝 (draft)";

const KINDS: Kind[] = [
  {
    name: "drawing in a folder",
    path: "DSA/Graphs.excalidraw",
    label: "Graphs",
  },
  { name: "note", path: "Ideas.md", label: "Ideas" },
  {
    name: "note in a folder",
    path: "Daily/2026-10-27.md",
    label: "2026-10-27",
  },
  {
    name: "Obsidian Excalidraw file",
    path: "Drawings/Plugin Sketch.excalidraw.md",
    label: "Plugin Sketch",
  },
  { name: "note with an odd name", path: `${ODD}.md`, label: ODD },
];

const row = (page: Page, path: string) =>
  page.locator(`[data-tree-path="${path}"]`);

/** The odd-name note is not in the obsidian seed: add it (again after a reload). */
const seedOdd = (page: Page) =>
  page.evaluate((odd) => {
    const w = window as any;
    w.__noteFiles.setOnDisk(`${odd}.md`, `# ${odd}\n\nOdd.\n`);
    w.__vaultRepo.seedNote(`${odd}.md`);
    w.__vaultRepo.emit({
      handle: w.__vaultRepo.handle,
      paths: [],
      rescan: true,
    });
  }, ODD);

/** Opens a path from the tree, unfolding each folder above it first. */
const openFromTree = async (page: Page, path: string) => {
  const parts = path.split("/");
  for (let n = 1; n < parts.length; n++) {
    const dir = parts.slice(0, n).join("/");
    await expect(row(page, dir)).toBeVisible();
    if ((await row(page, dir).getAttribute("aria-expanded")) !== "true") {
      await row(page, dir).locator(".vault-tree-item__toggle").click();
    }
    await expect(row(page, parts.slice(0, n + 1).join("/"))).toBeVisible();
  }
  await row(page, path).locator(".vault-tree-item__name").click();
};

const tab = (page: Page, path: string) =>
  page.locator(`[data-testid=vault-tab][data-path="${path}"]`);

const tabMenu = async (page: Page, path: string, item: string) => {
  await tab(page, path).click({ button: "right" });
  const menu = page.getByTestId("vault-tab-menu");
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: item, exact: true }).click();
  await expect(menu).toHaveCount(0);
};

for (const kind of KINDS) {
  test(`tab of a ${kind.name}: Pin, Reveal in navigator, Close others, and it comes back after a reload`, async ({
    page,
  }) => {
    await openVault(page, "?seed=obsidian");
    await seedOdd(page);
    // A drawing first, so "Close others" has something to close.
    await openFromTree(
      page,
      "DSA/Dynamic Programming/01 Introduction.excalidraw",
    );
    await expect(
      page.locator(".vault-editor canvas.interactive"),
    ).toBeVisible();
    await page.getByTestId("vault-tab-new").click();
    await openFromTree(page, kind.path);
    await expect(tab(page, kind.path)).toHaveAttribute("aria-selected", "true");
    await expect(tab(page, kind.path)).toContainText(kind.label);

    // Pin: the tab leads the strip and says it is pinned.
    await tabMenu(page, kind.path, "Pin");
    await expect(page.getByTestId("vault-tab").first()).toHaveAttribute(
      "data-path",
      kind.path,
    );
    await expect(tab(page, kind.path)).toHaveAttribute(
      "aria-label",
      `${kind.label} (pinned)`,
    );

    // Reveal in navigator: fold every folder first; the reveal unfolds and focuses the row.
    for (const dir of ["DSA", "Daily", "Drawings"]) {
      if ((await row(page, dir).getAttribute("aria-expanded")) === "true") {
        await row(page, dir).locator(".vault-tree-item__toggle").click();
        await expect(row(page, dir)).toHaveAttribute("aria-expanded", "false");
      }
    }
    await tabMenu(page, kind.path, "Reveal in navigator");
    await expect(row(page, kind.path)).toBeVisible();
    await expect(page.locator(".vault-tree-item--focused")).toHaveAttribute(
      "data-tree-path",
      kind.path,
    );

    // Close others: the drawing goes, this tab stays and is still shown.
    await tabMenu(page, kind.path, "Close others");
    await expect
      .poll(async () => (await readTabs(page)).map((t) => t.path))
      .toEqual([kind.path]);

    // Reload: the same tab comes back, active and pinned, showing the file.
    await page.waitForTimeout(1600); // the session is written 1 s after the last change
    await reloadVault(page);
    await seedOdd(page);
    await expect
      .poll(async () =>
        (await readTabs(page)).map(({ path, active }) => ({ path, active })),
      )
      .toEqual([{ path: kind.path, active: true }]);
    await expect(tab(page, kind.path)).toHaveAttribute(
      "aria-label",
      `${kind.label} (pinned)`,
    );
    await expect(tab(page, kind.path)).not.toHaveClass(
      /vault-tabs__tab--missing/,
    );
    if (kind.path.endsWith(".md") && !kind.path.endsWith(".excalidraw.md")) {
      await expect(page.getByTestId("note-reading")).toBeVisible();
    } else {
      await expect(
        page.locator(".vault-editor canvas.interactive"),
      ).toBeVisible();
    }
  });
}
