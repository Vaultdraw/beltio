import { type Page } from "@playwright/test";

import { expect, test } from "../fixture";

import { openVault, trackErrors } from "../helpers";

// Family sweep (bug hunter K, 2026-10-30): every item of the file tree's row menu, for every
// kind of row, does what it says and nothing else. The crawler never opens row menus
// (COVERAGE-G.md). One test per kind; the items are read from the menu itself, so a new item
// is swept automatically and an item with no expectation fails until it gets one.
// Each item: its dialog or view appears, Escape closes it, the file is still there and
// unchanged, and no console or page error happened.

type Kind = { name: string; path: string };

const KINDS: Kind[] = [
  { name: "drawing", path: "DSA/Graphs.excalidraw" },
  { name: "note", path: "Ideas.md" },
  { name: "Obsidian drawing", path: "Drawings/Plugin Sketch.excalidraw.md" },
  { name: "folder", path: "Daily" },
];

/** What the user must see after clicking the item; "submenu" items open a second menu. */
type Expect = "dialog" | "submenu" | "notice" | "view" | "skip";
const EXPECT: Record<string, Expect> = {
  "New drawing": "dialog",
  "New folder": "dialog",
  Duplicate: "skip", // writes a copy: covered by file-kinds-menu and V-2
  "Save as template…": "dialog",
  "Move to…": "dialog",
  "Open local graph": "view",
  History: "view",
  Export: "submenu",
  "Copy path": "submenu",
  "Reveal in file manager": "skip", // native opener; the harness has none
  "Rename…": "dialog",
  "Move to Trash": "dialog",
  // Plugin items (default plugins): they write, so their own specs cover them.
  "Update to my theme and font anyway": "skip",
  "Re-import from its Markdown": "skip",
  "Update imported notes here": "skip",
  "Re-import unchanged imported notes here": "skip",
  "Favourite: add or remove": "skip",
  "Show as grid": "view",
};

const row = (page: Page, path: string) =>
  page.locator(`[data-tree-path="${path}"]`);

const showRow = async (page: Page, path: string) => {
  const parts = path.split("/");
  for (let n = 1; n < parts.length; n++) {
    const dir = parts.slice(0, n).join("/");
    if ((await row(page, dir).getAttribute("aria-expanded")) !== "true") {
      await row(page, dir).locator(".vault-tree-item__toggle").click();
    }
  }
  await expect(row(page, path)).toBeVisible();
};

const openMenu = async (page: Page, path: string) => {
  await row(page, path).click({ button: "right" });
  const menu = page.getByRole("menu").first();
  await expect(menu).toBeVisible();
  return menu;
};

const labelOf = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .trim()
    // the shortcut hint after the label
    .replace(/\s(⌘|⌥|⇧|⌃|Ctrl|Alt|Shift|Mod).*$/, "")
    .trim();

const exists = (page: Page, path: string) =>
  page.evaluate(async (p) => {
    const repo = (window as any).__vaultRepo;
    const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    const entries = await repo.listDirectory(repo.handle, dir);
    return entries.some((e: any) => e.path === p);
  }, path);

for (const kind of KINDS) {
  test(`row menu of a ${kind.name}: every item opens what it says, Escape closes it, nothing changes`, async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.resolve() },
      });
    });
    await openVault(page, "?seed=obsidian");
    await showRow(page, kind.path);
    const menu = await openMenu(page, kind.path);
    const labels = (await menu.getByRole("menuitem").allTextContents()).map(
      labelOf,
    );
    await page.keyboard.press("Escape");
    const unknown = labels.filter(
      (l) => !Object.keys(EXPECT).some((k) => l.startsWith(k)),
    );
    expect(unknown, "menu items with no expectation").toEqual([]);

    const seen: string[] = [];
    for (const label of labels) {
      const key = Object.keys(EXPECT).find((k) => label.startsWith(k))!;
      const want = EXPECT[key];
      if (want === "skip") {
        continue;
      }
      const m = await openMenu(page, kind.path);
      const item = m.getByRole("menuitem", {
        name: new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
      });
      await item.click();
      if (want === "submenu") {
        await expect(page.getByRole("menu")).toHaveCount(2);
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu")).toHaveCount(0);
      } else if (want === "dialog") {
        const dialog = page.getByRole("dialog");
        await expect(dialog, `${key} opens a dialog`).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(dialog, `${key}: Escape closes it`).toHaveCount(0);
      } else if (want === "view") {
        await expect(page.getByRole("menu")).toHaveCount(0);
        await page.keyboard.press("Escape");
      }
      expect(await exists(page, kind.path), `${key} keeps the file`).toBe(true);
      seen.push(key);
    }
    expect(seen.length).toBeGreaterThan(2);
    expect(errors).toEqual([]);
  });
}
