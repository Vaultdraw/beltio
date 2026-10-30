import { type Page } from "@playwright/test";

import { expect, test } from "../fixture";

import { openVault } from "../helpers";
import { readTabs } from "../tabsHelpers";

// Family (bug hunter K, 2026-10-30): every "Copy path" puts the right text on the clipboard,
// says so, and a copied Vaultdraw link opens the file it was copied from. One row per kind
// of tree entry (drawing in a folder, note, note in a folder, Obsidian drawing, folder), and
// the tab menu's Copy path. Obsidian: "Copy path" (vault-relative and absolute) and
// "Copy Obsidian URL" exist for every file, and the URL opens that file.
// The crawler never opens row or tab menus (COVERAGE-G.md), so nothing clicked these before.

type Kind = { name: string; path: string; folder?: boolean };

const KINDS: Kind[] = [
  { name: "drawing in a folder", path: "DSA/Graphs.excalidraw" },
  { name: "note", path: "Ideas.md" },
  { name: "note in a folder", path: "Daily/2026-10-27.md" },
  {
    name: "Obsidian drawing",
    path: "Drawings/Plugin Sketch.excalidraw.md",
  },
  { name: "folder", path: "Daily", folder: true },
];

/** Records clipboard writes in `window.__copied`; `fail` makes every write reject. */
const stubClipboard = (page: Page, fail = false) =>
  page.addInitScript((failWrites) => {
    const w = window as any;
    w.__copied = [] as string[];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          if (failWrites) {
            return Promise.reject(new Error("NotAllowedError"));
          }
          w.__copied.push(text);
          return Promise.resolve();
        },
      },
    });
  }, fail);

const copied = (page: Page) =>
  page.evaluate(() => [...(window as any).__copied] as string[]);

const row = (page: Page, path: string) =>
  page.locator(`[data-tree-path="${path}"]`);

/** Unfolds every folder above `path` so its row is visible. */
const showRow = async (page: Page, path: string) => {
  const parts = path.split("/");
  for (let n = 1; n < parts.length; n++) {
    const dir = parts.slice(0, n).join("/");
    await expect(row(page, dir)).toBeVisible();
    if ((await row(page, dir).getAttribute("aria-expanded")) !== "true") {
      await row(page, dir).locator(".vault-tree-item__toggle").click();
    }
  }
  await expect(row(page, path)).toBeVisible();
};

/** Right-click the row, open "Copy path", return the submenu item labels. */
const openCopyMenu = async (page: Page, path: string) => {
  await row(page, path).click({ button: "right" });
  const copy = page.getByRole("menuitem", { name: /^Copy path/ });
  await expect(copy).toBeVisible();
  await copy.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("menuitem", { name: "Relative to vault" }),
  ).toBeFocused();
};

const clickCopy = async (page: Page, path: string, item: string) => {
  await openCopyMenu(page, path);
  await page.getByRole("menuitem", { name: item, exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
};

const linkOf = (path: string) =>
  `vaultdraw://open?file=${encodeURIComponent(path).replace(/%2F/gi, "/")}`;

for (const kind of KINDS) {
  test(`row menu Copy path of a ${kind.name}: relative, absolute${
    kind.folder ? "" : " and Vaultdraw link"
  } reach the clipboard and a notice says so`, async ({ page }) => {
    await stubClipboard(page);
    await openVault(page, "?seed=obsidian");
    await showRow(page, kind.path);

    await clickCopy(page, kind.path, "Relative to vault");
    await expect(
      page.locator(".vd-toast").filter({ hasText: `Copied ${kind.path}` }),
    ).toBeVisible();

    await clickCopy(page, kind.path, "Absolute path");
    // A folder never gets a Vaultdraw link (links open files).
    await openCopyMenu(page, kind.path);
    await expect(
      page.getByRole("menuitem", { name: "Vaultdraw link", exact: true }),
    ).toHaveCount(kind.folder ? 0 : 1);
    if (kind.folder) {
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
    } else {
      await page
        .getByRole("menuitem", { name: "Vaultdraw link", exact: true })
        .click();
    }
    await expect(page.getByRole("menu")).toHaveCount(0);

    const got = await copied(page);
    expect(got[0]).toBe(kind.path);
    expect(got[1]).toMatch(
      new RegExp(`^/.+/${kind.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    );
    expect(got[1]).not.toContain("//");
    if (kind.folder) {
      expect(got).toHaveLength(2);
    } else {
      expect(got[2]).toBe(linkOf(kind.path));
    }
  });
}

/** The window side of a clicked link: Rust hands the plan with `file` as written in the link. */
const openLink = (page: Page, link: string) =>
  page.evaluate(async (file) => {
    try {
      return await (window as any).__controlMethods["uri.run"]({
        action: "open",
        file,
        allowed: true,
        allowSwitch: false,
        origin: "os",
      });
    } catch (e) {
      return { error: String((e as Error).message ?? e) };
    }
  }, decodeURIComponent(link.split("file=")[1]));

test("a drawing's copied Vaultdraw link opens the drawing", async ({
  page,
}) => {
  await stubClipboard(page);
  await openVault(page, "?seed=obsidian");
  const path = "DSA/Graphs.excalidraw";
  await showRow(page, path);
  await clickCopy(page, path, "Vaultdraw link");
  const [link] = await copied(page);
  expect(await openLink(page, link)).toEqual({ status: "done" });
  await expect
    .poll(async () => (await readTabs(page)).find((t) => t.active)?.path)
    .toBe(path);
});

for (const path of ["Ideas.md", "Drawings/Plugin Sketch.excalidraw.md"]) {
  test(`toimprove 206: the copied Vaultdraw link of ${path} opens it`, async ({
    page,
  }) => {
    await stubClipboard(page);
    await openVault(page, "?seed=obsidian");
    await showRow(page, path);
    await clickCopy(page, path, "Vaultdraw link");
    const [link] = await copied(page);
    expect(link).toBe(linkOf(path));
    expect(await openLink(page, link)).toEqual({ status: "done" });
    await expect
      .poll(async () => (await readTabs(page)).find((t) => t.active)?.path, {
        timeout: 3000,
      })
      .toBe(path);
  });
}

const tabOf = (page: Page, path: string) =>
  page.locator(`[data-testid=vault-tab][data-path="${path}"]`);

test("tab menu Copy path copies the path and says so", async ({ page }) => {
  await stubClipboard(page);
  await openVault(page, "?seed=obsidian");
  const path = "Ideas.md";
  await showRow(page, path);
  await row(page, path).locator(".vault-tree-item__name").click();
  await tabOf(page, path).click({ button: "right" });
  const menu = page.getByTestId("vault-tab-menu");
  await menu.getByRole("menuitem", { name: "Copy path", exact: true }).click();
  await expect(menu).toHaveCount(0);
  expect(await copied(page)).toEqual([path]);
  await expect(page.getByText("Path copied")).toBeVisible();
});

test("row menu Copy path says so when the clipboard refuses", async ({
  page,
}) => {
  await stubClipboard(page, true);
  await openVault(page, "?seed=obsidian");
  await showRow(page, "Ideas.md");
  await clickCopy(page, "Ideas.md", "Relative to vault");
  await expect(page.getByText("Could not copy the path")).toBeVisible();
});

test("toimprove 207: tab menu Copy path says so when the clipboard refuses (the row menu does)", async ({
  page,
}) => {
  await stubClipboard(page, true);
  await openVault(page, "?seed=obsidian");
  const path = "Ideas.md";
  await showRow(page, path);
  await row(page, path).locator(".vault-tree-item__name").click();
  await tabOf(page, path).click({ button: "right" });
  const menu = page.getByTestId("vault-tab-menu");
  await menu.getByRole("menuitem", { name: "Copy path", exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByText(/could not copy/i)).toBeVisible({
    timeout: 3000,
  });
});
