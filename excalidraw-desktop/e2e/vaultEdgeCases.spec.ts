import { expect, test, type Locator, type Page } from "@playwright/test";

import { enterVault, openVault, trackErrors } from "./helpers";
import {
  openPanelByShortcut,
  panel,
  PATH as GRAPHS,
  rectEl,
  rows,
  runPaletteCommand,
  setup as setupHistory,
} from "./historyHelpers";
import {
  activeTab,
  clickTree,
  expectShown,
  readTabs,
  sceneJson,
  seedDrawings,
  tabByName,
  tabEls,
  tabNames,
} from "./tabsHelpers";

// Vault, files, tabs, notes and Obsidian: a few data-driven tests that each check many
// things in one pass (owner, 2026-10-28: "don't repeat tests 100 times, have each test think
// about everything"). The fake vault is in memory, so case-insensitive file systems and the
// native path rules are out of reach here: those are covered by the Rust tests.

const MOD = "Meta";
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const row = (page: Page, path: string): Locator =>
  page.locator(
    `.vault-tree-container .vault-tree-item[data-tree-path="${path}"]`,
  );

const rowByName = (page: Page, name: string): Locator =>
  page
    .locator(".vault-tree-item")
    .filter({
      has: page.locator(".vault-tree-item__name", {
        hasText: new RegExp(`^${esc(name)}$`),
      }),
    })
    .first();

// The app's own dialogs (the editor's property popovers also carry role=dialog).
const dialog = (page: Page) => page.locator(".vault-modal-backdrop");

/** Everything the fake vault holds, as sorted vault paths (files, folders, notes). */
const allPaths = (page: Page): Promise<string[]> =>
  page.evaluate(async () => {
    const repo = (window as any).__vaultRepo;
    const out: string[] = [];
    const walk = async (dir: string) => {
      for (const e of await repo.listDirectory(repo.handle, dir)) {
        out.push(e.path);
        if (e.kind === "folder") {
          await walk(e.path);
        }
      }
    };
    await walk("");
    return out.sort();
  });

const readFake = (page: Page, path: string) =>
  page.evaluate(async (p) => {
    const repo = (window as any).__vaultRepo;
    try {
      return (await repo.readDrawing(repo.handle, p)).json as string;
    } catch {
      return null;
    }
  }, path);

const rescan = (page: Page) =>
  page.evaluate(() => {
    const repo = (window as any).__vaultRepo;
    repo.emit({ handle: repo.handle, paths: [], rescan: true });
  });

/** After a dialog's submit: the dialog's own error, or a page alert after it closed, or null. */
const settle = async (page: Page, d: Locator): Promise<string | null> => {
  // Either the dialog shows the error, or it closes and a page alert reports it.
  const alert = page.getByRole("alert");
  await expect(async () => {
    const closed = (await d.count()) === 0;
    const shown =
      (await d.locator(".vault-error-text").count()) > 0 ||
      (await alert.count()) > 0;
    expect(closed || shown).toBe(true);
  }).toPass({ timeout: 25_000 });
  await page.waitForTimeout(150);
  let text: string | null = null;
  if ((await d.locator(".vault-error-text").count()) > 0) {
    text = await d.locator(".vault-error-text").innerText();
  } else if ((await alert.count()) > 0) {
    text = await alert.first().innerText();
  }
  if ((await d.count()) > 0) {
    await page.keyboard.press("Escape");
    await expect(d).toHaveCount(0);
  }
  if (text) {
    await alert
      .getByRole("button")
      .first()
      .click({ timeout: 500 })
      .catch(() => {});
  }
  return text;
};

/** Toolbar "New Drawing" / "New Folder" -> dialog -> Create. Returns the error text, if any. */
const createVia = async (
  page: Page,
  kind: "Drawing" | "Folder",
  name: string,
): Promise<string | null> => {
  await page.getByRole("button", { name: `New ${kind}`, exact: true }).click();
  const d = dialog(page);
  await expect(d).toBeVisible();
  await d.getByLabel("Name").fill(name);
  await d.getByRole("button", { name: "Create" }).click();
  return settle(page, d);
};

/** Row "More actions" menu -> item. */
const rowMenu = async (page: Page, r: Locator, label: string) => {
  await r.hover();
  await r.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
};

const renameVia = async (page: Page, r: Locator, name: string) => {
  await rowMenu(page, r, "Rename");
  const d = dialog(page);
  await d.getByLabel("New name").fill(name);
  await d.getByRole("button", { name: "Rename" }).click();
  return settle(page, d);
};

const trashVia = async (page: Page, r: Locator) => {
  await rowMenu(page, r, "Move to Trash");
  await dialog(page).getByRole("button", { name: "Move to Trash" }).click();
  await expect(dialog(page)).toHaveCount(0);
};

// Pointer-event drag in the tree (not HTML5 drag and drop).
const centerOf = async (l: Locator) => {
  const b = await l.boundingBox();
  if (!b) {
    throw new Error("not visible");
  }
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const dragRow = async (page: Page, from: Locator, to: Locator) => {
  await expect(from).toBeVisible();
  await expect(to).toBeVisible();
  const a = await centerOf(from.locator(".vault-tree-item__name"));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 12, a.y + 6, { steps: 4 });
  const b = await centerOf(to);
  await page.mouse.move(b.x, b.y, { steps: 12 });
  return b;
};

const LONG = `Long ${"abcdefghij".repeat(20)}`; // 205 characters, under the 255 limit
const TOO_LONG = "x".repeat(256);

test("tree: create, rename, move, duplicate and delete with awkward names", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?seed=empty");
  await expect(page.locator(".vault-tree-item")).toHaveCount(0);

  // Create: unicode, spaces, emoji, a very long name and names that differ only in case.
  const good = [
    "Ünïcödé résumé",
    "two words  spaced",
    "emoji 🎨 plan",
    "日本語のメモ",
    "Case",
    LONG,
  ];
  for (const name of good) {
    expect(await createVia(page, "Drawing", name)).toBeNull();
    await expect(
      page.locator(".vault-editor canvas.interactive"),
    ).toBeVisible();
  }
  const paths = await allPaths(page);
  for (const name of good) {
    expect(paths).toContain(`${name}.excalidraw`);
  }
  // The long name stays inside the navigator: no horizontal overflow in the tree.
  const tree = page.locator(".vault-tree-container");
  expect(
    await tree.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  // Seven tabs, one per created drawing, the last one active.
  expect(await tabNames(page)).toHaveLength(good.length);
  expect(await activeTab(page)).toBe(LONG);

  // A name that is already taken is refused with a message; nothing is overwritten.
  const before = await allPaths(page);
  expect(await createVia(page, "Drawing", "Case")).toMatch(/exist|collision/i);
  // ...and so is one that differs only in case (case-insensitive file systems).
  expect(await createVia(page, "Drawing", "CASE")).toMatch(/exist|collision/i);
  // Dot-names are reserved: never listed, so never created.
  expect(await createVia(page, "Drawing", ".hidden")).toMatch(/dot/i);
  expect(await createVia(page, "Folder", ".obsidian")).toMatch(/dot/i);
  expect(await allPaths(page)).toEqual(before);

  // Folders: odd names, then a clash.
  for (const name of ["Spaced Folder", "Ördner ✨"]) {
    expect(await createVia(page, "Folder", name)).toBeNull();
    await expect(rowByName(page, name)).toBeVisible();
  }
  // (The fake vault accepts an existing folder name; the native side refuses it.)
  await createVia(page, "Folder", "Spaced Folder");
  await expect(rowByName(page, "Spaced Folder")).toHaveCount(1);

  // Rename: refused names show a message and change nothing; a good rename moves the file.
  const target = rowByName(page, "Ünïcödé résumé");
  const bad = [
    ["", /./],
    ["a/b", /slash/i],
    ["a\\b", /slash/i],
    ["a:b", /colon/i],
    [".", /dot/i],
    ["..", /dot/i],
    [".excalidraw-vault", /dot|reserved/i],
    [TOO_LONG, /too long/i],
  ] as const;
  for (const [name, expected] of bad) {
    if (name === "") {
      await rowMenu(page, target, "Rename");
      await dialog(page).getByLabel("New name").fill("");
      await expect(
        dialog(page).getByRole("button", { name: "Rename" }),
      ).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(dialog(page)).toHaveCount(0);
      continue;
    }
    const got = await renameVia(page, target, name);
    expect(`${name.slice(0, 12)} -> ${got}`).toMatch(expected);
  }
  expect(await allPaths(page)).toEqual(
    before.concat(["Ördner ✨", "Spaced Folder"]).sort(),
  );
  // Rename onto an existing name is refused; rename to a new name works and keeps content.
  expect(await renameVia(page, target, "Case")).toMatch(/exist|collision/i);
  const content = await readFake(page, "Ünïcödé résumé.excalidraw");
  expect(await renameVia(page, target, "Résumé 📄")).toBeNull();
  await expect(rowByName(page, "Résumé 📄")).toBeVisible();
  expect(await readFake(page, "Résumé 📄.excalidraw")).toBe(content);
  expect(await readFake(page, "Ünïcödé résumé.excalidraw")).toBeNull();
  // A case-only rename of the same drawing works; a twin that differs by accent case is refused.
  expect(
    await renameVia(page, rowByName(page, "Résumé 📄"), "RÉSUMÉ 📄"),
  ).toBeNull();
  await expect(rowByName(page, "RÉSUMÉ 📄")).toBeVisible();
  expect(
    await renameVia(page, rowByName(page, "emoji 🎨 plan"), "résumé 📄"),
  ).toMatch(/exist|collision/i);
  expect(await readFake(page, "RÉSUMÉ 📄.excalidraw")).toBe(content);
  await renameVia(page, rowByName(page, "RÉSUMÉ 📄"), "Résumé 📄");
  // Its open tab follows the rename.
  expect(await tabNames(page)).toContain("Résumé 📄");
  expect(await tabNames(page)).not.toContain("Ünïcödé résumé");

  // Duplicate twice: "x copy", "x copy 2".
  await rowMenu(page, rowByName(page, "emoji 🎨 plan"), "Duplicate");
  await expect(rowByName(page, "emoji 🎨 plan copy")).toBeVisible();
  await rowMenu(page, rowByName(page, "emoji 🎨 plan copy"), "Duplicate");
  await expect(rowByName(page, "emoji 🎨 plan copy 2")).toBeVisible();

  // Move through the dialog into a folder with a name that holds a space.
  await rowMenu(page, rowByName(page, "日本語のメモ"), "Move to…");
  await dialog(page)
    .getByRole("treeitem", { name: "Spaced Folder", exact: true })
    .click();
  await dialog(page).getByRole("button", { name: "Move Here" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect
    .poll(() => readFake(page, "Spaced Folder/日本語のメモ.excalidraw"))
    .not.toBeNull();
  expect(await readFake(page, "日本語のメモ.excalidraw")).toBeNull();

  // Trash: cancel keeps it; confirm removes it and closes its tab; a non-empty folder is refused.
  await rowMenu(page, rowByName(page, "Case"), "Move to Trash");
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  expect(await readFake(page, "Case.excalidraw")).not.toBeNull();
  const tabsBefore = (await tabNames(page)).length;
  await trashVia(page, rowByName(page, "Case"));
  await expect.poll(() => readFake(page, "Case.excalidraw")).toBeNull();
  await expect
    .poll(async () => (await tabNames(page)).length)
    .toBe(tabsBefore - 1);
  const spaced = rowByName(page, "Spaced Folder");
  if ((await spaced.getAttribute("aria-expanded")) !== "true") {
    await spaced.locator(".vault-tree-item__toggle").click();
  }
  await expect(rowByName(page, "日本語のメモ")).toBeVisible();
  await rowMenu(page, rowByName(page, "Spaced Folder"), "Move to Trash");
  await dialog(page).getByRole("button", { name: "Move to Trash" }).click();
  await expect(rowByName(page, "Spaced Folder")).toBeVisible(); // refused: not empty
  expect(
    await readFake(page, "Spaced Folder/日本語のメモ.excalidraw"),
  ).not.toBeNull();
  await page.keyboard.press("Escape");

  expect(errors).toEqual([]);
});

test("tree: drag and drop moves, refuses clashes, descendants and a read-only vault", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const scene = sceneJson([{ id: "s" }]);
  await openVault(page, "?seed=empty");
  await seedDrawings(page, {
    "A/one.excalidraw": scene,
    "A/shared.excalidraw": scene,
    "B/shared.excalidraw": scene,
    "B/Deep/two.excalidraw": scene,
    "C Folder/three.excalidraw": scene,
    "root.excalidraw": scene,
  });
  await rescan(page);
  for (const f of ["A", "B", "C Folder"]) {
    await expect(row(page, f)).toBeVisible();
  }
  await row(page, "A").locator(".vault-tree-item__toggle").click();
  await row(page, "B").locator(".vault-tree-item__toggle").click();
  await expect(row(page, "B/Deep")).toBeVisible();

  const ghost = page.locator(".vault-tree-drag-ghost");

  // A clash is refused up front, with the reason on the ghost; nothing moves.
  await dragRow(page, row(page, "A/shared.excalidraw"), row(page, "B"));
  await expect(ghost).toHaveAttribute("data-allowed", "false");
  await expect(ghost).toContainText(/already exists/i);
  await page.mouse.up();
  await expect(ghost).toHaveCount(0);
  expect(await readFake(page, "A/shared.excalidraw")).not.toBeNull();

  // A folder into its own descendant is refused.
  await dragRow(page, row(page, "B"), row(page, "B/Deep"));
  await expect(ghost).toHaveAttribute("data-allowed", "false");
  await page.mouse.up();
  await expect(ghost).toHaveCount(0);
  expect(await readFake(page, "B/Deep/two.excalidraw")).not.toBeNull();

  // Escape during a drag cancels it.
  await dragRow(page, row(page, "A/one.excalidraw"), row(page, "C Folder"));
  await expect(ghost).toBeVisible();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(ghost).toHaveCount(0);
  expect(await readFake(page, "A/one.excalidraw")).not.toBeNull();

  // A good move: a drawing into a folder whose name has a space, then a folder into a folder.
  await dragRow(page, row(page, "A/one.excalidraw"), row(page, "C Folder"));
  await page.mouse.up();
  await expect
    .poll(() => readFake(page, "C Folder/one.excalidraw"))
    .not.toBeNull();
  expect(await readFake(page, "A/one.excalidraw")).toBeNull();
  await dragRow(page, row(page, "B/Deep"), row(page, "A"));
  await page.mouse.up();
  await expect
    .poll(() => readFake(page, "A/Deep/two.excalidraw"))
    .not.toBeNull();
  expect(await readFake(page, "B/Deep/two.excalidraw")).toBeNull();

  // A drawing to the vault root by dropping on the empty space below the rows.
  const box = (await page.locator(".vault-tree-container").boundingBox())!;
  const from = await centerOf(
    row(page, "A/shared.excalidraw").locator(".vault-tree-item__name"),
  );
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 6, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 8, {
    steps: 12,
  });
  await page.mouse.up();
  await expect.poll(() => readFake(page, "shared.excalidraw")).not.toBeNull();

  expect(errors).toEqual([]);

  // Read-only vault: the same drag is refused, and no create or delete is offered.
  await page.goto("/e2e.html?readonly=1");
  await enterVault(page);
  await expect(page.getByRole("button", { name: "New Drawing" })).toHaveCount(
    0,
  );
  await row(page, "DSA").locator(".vault-tree-item__toggle").click();
  await dragRow(
    page,
    row(page, "DSA/Graphs.excalidraw"),
    row(page, "DSA/Dynamic Programming"),
  );
  // Dragging is switched off in a read-only vault: no ghost, nothing moves.
  await expect(ghost).toHaveCount(0);
  await page.mouse.up();
  expect(await readFake(page, "DSA/Graphs.excalidraw")).not.toBeNull();
  expect(
    await readFake(page, "DSA/Dynamic Programming/Graphs.excalidraw"),
  ).toBeNull();
  await row(page, "DSA/Graphs.excalidraw").click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Move to Trash" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("tabs: many tabs, pin, close others, reorder, reload, same file twice, a deleted file", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const names = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10"];
  const files: Record<string, string> = {};
  names.forEach((n, i) => {
    files[`${n}.excalidraw`] = sceneJson([{ id: `${n}-rect`, x: 100 + i }]);
  });
  await page.goto("/e2e.html?seed=empty");
  await enterVault(page, () => seedDrawings(page, files));
  await seedDrawings(page, files);
  const tabPaths = async () => (await readTabs(page)).map((t) => t.path);

  // Open all ten with Cmd+click: one tab each; the same file again only activates its tab.
  await clickTree(page, "T1");
  for (const n of names.slice(1)) {
    await clickTree(page, n, [MOD]);
  }
  await expect(tabEls(page)).toHaveCount(10);
  await clickTree(page, "T3", [MOD]);
  await expect(tabEls(page)).toHaveCount(10);
  expect(await activeTab(page)).toBe("T3");
  await expectShown(page, ["T3-rect"]);

  // Pin T2 and T4: pinned tabs lead the strip, hide the close button, survive "Close others".
  for (const n of ["T4", "T2"]) {
    await tabByName(page, n).click({ button: "right" });
    await page
      .getByTestId("vault-tab-menu")
      .getByRole("menuitem", { name: "Pin", exact: true })
      .click();
  }
  await expect
    .poll(async () => (await tabPaths()).slice(0, 2))
    .toEqual(["T4.excalidraw", "T2.excalidraw"]);
  await expect(page.getByTestId("vault-tab").first()).toHaveAttribute(
    "aria-label",
    "T4 (pinned)",
  );

  // Reorder: drag T6 before T5 (a plain drag, not a click).
  const dragTab = async (
    from: string,
    to: string,
    side: "before" | "after",
  ) => {
    const a = (await page
      .locator(`[data-testid=vault-tab][data-path="${from}.excalidraw"]`)
      .boundingBox())!;
    const b = (await page
      .locator(`[data-testid=vault-tab][data-path="${to}.excalidraw"]`)
      .boundingBox())!;
    const y = a.y + a.height / 2;
    const x0 = a.x + a.width / 2;
    const x1 = side === "after" ? b.x + b.width - 6 : b.x + 6;
    await page.mouse.move(x0, y);
    await page.mouse.down();
    await page.mouse.move(x0 - 6, y);
    await page.mouse.move((x0 + x1) / 2, y, { steps: 4 });
    await page.mouse.move(x1, y, { steps: 4 });
    await page.mouse.up();
  };
  await dragTab("T6", "T5", "before");
  await expect
    .poll(async () => (await tabPaths()).indexOf("T6.excalidraw"))
    .toBeLessThan((await tabPaths()).indexOf("T5.excalidraw") || 99);
  // An unpinned tab cannot be dropped among the pinned ones.
  await dragTab("T6", "T2", "before");
  expect((await tabPaths()).slice(0, 2)).toEqual([
    "T4.excalidraw",
    "T2.excalidraw",
  ]);

  // A deleted file's tab is marked missing; its placeholder offers Close tab.
  await page.evaluate(() =>
    (window as any).__vaultRepo.externalDelete("T9.excalidraw"),
  );
  const t9 = page.locator('[data-testid=vault-tab][data-path="T9.excalidraw"]');
  await expect(t9).toHaveClass(/vault-tabs__tab--missing/, {
    timeout: 5000,
  });
  await t9.click();
  await expect(page.getByTestId("missing-tab-placeholder")).toContainText(
    "T9.excalidraw",
  );
  await page.getByRole("button", { name: "Close tab" }).click();
  await expect(t9).toHaveCount(0);

  // Close and reopen with the shortcut, before the reload.
  await tabByName(page, "T10").click({ button: "middle" });
  await expect(tabEls(page)).toHaveCount(8);
  await page.keyboard.press(`${MOD}+Shift+KeyT`);
  await expect(tabEls(page)).toHaveCount(9);

  // Reload: the same tabs, order, pins and active tab come back.
  const session = await readTabs(page);
  await page.waitForTimeout(1600); // the session is written 1 s after the last change
  await page.reload();
  await enterVault(page);
  // T7's file is deleted outside the app right away, while its restored tab has not
  // loaded yet. The fake vault is in memory: put the other seeded files back.
  const { "T7.excalidraw": t7, ...withoutT7 } = files;
  await page.evaluate(() =>
    (window as any).__vaultRepo.externalDelete("T7.excalidraw"),
  );
  await seedDrawings(page, withoutT7);
  await expect(tabEls(page)).toHaveCount(9);
  const t7Tab = page.locator(
    '[data-testid=vault-tab][data-path="T7.excalidraw"]',
  );
  // Marked missing (not removed), the same as a loaded tab; it clears when the file is back.
  await expect(t7Tab).toHaveClass(/vault-tabs__tab--missing/, {
    timeout: 5000,
  });
  await seedDrawings(page, { "T7.excalidraw": t7 });
  await expect(t7Tab).not.toHaveClass(/vault-tabs__tab--missing/, {
    timeout: 5000,
  });
  expect(await readTabs(page)).toEqual(session);
  await expect(page.getByTestId("vault-tab").first()).toHaveAttribute(
    "aria-label",
    "T4 (pinned)",
  );

  // Close a tab with its close button, then reopen it where it was.
  const idx = (await tabPaths()).indexOf("T8.excalidraw");
  await tabByName(page, "T8").click({ button: "middle" });
  await expect(tabEls(page)).toHaveCount(8);
  await page.keyboard.press("Meta+Shift+KeyP");
  await page.keyboard.type("reopen closed tab");
  await page.keyboard.press("Enter");
  await expect(tabEls(page)).toHaveCount(9);
  expect((await tabPaths()).indexOf("T8.excalidraw")).toBe(idx);

  // Close others keeps the two pinned tabs and the one it was opened on.
  await tabByName(page, "T7").click({ button: "right" });
  await page
    .getByTestId("vault-tab-menu")
    .getByRole("menuitem", { name: "Close others", exact: true })
    .click();
  await expect
    .poll(async () => (await tabPaths()).sort())
    .toEqual(["T2.excalidraw", "T4.excalidraw", "T7.excalidraw"]);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// Links following renames

const textEl = (id: string, text: string, y: number) => ({
  id,
  type: "text",
  x: 220,
  y: 200 + y,
  width: 360,
  height: 25,
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 1,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  boundElements: [],
  link: null,
  locked: false,
  isDeleted: false,
  version: 1,
  versionNonce: 1,
  index: null,
  updated: 1,
  seed: 1,
  text,
  originalText: text,
  fontSize: 20,
  fontFamily: 1,
  textAlign: "left",
  verticalAlign: "top",
  containerId: null,
  lineHeight: 1.25,
});

const FORMS = [
  "[[Alpha]]",
  "[[Alpha|the alpha]]",
  "[[Alpha#Heading]]",
  "![[Alpha]]",
  "[[Alpha#Heading|shown]]",
  "[[Folder/Inner]]",
  "no link here",
];

const textsOf = async (page: Page, path: string) =>
  ((await readSceneJson(page, path))?.elements ?? [])
    .filter((e: any) => !e.isDeleted && e.type === "text")
    .map((e: any) => e.originalText as string);

const readSceneJson = async (page: Page, path: string) => {
  const json = await readFake(page, path);
  return json ? JSON.parse(json) : null;
};

const PREFS_KEY = "excalidraw-vault-preferences-v1";

/** Opens the links seed, adds a drawing with every link form, renames Alpha to Omega. */
const renameAlphaWith = async (
  page: Page,
  prefs: Record<string, unknown> | null,
) => {
  if (prefs) {
    await page.addInitScript(
      ([key, value]) => {
        window.localStorage.setItem(key as string, JSON.stringify(value));
      },
      [PREFS_KEY, prefs] as const,
    );
  }
  await openVault(page, "?seed=links");
  await seedDrawings(page, {
    "Forms.excalidraw": sceneJson(
      [],
      FORMS.map((t, i) => textEl(`f${i}`, t, i * 40)),
    ),
  });
  await rescan(page);
  await expect(rowByName(page, "Forms")).toBeVisible();
  expect(await renameVia(page, rowByName(page, "Alpha"), "Omega")).toBeNull();
  await expect(rowByName(page, "Omega")).toBeVisible();
  await page.waitForTimeout(1200); // rewrites run in the background
};

test("links follow a rename: every form is rewritten; off the links extension it still follows, update_on_rename false leaves them", async ({
  page,
  context,
}) => {
  const errors = trackErrors(page);
  await renameAlphaWith(page, null);
  await expect
    .poll(() => textsOf(page, "Forms.excalidraw"))
    .toEqual([
      "[[Omega]]",
      "[[Omega|the alpha]]",
      "[[Alpha#Heading]]", // a drawing link has no heading part: left alone
      "![[Omega]]",
      "[[Alpha#Heading|shown]]",
      "[[Folder/Inner]]",
      "no link here",
    ]);
  // The shape link and other drawings follow too; an unresolved link is left alone.
  expect(await textsOf(page, "Folder/Inner.excalidraw")).toContain(
    "Points at [[Omega]]",
  );
  expect(await textsOf(page, "Hub.excalidraw")).toContain(
    "Todo [[Missing Note]]",
  );

  // With the links extension off, a rename still follows the links (documented)...
  const off = await context.newPage();
  const offErrors = trackErrors(off);
  await renameAlphaWith(off, { extLinks: false });
  await expect
    .poll(() => textsOf(off, "Forms.excalidraw"))
    .toContain("[[Omega|the alpha]]");
  // ...and links.update_on_rename = false leaves every link alone.
  const none = await context.newPage();
  const noneErrors = trackErrors(none);
  await renameAlphaWith(none, { linkUpdateOnRename: false });
  expect(await textsOf(none, "Forms.excalidraw")).toEqual(FORMS);
  expect(await textsOf(none, "Folder/Inner.excalidraw")).toContain(
    "Points at [[Alpha]]",
  );
  expect([...offErrors, ...noneErrors]).toEqual([]);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// Notes and the Obsidian vault

const noteFiles = (page: Page) => ({
  text: (p: string) =>
    page.evaluate(
      (x) => (window as any).__noteFiles.textOf(x) as string | undefined,
      p,
    ),
  set: (p: string, t: string) =>
    page.evaluate(
      ([x, y]) => (window as any).__noteFiles.setOnDisk(x, y),
      [p, t],
    ),
});

const addNote = (page: Page, path: string, text: string) =>
  page.evaluate(
    ([p, t]) => {
      (window as any).__noteFiles.setOnDisk(p, t);
      (window as any).__vaultRepo.seedNote(p);
    },
    [path, text],
  );

const status = (page: Page) => page.getByTestId("note-status");

test("notes: tasks, edits, a file changed on disk, headings, embeds and odd names", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?seed=obsidian");
  // Notes added before the first note opens, so the vault-wide link walk knows them.
  const filler = Array.from({ length: 60 }, (_, i) => `Filler ${i}.`).join(
    "\n\n",
  );
  await addNote(
    page,
    "Target.md",
    `# Target\n\n${filler}\n\n## Deep end\n\nhere\n`,
  );
  await addNote(
    page,
    "Linker.md",
    "# Linker\n\nGo to [[Target#Deep end]] or [[Target]].\n",
  );
  const embed = "Embeds.md";
  await addNote(
    page,
    embed,
    "# Embeds\n\n![[Ideas#Later]]\n\nand ![[Ideas]]\n",
  );
  await addNote(page, "Ünï note 📝.md", "# Odd\n\n- [ ] a\n- [x] b\n");
  await addNote(page, `${LONG}.md`, "# Long\n");
  await addNote(page, "My Folder/inside.md", "# Inside\n");
  await rescan(page);
  const nf = noteFiles(page);
  const reading = page.getByTestId("note-reading");

  // A task box ticks and unticks through the guarded save, one line each time.
  await rowByName(page, "Ideas").locator(".vault-tree-item__name").click();
  await expect(reading.getByRole("heading", { name: "Ideas" })).toBeVisible();
  const box = reading.getByRole("checkbox").first();
  await box.click();
  await expect
    .poll(() => nf.text("Ideas.md"))
    .toContain("- [x] ship the follow-ups");
  await expect(status(page)).toHaveAttribute("data-status", "saved");
  await reading.getByRole("checkbox").first().click();
  await expect
    .poll(() => nf.text("Ideas.md"))
    .toContain("- [ ] ship the follow-ups");
  expect((await nf.text("Ideas.md"))!.match(/- \[.\]/g)).toHaveLength(1);

  // Edit and save; the disk text has the typed line and nothing else changed.
  const before = (await nf.text("Ideas.md"))!;
  await page.getByRole("button", { name: "Edit note" }).click();
  await page.getByTestId("note-editor").locator(".cm-content").click();
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.type("\nfirst edit ünï 🎨\n");
  await expect(status(page)).toHaveAttribute("data-status", "saved");
  expect(await nf.text("Ideas.md")).toBe(`${before}\nfirst edit ünï 🎨\n`);

  // The file changes on disk behind the open editor: the next save shows the banner.
  await nf.set("Ideas.md", "# Ideas\n\nCHANGED OUTSIDE\n");
  await page.keyboard.type("mine 1");
  const banner = page.getByRole("alert").filter({ hasText: "changed on disk" });
  await expect(banner).toBeVisible();
  expect(await nf.text("Ideas.md")).toBe("# Ideas\n\nCHANGED OUTSIDE\n"); // not overwritten
  // Reload from disk drops the edit and shows the disk text.
  await banner.getByRole("button", { name: "Reload from disk" }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByTestId("note-editor")).toContainText(
    "CHANGED OUTSIDE",
  );
  await expect(page.getByTestId("note-editor")).not.toContainText("mine 1");

  // A second clash; Keep mine overwrites the disk with the edit.
  await page.getByTestId("note-editor").locator(".cm-content").click();
  await page.keyboard.press("Meta+ArrowDown");
  await nf.set("Ideas.md", "# Ideas\n\nCHANGED AGAIN\n");
  await page.keyboard.type("mine 2");
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Keep mine" }).click();
  await expect(banner).toHaveCount(0);
  await expect.poll(() => nf.text("Ideas.md")).toContain("mine 2");
  await expect(status(page)).toHaveAttribute("data-status", "saved");
  await page.getByRole("button", { name: "Show reading view" }).click();

  // Heading links: a [[Note#Heading]] link opens the note scrolled to that heading.
  await rowByName(page, "Linker").locator(".vault-tree-item__name").click();
  await reading.getByText("Target > Deep end").click();
  await expect(
    reading.getByRole("heading", { name: "Deep end" }),
  ).toBeInViewport();
  await expect(
    reading.getByRole("heading", { name: "Target", exact: true }),
  ).toBeVisible();

  // Embeds, an emoji + unicode name, a very long name and a note in a folder with a space.
  await rowByName(page, "Embeds").locator(".vault-tree-item__name").click();
  await expect(reading.locator(".note-embed").first()).toBeVisible();
  // Ideas now holds what the edits above left on disk.
  await expect(reading).toContainText("mine 2");
  await rowByName(page, "Ünï note 📝")
    .locator(".vault-tree-item__name")
    .click();
  await expect(reading.getByRole("heading", { name: "Odd" })).toBeVisible();
  await reading.getByRole("checkbox").first().click();
  await expect.poll(() => nf.text("Ünï note 📝.md")).toContain("- [x] a");
  await rowByName(page, LONG).locator(".vault-tree-item__name").click();
  await expect(reading.getByRole("heading", { name: "Long" })).toBeVisible();
  const tree = page.locator(".vault-tree-container");
  expect(
    await tree.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  await rowByName(page, "My Folder")
    .locator(".vault-tree-item__toggle")
    .click();
  await rowByName(page, "inside").locator(".vault-tree-item__name").click();
  await expect(reading.getByRole("heading", { name: "Inside" })).toBeVisible();

  // A note is a tab like any other: five notes open, the strip names them.
  expect((await tabNames(page)).length).toBeGreaterThanOrEqual(1);
  expect(errors).toEqual([]);
});

test("notes: a note created, renamed or deleted right after a scan links at once", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?seed=obsidian");
  await addNote(
    page,
    "Hub.md",
    "# Hub\n\nSee [[Fresh Note]] and [[Renamed Note]].\n",
  );
  await rescan(page);
  await rowByName(page, "Hub").locator(".vault-tree-item__name").click();
  const reading = page.getByTestId("note-reading");
  const link = (name: string) =>
    reading.locator("a.wikilink", { hasText: name });
  await expect(link("Fresh Note")).toHaveClass(/unresolved/);
  // The scan above just ran (it repeats at most every 10 s); notes made now still link.
  const change = (paths: string[], rescanFlag = false) =>
    page.evaluate(
      ([p, r]) => {
        const repo = (window as any).__vaultRepo;
        repo.emit({ handle: repo.handle, paths: p, rescan: r });
      },
      [paths, rescanFlag] as const,
    );
  await addNote(page, "Fresh Note.md", "# Fresh\n");
  await change(["Fresh Note.md"]);
  await expect(link("Fresh Note")).not.toHaveClass(/unresolved/);
  // A rename: the new name links, the old one does not.
  await addNote(page, "Old Name.md", "# Old\n");
  await change(["Old Name.md"]);
  await page.evaluate(() => {
    const w = window as any;
    w.__noteFiles.setOnDisk("Renamed Note.md", "# Renamed\n");
    w.__vaultRepo.seedNote("Renamed Note.md");
  });
  await change(["Old Name.md", "Renamed Note.md"], true);
  await expect(link("Renamed Note")).not.toHaveClass(/unresolved/);
  // A delete unlinks it.
  await page.evaluate(() =>
    (window as any).__vaultRepo.notes.delete("Fresh Note.md"),
  );
  await change(["Fresh Note.md"]);
  await expect(link("Fresh Note")).toHaveClass(/unresolved/);
  expect(errors).toEqual([]);
});

test("Obsidian vault: browsing changes no byte, hidden folders are not listed, plugin drawings are read-only", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?seed=obsidian");
  const snapshot = () =>
    page.evaluate(async () => {
      const w = window as any;
      const repo = w.__vaultRepo;
      const out: Record<string, string> = {};
      for (const p of ["Welcome.md", "Ideas.md", "Daily/2026-10-27.md"]) {
        out[p] = w.__noteFiles.textOf(p);
      }
      for (const [p, row] of repo.files as Map<string, any>) {
        out[p] = `${row.revision}:${row.json}`;
      }
      return out;
    });
  const before = await snapshot();
  const writes = await page.evaluate(
    () => (window as any).__vaultRepo.writeCalls.length as number,
  );

  // Hidden folders and files are never listed, whatever is on disk.
  await page.evaluate(() => {
    const repo = (window as any).__vaultRepo;
    repo.seedFolder(".obsidian");
    repo.seedFolder(".trash");
    repo.seedNote(".hidden.md");
    repo.emit({ handle: repo.handle, paths: [], rescan: true });
  });
  await rescan(page);
  await expect(rowByName(page, "Welcome")).toBeVisible();
  for (const hidden of [".obsidian", ".trash", ".hidden"]) {
    await expect(rowByName(page, hidden)).toHaveCount(0);
  }

  // Browse everything: open every item, toggle the editor without typing, switch back.
  for (const f of ["Daily", "Drawings"]) {
    await rowByName(page, f).locator(".vault-tree-item__toggle").click();
  }
  for (const n of ["Welcome", "Ideas", "2026-10-27"]) {
    await rowByName(page, n).locator(".vault-tree-item__name").click();
    await expect(page.getByTestId("note-reading")).toBeVisible();
  }
  await page.getByRole("button", { name: "Edit note" }).click();
  await expect(page.getByTestId("note-editor")).toBeVisible();
  await page.getByRole("button", { name: "Show reading view" }).click();
  await rowByName(page, "Sketch").locator(".vault-tree-item__name").click();
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  for (const n of ["Plain", "Compressed", "Plugin Sketch"]) {
    const r = rowByName(page, n);
    if ((await r.count()) === 0) {
      continue;
    }
    await r.locator(".vault-tree-item__name").click();
    await expect(page.getByTestId("excalidraw-md-banner")).toBeVisible();
    await expect(
      page.locator(".vault-editor-container--readonly"),
    ).toBeVisible();
    // Drawing on a read-only plugin file changes nothing.
    const box = (await page
      .locator(".vault-editor canvas.interactive")
      .boundingBox())!;
    await page.keyboard.press("r");
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 380, { steps: 5 });
    await page.mouse.up();
  }
  await page.waitForTimeout(1200); // past the autosave delay
  expect(await snapshot()).toEqual(before);
  expect(
    await page.evaluate(
      () => (window as any).__vaultRepo.writeCalls.length as number,
    ),
  ).toBe(writes);
  // "Save a copy" hands the plugin file's bytes out; the vault copy stays as it was.
  await rowByName(page, "Plugin Sketch")
    .locator(".vault-tree-item__name")
    .click();
  await expect(page.getByTestId("excalidraw-md-banner")).toBeVisible();
  await runPaletteCommand(page, "Save a copy");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__vaultRepo.exported.map((e: any) => e.name as string),
      ),
    )
    .toContainEqual(expect.stringMatching(/Plugin Sketch/));
  expect(await snapshot()).toEqual(before);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// Sync conflict copies, empty / read-only / very large vaults, backup

test("sync conflict copies: every naming style gets a badge, a lone numbered name does not", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const sc = sceneJson([{ id: "x" }]);
  await openVault(page, "?seed=empty");
  await seedDrawings(page, {
    "Plan.excalidraw": sc,
    "Plan (conflicted copy 2026-01-01).excalidraw": sc,
    "Plan (Ana's MacBook's conflicted copy 2026-01-01).excalidraw": sc,
    "Plan.sync-conflict-20260101-120000-ABCDEFG.excalidraw": sc,
    "Plan 2.excalidraw": sc,
    "Solo 2.excalidraw": sc, // numbered, but "Solo" does not exist: not a conflict
    "Plan 2024.excalidraw": sc, // a year, not a copy number
  });
  await rescan(page);
  await expect(rowByName(page, "Plan")).toBeVisible();
  const badged = await page
    .locator(".vault-tree-item", {
      has: page.getByTestId("sync-conflict-badge"),
    })
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.treePath));
  expect(badged.sort()).toEqual(
    [
      "Plan (Ana's MacBook's conflicted copy 2026-01-01).excalidraw",
      "Plan (conflicted copy 2026-01-01).excalidraw",
      "Plan 2.excalidraw",
      "Plan.sync-conflict-20260101-120000-ABCDEFG.excalidraw",
    ].sort(),
  );
  expect(errors).toEqual([]);
});

test("an empty vault, a read-only vault and a very large drawing", async ({
  page,
}) => {
  const errors = trackErrors(page);

  // Empty: a hint, no rows; the first drawing appears and opens.
  await openVault(page, "?seed=empty");
  await expect(
    page.getByText("Vault is empty. Create your first drawing!"),
  ).toBeVisible();
  await expect(page.getByText("No Drawing Open")).toBeVisible();
  const search = page.getByPlaceholder("Search drawings and text…");
  await search.fill("anything");
  await expect(page.locator(".vault-search-row")).toHaveCount(0);
  await search.fill("");
  expect(await createVia(page, "Drawing", "First")).toBeNull();
  await expect(rowByName(page, "First")).toBeVisible();
  await expect(page.getByText("Vault is empty.")).toHaveCount(0);

  // Read-only and locked by another process: a badge explains why, no edit actions anywhere.
  await page.goto("/e2e.html?readonly=1&locked=1");
  await enterVault(page);
  const badge = page.getByRole("button", { name: /Read-Only/ });
  await expect(badge).toBeVisible();
  await badge.click();
  await expect(
    page.getByRole("dialog", { name: "Why this vault is read-only" }),
  ).toContainText("process 4242");
  await page.keyboard.press("Escape");
  for (const b of ["New Drawing", "New Folder"]) {
    await expect(
      page.getByRole("button", { name: b, exact: true }),
    ).toHaveCount(0);
  }
  await row(page, "DSA").locator(".vault-tree-item__toggle").click();
  await row(page, "DSA/Graphs.excalidraw")
    .locator(".vault-tree-item__name")
    .click();
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  await expect(page.locator(".vault-editor-container--readonly")).toBeVisible();
  const box = (await page
    .locator(".vault-editor canvas.interactive")
    .boundingBox())!;
  const beforeScene = await readFake(page, "DSA/Graphs.excalidraw");
  await page.keyboard.press("r");
  await page.mouse.move(box.x + 500, box.y + 400);
  await page.mouse.down();
  await page.mouse.move(box.x + 600, box.y + 480, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(1000);
  expect(await readFake(page, "DSA/Graphs.excalidraw")).toBe(beforeScene);
  await row(page, "DSA/Graphs.excalidraw").click({ button: "right" });
  for (const item of ["Rename", "Move to Trash", "Duplicate"]) {
    await expect(page.getByRole("menuitem", { name: item })).toHaveCount(0);
  }
  await page.keyboard.press("Escape");

  // A drawing with 10,000 elements opens, accepts an edit and saves it.
  await page.goto("/e2e.html?scene=big10k");
  await enterVault(page);
  await row(page, "Big").locator(".vault-tree-item__toggle").click();
  const t0 = Date.now();
  await row(page, "Big/Big10k.excalidraw")
    .locator(".vault-tree-item__name")
    .click();
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  await expect(page.locator(".vault-editor")).toHaveAttribute(
    "data-scene-ready",
    "true",
    {
      timeout: 20_000,
    },
  );
  expect(Date.now() - t0).toBeLessThan(20_000);
  const count = () =>
    page.evaluate(
      () =>
        (window as any).__editorApis()[0].getSceneElements().length as number,
    );
  expect(await count()).toBe(10_000);
  const big = (await page
    .locator(".vault-editor canvas.interactive")
    .boundingBox())!;
  await page.locator(".vault-editor [data-testid='toolbar-rectangle']").click();
  await page.mouse.move(big.x + 700, big.y + 500);
  await page.mouse.down();
  await page.mouse.move(big.x + 780, big.y + 560, { steps: 4 });
  await page.mouse.up();
  await expect.poll(count).toBe(10_001);
  await expect
    .poll(
      async () =>
        JSON.parse((await readFake(page, "Big/Big10k.excalidraw"))!).elements
          .length,
    )
    .toBe(10_001);
  // Renaming it while open keeps all of it.
  expect(
    await renameVia(page, row(page, "Big/Big10k.excalidraw"), "Big renamed"),
  ).toBeNull();
  await expect
    .poll(() => readFake(page, "Big/Big renamed.excalidraw"))
    .not.toBeNull();
  expect(
    JSON.parse((await readFake(page, "Big/Big renamed.excalidraw"))!).elements,
  ).toHaveLength(10_001);
  expect(errors).toEqual([]);
});

test("a read-only drawing file opens in view mode with a banner, and edits again once it is writable", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  const path = "DSA/Graphs.excalidraw";
  const roBanner = page.getByTestId("read-only-file-banner");
  await page.evaluate(
    (p) => (window as any).__vaultRepo.setFileReadOnly(p, true),
    path,
  );
  await row(page, "DSA").locator(".vault-tree-item__toggle").click();
  await row(page, path).locator(".vault-tree-item__name").click();
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();

  // View mode: the banner explains it and offers Save a copy; a drag draws nothing.
  await expect(roBanner).toContainText(
    "Read-only file: make it writable in Finder",
  );
  await expect(
    roBanner.getByRole("button", { name: "Save a copy" }),
  ).toBeVisible();
  await expect(page.locator(".vault-editor-container--readonly")).toBeVisible();
  const box = (await page
    .locator(".vault-editor canvas.interactive")
    .boundingBox())!;
  const before = await readFake(page, path);
  await page.keyboard.press("r");
  await page.mouse.move(box.x + 500, box.y + 400);
  await page.mouse.down();
  await page.mouse.move(box.x + 600, box.y + 480, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  expect(await readFake(page, path)).toBe(before);
  await expect(
    page.getByRole("alert").filter({ hasText: /failed|error/i }),
  ).toHaveCount(0);

  // The file becomes writable (a chmod the watcher reports): banner and view mode lift.
  await page.evaluate(
    (p) => (window as any).__vaultRepo.setFileReadOnly(p, false),
    path,
  );
  await expect(roBanner).toHaveCount(0);
  await expect(page.locator(".vault-editor-container--readonly")).toHaveCount(
    0,
  );
  await page.locator(".vault-editor [data-testid='toolbar-rectangle']").click();
  await page.mouse.move(box.x + 500, box.y + 400);
  await page.mouse.down();
  await page.mouse.move(box.x + 600, box.y + 480, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => (await readFake(page, path)) !== before)
    .toBe(true);

  // Locked while open: the next save is refused, and the drawing switches to view mode with the
  // banner (and Save a copy) instead of failing on every autosave.
  await page.evaluate(
    (p) => (window as any).__vaultRepo.setFileReadOnly(p, true),
    path,
  );
  await page.locator(".vault-editor [data-testid='toolbar-rectangle']").click();
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 380, box.y + 360, { steps: 5 });
  await page.mouse.up();
  await expect(roBanner).toBeVisible({ timeout: 15_000 });
  await expect(
    roBanner.getByRole("button", { name: "Save a copy" }),
  ).toBeVisible();
  await expect(page.locator(".vault-editor-container--readonly")).toBeVisible();
  expect(errors.filter((e) => !/read-only/i.test(e))).toEqual([]);
});

test("backup: Settings offers back up and restore, and says where the zip went", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?config=1");
  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const d = page.getByRole("dialog");
  await d.getByRole("tab", { name: "General" }).click();
  await d.getByRole("button", { name: "Back up vault…" }).click();
  await expect(
    page.getByText("Backup written: /backups/vault backup 2026-10-28.zip"),
  ).toBeVisible();
  await expect(
    d.getByRole("button", { name: "Restore from backup…" }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// History: checkpoint, restore, a deleted drawing, history off

test("history: checkpoint, restore as a copy, a deleted drawing, history off", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const anchor = rectEl("anc", 0, 0, null, 200, 120, 9);
  const small = rectEl("a", 40, 40, null, 80, 60, 1);
  const json = (els: unknown[]) =>
    JSON.stringify({
      type: "excalidraw",
      version: 2,
      elements: els,
      appState: {},
      files: {},
    });
  await setupHistory(
    page,
    [anchor, small],
    [
      { json: json([anchor]) },
      {
        json: json([anchor, small]),
        partial: { reason: "checkpoint", name: "Ünï ✨ first", note: null },
      },
    ],
  );
  await openPanelByShortcut(page);
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toContainText("Checkpoint: Ünï ✨ first");

  // A new checkpoint through the palette dialog, with an odd name.
  await runPaletteCommand(page, "History: Create checkpoint");
  const cp = page.getByRole("dialog", { name: "Create checkpoint" });
  await cp.getByLabel("Name").fill('Second 🎯 "quoted"');
  await cp.getByRole("button", { name: /Create|Save/ }).click();
  await expect(rows(page).filter({ hasText: "Second 🎯" })).toHaveCount(1);

  // Restore the oldest version as a copy: the original is untouched, the copy exists and has its content.
  const original = await readFake(page, GRAPHS);
  await rows(page).last().click();
  await page.getByTestId("history-restore").click();
  await page
    .getByRole("dialog", { name: /^Restore / })
    .getByRole("button", { name: "Restore as a copy" })
    .click();
  await expect(
    page
      .locator(".vd-toast")
      .filter({ hasText: "Restored as Graphs (restored" }),
  ).toHaveCount(1);
  expect(await readFake(page, GRAPHS)).toBe(original);
  const copyPath = (await allPaths(page)).find((p) =>
    p.startsWith("DSA/Graphs (restored"),
  )!;
  expect(copyPath).toBeTruthy();
  expect(
    JSON.parse((await readFake(page, copyPath))!).elements.map(
      (e: any) => e.id,
    ),
  ).toEqual(["anc"]);

  // The drawing is deleted outside the app while open: History can still restore it as a copy.
  await page.evaluate(
    (p) => (window as any).__vaultRepo.externalDelete(p),
    GRAPHS,
  );
  await expect.poll(() => readFake(page, GRAPHS)).toBeNull();
  await rows(page).filter({ hasText: "Ünï ✨ first" }).click();
  await page.getByTestId("history-restore").click();
  const restoreDialog = page.getByRole("dialog", { name: /^Restore / });
  await expect(restoreDialog).toBeVisible();
  const replace = restoreDialog.getByRole("button", {
    name: "Replace current drawing",
  });
  if ((await replace.count()) > 0) {
    await expect(replace).toBeDisabled();
  }
  await restoreDialog
    .getByRole("button", { name: "Restore as a copy" })
    .click();
  await expect
    .poll(
      async () =>
        (
          await allPaths(page)
        ).filter((p) => p.startsWith("DSA/Graphs (restored")).length,
    )
    .toBe(2);
  expect(errors).toEqual([]);
});

test("history off: the setting stops new versions and the panel says so", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const anchor = rectEl("anc", 0, 0, null, 200, 120, 9);
  await setupHistory(page, [anchor], []);
  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const d = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("tab", { name: "History" }) });
  await d.getByRole("tab", { name: "History" }).click();
  const kill = d
    .locator('[data-setting-id="history-enabled"]')
    .getByRole("switch", { name: "Enable history" });
  await expect(kill).toBeChecked();
  await kill.click();
  await expect(kill).not.toBeChecked();
  await d.getByRole("button", { name: "Close Settings" }).click();
  const countBefore = await page.evaluate(
    (p) => (window as any).__historyRepo.allVersions(p).length as number,
    GRAPHS,
  );
  // Edit and save: no version is added.
  const box = (await page
    .locator(".vault-editor canvas.interactive")
    .boundingBox())!;
  await page.locator(".vault-editor [data-testid='toolbar-rectangle']").click();
  await page.mouse.move(box.x + 500, box.y + 400);
  await page.mouse.down();
  await page.mouse.move(box.x + 580, box.y + 460, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(
      async () => JSON.parse((await readFake(page, GRAPHS))!).elements.length,
    )
    .toBeGreaterThan(1);
  await page.waitForTimeout(500);
  expect(
    await page.evaluate(
      (p) => (window as any).__historyRepo.allVersions(p).length as number,
      GRAPHS,
    ),
  ).toBe(countBefore);
  await openPanelByShortcut(page);
  await expect(panel(page)).toBeVisible();
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// Search, favourites, library

const textScene = (...texts: string[]) =>
  sceneJson(
    [],
    texts.map((t, i) => textEl(`s${i}`, t, i * 40)),
  );

test("search: names, text, accents, emoji, odd characters, tags, and a deleted drawing", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?seed=empty");
  await seedDrawings(page, {
    "Alpha plan.excalidraw": textScene(
      "quarterly roadmap",
      "colour #ff00aa and https://x.io/p#frag",
    ),
    "Ünïcödé résumé.excalidraw": textScene("Crème brûlée recipe"),
    "Emoji/Party 🎉.excalidraw": textScene("🎨 palette", "tag me #proj/alpha"),
    "Odd.excalidraw": textScene("cost is a(b)*[c] + d?"),
    "Notes dir/Other.excalidraw": textScene("another #proj/beta thing"),
  });
  await rescan(page);
  await expect(rowByName(page, "Alpha plan")).toBeVisible();
  const box = page.getByPlaceholder(/^Search drawings and text…/);
  const drawingRows = page.locator('.vault-search-row[data-kind="drawing"]');
  const names = () => drawingRows.allInnerTexts();
  const find = async (q: string, expected: string[]) => {
    await box.fill(q);
    await expect
      .poll(async () =>
        (await names()).map((n) => n.split("\n")[0].trim()).sort(),
      )
      .toEqual(expected.sort());
  };

  await find("roadmap", ["Alpha plan"]); // text
  await find("ALPHA", ["Alpha plan"]); // a name, any case
  await find("brulee", ["Ünïcödé résumé"]); // accent-insensitive
  await find("unicode resume", ["Ünïcödé résumé"]); // two terms, one in the name
  await find("palette", ["Party 🎉"]); // emoji drawing, text next to it
  await find("🎉", ["Party 🎉"]); // an emoji in the query
  await find("a(b)*[c]", ["Odd"]); // regex characters are literal
  await find("\\", []); // a lone backslash: no crash, no results
  await find("x".repeat(500), []); // a very long query
  await find("   ", []); // only spaces: nothing, no error
  await find("tag:#proj", ["Party 🎉", "Other"]); // a tag and its children
  await find("tag:#proj/beta", ["Other"]);
  await find("tag:#frag", []); // a URL fragment is not a tag
  await find("tag:#ff00aa", []); // a colour is not a tag
  await find("zzz-nothing", []);
  await expect(
    page.getByText(/no (results|matches)|nothing found/i).first(),
  ).toBeVisible();

  // A deleted drawing leaves the results.
  await box.fill("");
  await trashVia(page, rowByName(page, "Odd"));
  await expect.poll(() => readFake(page, "Odd.excalidraw")).toBeNull();
  await page.evaluate(() =>
    (window as any).__vaultSearch.setIndexState(
      null,
      (window as any).__vaultRepo.handle,
    ),
  );
  await find("a(b)*[c]", []);
  // Escape clears the query and the tree is back.
  await page.keyboard.press("Escape");
  await expect(box).toHaveValue("");
  await expect(rowByName(page, "Alpha plan")).toBeVisible();
  expect(errors).toEqual([]);
});

test("favourites follow a rename and drop a deleted drawing", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?seed=search");
  await rowByName(page, "DSA").locator(".vault-tree-item__name").click();
  await rowByName(page, "Graphs").locator(".vault-tree-item__name").click();
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  const fav = async (name: string) => {
    await rowByName(page, name)
      .locator(".vault-tree-item__name")
      .click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Favourite: add or remove" })
      .click();
  };
  await fav("Graphs");
  await fav("Shortest Paths");
  await page.getByTestId("activity-bar-favourites.list").click();
  const rowsF = page.getByTestId("favourite-row");
  await expect(rowsF).toHaveCount(2);
  // Toggling again removes; toggling once more brings it back at the end.
  await fav("Graphs");
  await expect(rowsF).toHaveCount(1);
  await fav("Graphs");
  await expect(rowsF).toHaveCount(2);
  await expect(rowsF.nth(1)).toContainText("Graphs");

  // Rename: the favourite keeps pointing at the same drawing.
  expect(
    await renameVia(page, rowByName(page, "Graphs"), "Graphs ✨ v2"),
  ).toBeNull();
  await expect(rowsF.filter({ hasText: "Graphs ✨ v2" })).toHaveCount(1);
  await expect(rowsF.filter({ hasText: /^Graphs$/ })).toHaveCount(0);
  // Delete: the row goes.
  await trashVia(page, rowByName(page, "Shortest Paths"));
  await expect(rowsF).toHaveCount(1);
  // A click opens the renamed drawing.
  await rowsF
    .first()
    .getByRole("button", { name: /Graphs ✨ v2/ })
    .first()
    .click();
  await expect(
    page.locator(".vault-breadcrumbs__item--active", {
      hasText: "Graphs ✨ v2",
    }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("library: sections, adding a selection by name, counts per section", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  await rowByName(page, "DSA").locator(".vault-tree-item__name").click();
  await rowByName(page, "Graphs").locator(".vault-tree-item__name").click();
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  const box = (await page
    .locator(".vault-editor canvas.interactive")
    .boundingBox())!;
  await page.locator(".vault-editor [data-testid='toolbar-rectangle']").click();
  await page.mouse.move(box.x + 300, box.y + 400);
  await page.mouse.down();
  await page.mouse.move(box.x + 380, box.y + 460, { steps: 4 });
  await page.mouse.up(); // the new rectangle stays selected
  await page.locator(".default-sidebar-trigger").first().click();
  await expect(page.getByTestId("library-section-personal")).toHaveText(
    "Personal",
  );
  await expect(page.getByTestId("library-section-vault")).toBeVisible();
  const grid = (id: string) =>
    page
      .getByTestId(`library-section-${id}`)
      .locator("xpath=following-sibling::*[1]");
  const count = (scope: "personal" | "vault") =>
    page.evaluate((s) => {
      const lib = (window as any).__libraryRepo;
      const raw = lib.getJson(
        s,
        s === "vault" ? (window as any).__vaultRepo.handle : undefined,
      );
      return raw ? (JSON.parse(raw).libraryItems.length as number) : 0;
    }, scope);
  expect(await count("personal")).toBe(0);
  expect(await count("vault")).toBe(0);
  await grid("vault").locator(".library-unit__adder").click({ force: true });
  const input = grid("vault").getByTestId("library-item-name-input");
  await input.fill("Ünï box 📦");
  await input.press("Enter");
  await expect.poll(() => count("vault")).toBe(1);
  expect(await count("personal")).toBe(0);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// Save flows: quitting with open notes, typing during a move

const requestQuit = (page: Page) =>
  page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("vaultdraw:quit-request")),
  );

const withNotesAutosave = (page: Page, ms: number) =>
  page.addInitScript((value) => {
    localStorage.setItem(
      "excalidraw-vault-preferences-v1",
      JSON.stringify({ notesAutosaveMs: value }),
    );
  }, ms);

const typeInNote = async (page: Page, text: string) => {
  await rowByName(page, "Ideas").locator(".vault-tree-item__name").click();
  await page.getByRole("button", { name: "Edit note" }).click();
  await page.getByTestId("note-editor").locator(".cm-content").click();
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.type(text);
};

test("quit: an open note with typing not yet autosaved is written, with no prompt", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await withNotesAutosave(page, 60_000);
  await openVault(page, "?seed=obsidian");
  await rescan(page);
  const nf = noteFiles(page);
  await typeInNote(page, "\nunsaved before quit");
  await expect(status(page)).toHaveAttribute("data-status", "dirty");
  expect(await nf.text("Ideas.md")).not.toContain("unsaved before quit");
  await requestQuit(page);
  await expect.poll(() => nf.text("Ideas.md")).toContain("unsaved before quit");
  await expect(dialog(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("quit with notes autosave off: Cancel keeps it open, Save and Close writes it", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await withNotesAutosave(page, 0);
  await openVault(page, "?seed=obsidian");
  await rescan(page);
  const nf = noteFiles(page);
  await typeInNote(page, "\nkept by the prompt");
  await requestQuit(page);
  const d = dialog(page);
  await expect(d).toContainText("Unsaved notes");
  await expect(d).toContainText("'Ideas.md'");
  // Cancel keeps the window open and writes nothing.
  await d.getByRole("button", { name: "Cancel" }).click();
  await expect(d).toHaveCount(0);
  expect(await nf.text("Ideas.md")).not.toContain("kept by the prompt");
  // Save and Close writes the note.
  await requestQuit(page);
  await d.getByRole("button", { name: "Save and Close" }).click();
  await expect.poll(() => nf.text("Ideas.md")).toContain("kept by the prompt");
  expect(errors).toEqual([]);
});

test("quit with notes autosave off: Don't Save closes and writes nothing", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await withNotesAutosave(page, 0);
  await openVault(page, "?seed=obsidian");
  await rescan(page);
  const nf = noteFiles(page);
  await typeInNote(page, "\nthrown away");
  await requestQuit(page);
  await dialog(page).getByRole("button", { name: "Don't Save" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(await nf.text("Ideas.md")).not.toContain("thrown away");
  expect(errors).toEqual([]);
});
