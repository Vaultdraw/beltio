import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { AFTER_AUTOSAVE_MS } from "./constants";
import { openDrawing, readScene, trackErrors } from "./helpers";
import {
  openTagsVault,
  paneTagNames,
  searchBox,
  tagRow,
  tagsPanel,
} from "./tagsHelpers";

const textEl = (id: string, text: string) => ({
  id,
  type: "text",
  x: 0,
  y: 0,
  width: 200,
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
  roundness: null,
  link: null,
  locked: false,
  isDeleted: false,
  text,
  originalText: text,
  fontSize: 20,
  fontFamily: 1,
  textAlign: "left",
  verticalAlign: "top",
  containerId: null,
  lineHeight: 1.25,
});

const dialog = (page: Page) => page.getByRole("dialog", { name: "Rename tag" });
const texts = async (page: Page, path: string) =>
  (await readScene(page, path)).elements.map((e: any) => e.originalText);
const refreshIndex = (page: Page) =>
  page.evaluate(() =>
    (window as any).__vaultSearch.setIndexState(
      null,
      (window as any).__vaultRepo.handle,
    ),
  );

test.beforeEach(async ({ page }) => {
  await openTagsVault(page, "?seed=tags&tagrename=1");
  // A look-alike tag and a second carrier of the child tag, on disk only.
  await page.evaluate((el) => {
    (window as any).__vaultRepo.seedDrawing(
      "DSA/Other.excalidraw",
      JSON.stringify({
        type: "excalidraw",
        version: 2,
        elements: [el],
        appState: {},
        files: {},
      }),
    );
  }, textEl("o1", "later #dsa2 and #dsa/graphs"));
  await refreshIndex(page);
  await expect(tagRow(page, "dsa2")).toBeVisible();
});

const startRename = async (page: Page, tag: string) => {
  await tagRow(page, tag).hover();
  await tagsPanel(page)
    .getByRole("button", { name: `Rename tag ${tag}…`, exact: true })
    .click();
  await expect(dialog(page)).toBeVisible();
};

test("renaming a parent tag renames children, the open drawing (undoable) and closed drawings", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openDrawing(page, "Tagged Graphs");
  await startRename(page, "dsa");
  await dialog(page).getByLabel("New tag").fill("algo");
  const plan = dialog(page).getByTestId("rename-tag-plan");
  await expect(plan).toContainText("occurrences");
  await expect(plan).toContainText("#dsa/graphs → #algo/graphs");
  await dialog(page).getByRole("button", { name: "Rename" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(
    page
      .getByRole("region", { name: "Notifications" })
      .filter({ hasText: "Renamed #dsa to #algo in 3 drawings" }),
  ).toBeVisible();

  // Closed drawings were rewritten on disk; #dsa2 is untouched.
  await expect
    .poll(() => texts(page, "DSA/Tagged Arrays.excalidraw"))
    .toEqual(["two pointers #algo"]);
  expect(await texts(page, "DSA/Other.excalidraw")).toEqual([
    "later #dsa2 and #algo/graphs",
  ]);
  // The open drawing changed through the editor and is saved.
  await page.waitForTimeout(AFTER_AUTOSAVE_MS);
  await expect
    .poll(() => texts(page, "DSA/Tagged Graphs.excalidraw"))
    .toEqual(["BFS traversal #algo/graphs", "mock round #Interview"]);

  // Pane counts follow after the index refresh.
  await refreshIndex(page);
  await expect(tagRow(page, "algo")).toHaveAttribute(
    "aria-label",
    "Tag algo, 3 drawings",
  );
  await expect(tagRow(page, "algo/graphs")).toBeVisible();
  await expect(tagRow(page, "dsa2")).toBeVisible();
  await expect(tagRow(page, "dsa")).toHaveCount(0);
  expect(await paneTagNames(page)).not.toContain("dsa");

  // Undo reverts the open drawing only.
  const canvas = page.locator(".vault-editor canvas.interactive");
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width - 40, box.y + box.height - 40);
  await page.keyboard.press("Meta+z");
  await page.waitForTimeout(AFTER_AUTOSAVE_MS);
  await expect
    .poll(() => texts(page, "DSA/Tagged Graphs.excalidraw"))
    .toEqual(["BFS traversal #dsa/graphs", "mock round #Interview"]);
  expect(errors).toEqual([]);
});

test("renaming onto an existing tag warns about the merge", async ({
  page,
}) => {
  await startRename(page, "dsa");
  await dialog(page).getByLabel("New tag").fill("Interview");
  await expect(dialog(page).getByRole("alert")).toContainText(
    "Merges with existing #interview",
  );
});

test("an invalid tag keeps the dialog open and blocks Rename", async ({
  page,
}) => {
  await startRename(page, "dsa");
  const input = dialog(page).getByLabel("New tag");
  await input.fill("9 !");
  await expect(dialog(page)).toContainText("Not a valid tag");
  await expect(
    dialog(page).getByRole("button", { name: "Rename" }),
  ).toBeDisabled();
  await input.press("Enter");
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(searchBox(page)).toHaveValue("");
});

test("r renames from the keyboard; the Tags commands are in the palette and on the Hotkeys page", async ({
  page,
}) => {
  await page.getByRole("tree", { name: "Tag list" }).focus();
  await page.keyboard.press("r");
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByLabel("New tag")).toHaveValue("dsa");
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);

  await page.keyboard.press("Meta+Shift+KeyP");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill(">Tags:");
  for (const title of [
    /Tags: Rename tag/,
    /Tags: Focus tags pane/,
    /Tags: Toggle sort/,
  ]) {
    await expect(palette.getByRole("option", { name: title })).toBeVisible();
  }
  await page.keyboard.press("Escape");

  await page.keyboard.press("Meta+Comma");
  await page.getByRole("tab", { name: "Hotkeys" }).click();
  for (const id of ["tags.rename", "tags.focusPane", "tags.toggleSort"]) {
    await expect(
      page.locator(`.vault-hotkeys__row[data-command-id="${id}"]`),
    ).toBeVisible();
  }
});
