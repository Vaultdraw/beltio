import { expect, test, type Page } from "@playwright/test";

import { openVault, trackErrors } from "../helpers";

// The breaker's daily session: what a user of Obsidian / Finder does with a vault in a day,
// on an Obsidian-shaped vault (nested folders, notes, odd names with spaces, accents and
// emoji, 500+ files). Each test is one part of the day; it compares with the reference apps
// (Obsidian, Finder) and collects every difference with expect.soft, so one run reports all
// of them. Run it again after every batch of merges (personal/feature/breaker/FINDINGS.md).
//
// The vault is built after the app has started (in-memory repository), then the Refresh
// button shows it, like pressing Refresh after copying a vault in with the file manager.

const EMPTY = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "e2e",
  elements: [],
  appState: {},
  files: {},
});

const ODD = [
  "Café notes",
  "日本語ノート",
  "Plan 2026 ✅",
  "résumé — draft",
  "spaced  out",
  "emoji 🎨 board",
  "UPPER lower",
  "Ünïcödé",
];

const AREAS = ["Projects", "Areas", "Archive", "Daily", "Inbox", "Attachments"];

/** An Obsidian-shaped vault: 6 top folders x 4 sub folders x notes and drawings = 960+ files. */
const buildVault = (page: Page) =>
  page.evaluate(
    ({ empty, odd, areas }) => {
      const repo = (window as any).__vaultRepo;
      let count = 0;
      for (const area of areas) {
        for (let s = 0; s < 4; s++) {
          const dir = `${area}/Sub ${s} ${s % 2 ? "ü" : "plain"}`;
          repo.seedFolder(dir);
          for (let i = 0; i < 20; i++) {
            const base = `${odd[(s * 5 + i) % odd.length]} ${i}`;
            repo.seedDrawing(`${dir}/${base}.excalidraw`, empty);
            repo.seedNote(`${dir}/${base}.md`);
            count += 2;
          }
        }
      }
      for (const name of odd) {
        repo.seedDrawing(`${name}.excalidraw`, empty);
        count++;
      }
      repo.seedFolder("Empty folder");
      repo.seedDrawing("Projects/Keep/Inside.excalidraw", empty);
      repo.seedDrawing("Projects/Keep/Deep/Deeper.excalidraw", empty);
      return count + 2;
    },
    { empty: EMPTY, odd: ODD, areas: AREAS },
  );

const row = (page: Page, path: string) =>
  page.locator(`[data-tree-path="${path}"]`);

const pathExists = (page: Page, path: string) =>
  page.evaluate(async (p) => {
    const repo = (window as any).__vaultRepo;
    const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    const entries = await repo.listDirectory(repo.handle, dir);
    return entries.some((e: any) => e.path === p);
  }, path);

const refresh = async (page: Page) => {
  await page.getByRole("button", { name: "Refresh files" }).click();
};

const expand = async (page: Page, path: string) => {
  const toggle = row(page, path).locator(".vault-tree-item__toggle");
  if ((await toggle.getAttribute("aria-label")) === "Expand") {
    await toggle.click();
  }
};

const rowMenu = async (page: Page, path: string, label: string | RegExp) => {
  const r = row(page, path);
  await r.hover();
  await r.getByRole("button", { name: "More actions" }).click();
  return page.getByRole("menuitem", { name: label });
};

/** Words an Obsidian user would not understand in a title or button: config keys, backticks. */
const jargon = (text: string) => {
  const found: string[] = [];
  if (/`/.test(text)) {
    found.push("backtick");
  }
  for (const m of text.matchAll(/\b[a-z]+_[a-z_]+\b/g)) {
    found.push(m[0]);
  }
  return found;
};

test.beforeEach(async ({ page }) => {
  await openVault(page, "?seed=empty&config=1");
  const n = await buildVault(page);
  expect(n).toBeGreaterThan(500);
  await refresh(page);
  await expect(row(page, "Projects")).toBeVisible();
});

test("browse: folders open, names with spaces, accents and emoji show whole", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await expand(page, "Projects");
  await expect(row(page, "Projects/Sub 0 plain")).toBeVisible();
  for (const name of ["Café notes", "日本語ノート", "Plan 2026 ✅"]) {
    await expect.soft(row(page, `${name}.excalidraw`), name).toBeVisible();
  }
  const names = page.locator(".vault-tree-item__name");
  const count = await names.count();
  for (let i = 0; i < Math.min(count, 30); i++) {
    const t = (await names.nth(i).textContent()) ?? "";
    expect.soft(t.trim(), "no empty row names").not.toBe("");
  }
  expect(errors).toEqual([]);
});

test("search: accents, case, emoji and spaces find the right file", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const search = page.getByPlaceholder("Search drawings and text…");
  const rows = page.locator(".vault-search-row");
  // Obsidian and Finder find "Café" when you type "cafe", and ignore case.
  for (const [query, expected] of [
    ["cafe", "Café notes"],
    ["CAFE", "Café notes"],
    ["resume", "résumé"],
    ["unicode", "Ünïcödé"],
    ["emoji 🎨", "emoji"],
    ["plan 2026", "Plan 2026"],
  ] as const) {
    await search.fill(query);
    await expect
      .soft(rows.filter({ hasText: expected }).first(), `search "${query}"`)
      .toBeVisible({ timeout: 5000 });
  }
  // A query nobody matches says so, in plain words.
  await search.fill("zzzz-nothing-here");
  await expect
    .soft(page.getByText(/no (results|matches|drawings)/i))
    .toBeVisible();
  await search.fill("");
  expect(errors).toEqual([]);
});

test("files: create, rename, move, delete a non-empty folder like Finder does", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const dialog = page.getByRole("dialog");

  // Create a folder with an odd name.
  await page.getByRole("button", { name: "New Folder" }).click();
  await dialog.getByLabel("Name").fill("Réunions 🎯");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect.soft(row(page, "Réunions 🎯")).toBeVisible();

  // Rename it.
  await (await rowMenu(page, "Réunions 🎯", "Rename…")).click();
  await dialog.getByLabel("New name").fill("Meetings");
  await dialog.getByRole("button", { name: "Rename" }).click();
  await expect.soft(row(page, "Meetings")).toBeVisible();
  expect.soft(await pathExists(page, "Meetings")).toBe(true);

  // Renaming onto an existing name: a clear message (Finder asks, Obsidian says it exists).
  await (await rowMenu(page, "Meetings", "Rename…")).click();
  await dialog.getByLabel("New name").fill("Projects");
  await dialog.getByRole("button", { name: "Rename" }).click();
  await expect
    .soft(
      dialog.or(page.getByRole("alert")).first(),
      "a collision is explained",
    )
    .toContainText(/exists|already|taken/i);
  await page.keyboard.press("Escape");

  // Delete a NON-EMPTY folder: one confirmation, then it and everything in it are gone.
  await expand(page, "Projects");
  await (await rowMenu(page, "Projects/Keep", /Move to Trash|Delete/)).click();
  await expect.soft(dialog).toContainText(/trash/i);
  await dialog.getByRole("button", { name: /Move to Trash|Delete/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect.soft(row(page, "Projects/Keep")).toHaveCount(0);
  expect.soft(await pathExists(page, "Projects/Keep")).toBe(false);

  // Delete an empty folder and a single file.
  await (await rowMenu(page, "Empty folder", /Move to Trash|Delete/)).click();
  await dialog.getByRole("button", { name: /Move to Trash|Delete/ }).click();
  await expect.soft(row(page, "Empty folder")).toHaveCount(0);

  await (await rowMenu(page, "Café notes.excalidraw", /Move to Trash/)).click();
  await dialog.getByRole("button", { name: "Move to Trash" }).click();
  await expect.soft(row(page, "Café notes.excalidraw")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("outside changes: a file added, renamed and deleted in Finder shows up, an open tab survives", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await row(page, "Plan 2026 ✅.excalidraw").click();
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  const out = (c: object) =>
    page.evaluate((x) => (window as any).__vaultRepo.outside(x), c);
  await out({ op: "create", path: "From Finder.excalidraw" });
  await expect.soft(row(page, "From Finder.excalidraw")).toBeVisible();
  await out({
    op: "rename",
    path: "From Finder.excalidraw",
    to: "Renamed in Finder.excalidraw",
  });
  await expect.soft(row(page, "Renamed in Finder.excalidraw")).toBeVisible();
  await expect.soft(row(page, "From Finder.excalidraw")).toHaveCount(0);
  await out({ op: "delete", path: "Plan 2026 ✅.excalidraw" });
  await expect.soft(row(page, "Plan 2026 ✅.excalidraw")).toHaveCount(0);
  await expect.soft(page.getByRole("alert")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("every Settings page opens, and its titles and buttons have no config keys or backticks", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  const tabs = await dialog.getByRole("tab").allTextContents();
  expect(tabs.length).toBeGreaterThan(5);
  for (const label of tabs) {
    await dialog.getByRole("tab", { name: label, exact: true }).click();
    const text = (await dialog.innerText()).replace(/\s+/g, " ");
    expect.soft(text.length, `${label} page is not empty`).toBeGreaterThan(20);
    const titles = await dialog
      .locator(".vault-setting-label, button, h2, h3")
      .allInnerTexts();
    for (const t of titles) {
      expect.soft(jargon(t), `${label}: "${t.trim()}"`).toEqual([]);
    }
  }
  await page.keyboard.press("Escape");
  await expect.soft(dialog).toBeHidden();
  expect(errors).toEqual([]);
});

test("command palette: opens, filters, closes with Escape", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.keyboard.press("Meta+Shift+KeyP");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.type("new folder");
  await expect
    .soft(dialog.getByRole("option").first())
    .toContainText(/folder/i);
  await page.keyboard.press("Escape");
  await expect.soft(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("tabs: open three drawings, switch, close; the editor follows", async ({
  page,
}) => {
  const errors = trackErrors(page);
  for (const name of ["Café notes", "Ünïcödé", "UPPER lower"]) {
    await row(page, `${name}.excalidraw`).click();
    await expect(
      page.locator(".vault-editor canvas.interactive"),
    ).toBeVisible();
  }
  const tabs = page.getByTestId("vault-tab");
  await expect.soft(tabs).toHaveCount(3);
  await tabs.first().click();
  await expect
    .soft(page.locator(".vault-breadcrumbs__item--active"))
    .toContainText("Café notes");
  await page.getByTestId("vault-tab-close").first().click();
  await expect.soft(tabs).toHaveCount(2);
  expect(errors).toEqual([]);
});
