import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openDrawing, openVault, readScene, trackErrors } from "./helpers";
import { TEMPLATE_BACKGROUNDS } from "./templateFixtures";

const PREFS_KEY = "excalidraw-vault-preferences-v1";
const SEEDED = "?seed=templates";

const picker = (page: Page) =>
  page.getByRole("dialog", { name: "New drawing from template" });
const rows = (page: Page) => picker(page).locator(".template-picker__row");
const rowNames = (page: Page) =>
  picker(page).locator(".template-picker__name").allTextContents();

const openPicker = async (page: Page) => {
  await page.keyboard.press("Control+Alt+N");
  await expect(picker(page)).toBeVisible();
  await expect(rows(page).first()).toBeVisible();
};

/** Paths of every drawing currently in the in-memory vault. */
const vaultFiles = (page: Page) =>
  page.evaluate(
    () => [...(window as any).__vaultRepo.files.keys()] as string[],
  );

/** Waits for a new drawing whose file name starts with `prefix` (not in Templates/). */
const waitForCreated = async (page: Page, prefix: string) => {
  let found = "";
  await expect
    .poll(async () => {
      found =
        (await vaultFiles(page)).find(
          (p) => !p.startsWith("Templates/") && p.includes(prefix),
        ) ?? "";
      return found;
    })
    .not.toBe("");
  return found;
};

const seedPreferences = (page: Page, prefs: Record<string, unknown>) =>
  page.addInitScript(
    ([key, value]) => {
      if (!window.sessionStorage.getItem("tpl-seeded")) {
        window.localStorage.setItem(key as string, JSON.stringify(value));
        window.sessionStorage.setItem("tpl-seeded", "1");
      }
    },
    [PREFS_KEY, prefs] as const,
  );

const moreActions = async (page: Page, name: string, item: string) => {
  const row = page
    .locator(".vault-tree-item")
    .filter({
      has: page.locator(".vault-tree-item__name", {
        hasText: new RegExp(`^${name}$`),
      }),
    })
    .first();
  await row.hover();
  await row.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: item }).click();
};

const expandDsa = async (page: Page) => {
  const toggle = page
    .locator(".vault-tree-item")
    .filter({
      has: page.locator(".vault-tree-item__name", { hasText: /^DSA$/ }),
    })
    .first()
    .locator(".vault-tree-item__toggle");
  if ((await toggle.getAttribute("aria-label")) === "Expand") {
    await toggle.click();
  }
};

test("picker lists Blank drawing and templates sorted, in the vault group", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, SEEDED);
  await openPicker(page);
  expect(await rowNames(page)).toEqual([
    "Blank drawing",
    "Flowchart",
    "Kanban Board",
    "Lecture Notes",
  ]);
  await expect(picker(page).locator(".template-picker__group")).toHaveText([
    "This vault (Templates/)",
  ]);
  await expect(rows(page).first()).toHaveAttribute("aria-selected", "true");
  expect(errors).toEqual([]);
});

test("typing filters; Enter creates a drawing with new ids, same content and canvas background", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, SEEDED);
  await openPicker(page);
  await picker(page).getByRole("combobox").fill("lectur");
  // Filtering hides the Blank row and ranks the match first.
  await expect(rows(page)).toHaveCount(1);
  expect(await rowNames(page)).toEqual(["Lecture Notes"]);
  await page.keyboard.press("Enter");
  await expect(picker(page)).toHaveCount(0);

  const created = await waitForCreated(page, "Lecture Notes.");
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();

  const scene = await readScene(page, created);
  const template = await readScene(page, "Templates/Lecture Notes.excalidraw");
  expect(scene.elements).toHaveLength(template.elements.length);
  expect(scene.elements.map((e: any) => e.type)).toEqual(
    template.elements.map((e: any) => e.type),
  );
  const oldIds = new Set(template.elements.map((e: any) => e.id));
  for (const el of scene.elements) {
    expect(oldIds.has(el.id)).toBe(false);
  }
  // References were remapped consistently, not dropped.
  const [rect, text, arrow] = scene.elements;
  expect(text.containerId).toBe(rect.id);
  expect(arrow.startBinding.elementId).toBe(rect.id);
  expect(rect.boundElements.map((b: any) => b.id).sort()).toEqual(
    [text.id, arrow.id].sort(),
  );
  expect(rect.groupIds).toHaveLength(1);
  expect(rect.groupIds[0]).not.toBe(template.elements[0].groupIds[0]);
  expect(text.groupIds).toEqual(rect.groupIds);
  // Same shape content.
  expect(rect.backgroundColor).toBe("#a5d8ff");
  expect(rect.width).toBe(200);
  expect(text.text).toBe("LectureNotes");
  expect(scene.appState.viewBackgroundColor).toBe(
    TEMPLATE_BACKGROUNDS["Lecture Notes"],
  );
  // The template itself is untouched.
  expect(template.elements[0].id).toBe("rect-LectureNotes");
  expect(errors).toEqual([]);
});

test("arrow keys move the selection; Enter uses the active row", async ({
  page,
}) => {
  await openVault(page, SEEDED);
  await openPicker(page);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(rows(page).nth(2)).toHaveAttribute("aria-selected", "true");
  await expect(rows(page).nth(2)).toContainText("Kanban Board");
  await page.keyboard.press("ArrowUp");
  await expect(rows(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const created = await waitForCreated(page, "Kanban Board.");
  const scene = await readScene(page, created);
  expect(scene.appState.viewBackgroundColor).toBe(
    TEMPLATE_BACKGROUNDS["Kanban Board"],
  );
});

test("the picker also opens from the empty-state button and while a drawing is open", async ({
  page,
}) => {
  await openVault(page, SEEDED);
  await page.getByRole("button", { name: "New from template…" }).click();
  await expect(picker(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker(page)).toHaveCount(0);

  await expandDsa(page);
  await openDrawing(page, "Graphs");
  await page.locator(".vault-editor canvas.interactive").click();
  await openPicker(page);
  await expect(rows(page)).toHaveCount(4);
});

test("Escape and backdrop click close the picker without creating anything", async ({
  page,
}) => {
  await openVault(page, SEEDED);
  const before = await vaultFiles(page);
  await openPicker(page);
  await page.keyboard.press("Escape");
  await expect(picker(page)).toHaveCount(0);
  await openPicker(page);
  await page.mouse.click(5, 5);
  await expect(picker(page)).toHaveCount(0);
  expect(await vaultFiles(page)).toEqual(before);
});

test("no-match query shows an empty message; Enter does nothing", async ({
  page,
}) => {
  await openVault(page, SEEDED);
  const before = await vaultFiles(page);
  await openPicker(page);
  await picker(page).getByRole("combobox").fill("zzzzqq");
  await expect(picker(page)).toContainText("No templates match");
  await page.keyboard.press("Enter");
  await expect(picker(page)).toBeVisible();
  expect(await vaultFiles(page)).toEqual(before);
});

test("Blank drawing row creates a plain new drawing", async ({ page }) => {
  await openVault(page, SEEDED);
  await openPicker(page);
  await rows(page).first().click();
  await expect(picker(page)).toHaveCount(0);
  const created = await waitForCreated(page, "Untitled.");
  const scene = await readScene(page, created);
  expect(scene.elements).toHaveLength(0);
});

test("templates are excluded from the Recent list", async ({ page }) => {
  await openVault(page, SEEDED);
  const recent = page.getByRole("region", { name: "Recent drawings" });
  // 2 DSA drawings + "Sprint Retro" (Custom Tpl/ is not the templates folder).
  await expect(recent.getByRole("button")).toHaveCount(3);
  for (const name of Object.keys(TEMPLATE_BACKGROUNDS)) {
    await expect(recent).not.toContainText(name);
  }
});

test("Save as template via the row menu adds it to This vault and the picker", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page); // no seeded templates: starts without a Templates folder
  await openPicker(page);
  await expect(picker(page)).toContainText("No templates yet");
  // Blank row is still offered when there are no templates.
  await expect(rows(page)).toHaveCount(1);
  await page.keyboard.press("Escape");

  await expandDsa(page);
  await moreActions(page, "Graphs", "Save as template…");
  const modal = page.getByRole("dialog", { name: "Save as template" });
  await expect(modal).toBeVisible();
  await expect(modal.getByLabel("Template name")).toHaveValue("Graphs");
  await expect(modal.getByLabel("This vault")).toBeChecked();
  await modal.getByRole("button", { name: "Save" }).click();
  await expect(modal).toHaveCount(0);

  expect(await vaultFiles(page)).toContain("Templates/Graphs.excalidraw");
  await openPicker(page);
  expect(await rowNames(page)).toEqual(["Blank drawing", "Graphs"]);

  // A second save under the same name gets a free name instead of failing.
  await page.keyboard.press("Escape");
  await moreActions(page, "Graphs", "Save as template…");
  await modal.getByRole("button", { name: "Save" }).click();
  await expect(modal).toHaveCount(0);
  expect(await vaultFiles(page)).toContain("Templates/Graphs 2.excalidraw");

  // The saved template is a copy whose content matches the source.
  const source = await readScene(page, "DSA/Graphs.excalidraw");
  const copy = await readScene(page, "Templates/Graphs.excalidraw");
  expect(copy.elements).toEqual(source.elements);
  expect(errors).toEqual([]);
});

test("a global template saved for All vaults appears in the All vaults group", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, SEEDED);
  await expandDsa(page);
  await moreActions(page, "Graphs", "Save as template…");
  const modal = page.getByRole("dialog", { name: "Save as template" });
  await modal.getByLabel("Template name").fill("Shared Graph");
  await modal.getByLabel("All vaults (global)").check();
  await modal.getByRole("button", { name: "Save" }).click();
  await expect(modal).toHaveCount(0);
  // Not written into this vault.
  expect(await vaultFiles(page)).not.toContain(
    "Templates/Shared Graph.excalidraw",
  );

  await openPicker(page);
  await expect(picker(page).locator(".template-picker__group")).toHaveText([
    "This vault (Templates/)",
    "All vaults",
  ]);
  expect(await rowNames(page)).toEqual([
    "Blank drawing",
    "Flowchart",
    "Kanban Board",
    "Lecture Notes",
    "Shared Graph",
  ]);
  // The global group is filtered together with the vault group.
  await picker(page).getByRole("combobox").fill("shared");
  expect(await rowNames(page)).toEqual(["Shared Graph"]);
  await page.keyboard.press("Enter");
  const created = await waitForCreated(page, "Shared Graph.");
  const scene = await readScene(page, created);
  const source = await readScene(page, "DSA/Graphs.excalidraw");
  expect(scene.elements).toHaveLength(source.elements.length);
  expect(errors).toEqual([]);
});

test("files.templates_folder lists from the configured folder and hides it from Recent", async ({
  page,
}) => {
  await seedPreferences(page, { templatesFolder: "Custom Tpl" });
  await openVault(page, SEEDED);
  await openPicker(page);
  expect(await rowNames(page)).toEqual(["Blank drawing", "Sprint Retro"]);
  await expect(picker(page).locator(".template-picker__group")).toHaveText([
    "This vault (Custom Tpl/)",
  ]);
  await page.keyboard.press("Escape");
  const recent = page.getByRole("region", { name: "Recent drawings" });
  // 2 DSA drawings + the 3 files in Templates/, which is now an ordinary folder.
  await expect(recent.getByRole("button")).toHaveCount(5);
  await expect(recent).not.toContainText("Sprint Retro");
  await expect(recent).toContainText("Lecture Notes");
});

test("read-only vault: templates listed, no Blank row, creating fails with a message", async ({
  page,
}) => {
  await openVault(page, `${SEEDED}&readonly=1`);
  const before = await vaultFiles(page);
  await page.keyboard.press("Control+Alt+N");
  await expect(picker(page)).toBeVisible();
  await expect(rows(page).first()).toBeVisible();
  expect(await rowNames(page)).toEqual([
    "Flowchart",
    "Kanban Board",
    "Lecture Notes",
  ]);
  await rows(page).first().click();
  await expect(picker(page)).toHaveCount(0);
  await expect(
    page.getByText(/Couldn't create a drawing from the template/),
  ).toBeVisible();
  expect(await vaultFiles(page)).toEqual(before);
});

test("read-only vault: Save as template only offers All vaults", async ({
  page,
}) => {
  await openVault(page, `${SEEDED}&readonly=1`);
  await expandDsa(page);
  await moreActions(page, "Graphs", "Save as template…");
  const modal = page.getByRole("dialog", { name: "Save as template" });
  await expect(modal.getByLabel(/This vault/)).toBeDisabled();
  await expect(modal.getByLabel("All vaults (global)")).toBeChecked();
});
