import { expect, test, type Page } from "@playwright/test";

import { canvasBox, openDrawing, openVault, trackErrors } from "./helpers";

const DRAWING = "DSA/Graphs.excalidraw";

const rect = (i: number) => ({
  id: `r${i}`,
  type: "rectangle",
  x: 20 + (i % 10) * 90,
  y: 20 + Math.floor(i / 10) * 70,
  width: 80,
  height: 60,
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
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
  seed: 1000 + i,
  version: 1,
  versionNonce: 2000 + i,
  index: null,
  updated: 1,
});

/** A drawing well above the shrink rule's 4 KB floor. */
const seedBigDrawing = (page: Page) =>
  page.evaluate(
    (elements) => {
      (window as any).__vaultRepo.seedDrawing(
        "DSA/Graphs.excalidraw",
        JSON.stringify({
          type: "excalidraw",
          version: 2,
          elements,
          appState: {},
          files: {},
        }),
      );
    },
    Array.from({ length: 40 }, (_, i) => rect(i)),
  );

const historyCalls = (page: Page) =>
  page.evaluate(() => [...(window as any).__historyRepo.calls] as string[]);

const writeCount = (page: Page) =>
  page.evaluate(() => (window as any).__vaultRepo.writeCalls.length as number);

const drawRectangle = async (page: Page) => {
  const box = await canvasBox(page);
  await page.locator(".vault-editor [data-testid='toolbar-rectangle']").click();
  const x0 = box.x + box.width * 0.3;
  const y0 = box.y + box.height * 0.6;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 60, y0 + 40, { steps: 5 });
  await page.mouse.move(x0 + 140, y0 + 90, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("1");
};

/** Waits for the next committed save (editor idle serialize + autosave). */
const nextSave = async (page: Page, action: () => Promise<void>) => {
  const before = await writeCount(page);
  await action();
  await expect
    .poll(() => writeCount(page), { timeout: 8000 })
    .toBeGreaterThan(before);
};

const panel = (page: Page) =>
  page.getByRole("complementary", { name: "History" });

test.beforeEach(async ({ page }) => {
  await openVault(page);
  await seedBigDrawing(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
});

test("Cmd+Option+S asks for a name and lists the checkpoint in the panel", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.locator(".vault-editor canvas.interactive").click({
    position: { x: 700, y: 600 },
  });
  await page.keyboard.press("Meta+Alt+KeyS");
  const dialog = page.getByRole("dialog", { name: "Create checkpoint" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Name")).toBeFocused();
  await dialog.getByLabel("Name").fill("Before the big change");
  await dialog.getByLabel("Note (optional)").fill("sketch is final");
  await dialog.getByLabel("Name").press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".vd-toast")).toContainText(
    "Checkpoint saved: Before the big change",
  );

  await page.keyboard.press("Meta+Shift+KeyH");
  await expect(panel(page)).toBeVisible();
  const row = panel(page).getByRole("listitem");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Checkpoint: Before the big change");
  await expect(row).toContainText("sketch is final");
  await expect(panel(page).getByTestId("history-last")).toContainText(
    "Last version: just now",
  );

  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Escape cancels the checkpoint dialog without a version", async ({
  page,
}) => {
  await page.keyboard.press("Meta+Alt+KeyS");
  const dialog = page.getByRole("dialog", { name: "Create checkpoint" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(await historyCalls(page)).not.toContain("checkpoint");
});

test("clearing the canvas (Cmd+Delete) leaves a Before clear canvas version", async ({
  page,
}) => {
  const errors = trackErrors(page);
  // One committed save first, so the previous state is known to history.
  await nextSave(page, () => drawRectangle(page));
  await nextSave(page, async () => {
    await page.keyboard.press("Meta+Delete");
    await page.getByRole("button", { name: "Confirm" }).click();
  });

  await page.keyboard.press("Meta+Shift+KeyH");
  await expect(panel(page)).toBeVisible();
  const rows = panel(page).getByRole("listitem");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Before clear canvas");
  expect(errors).toEqual([]);
});

test("the palette lists the History commands", async ({ page }) => {
  await page.keyboard.press("Meta+Shift+KeyP");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill(">History:");
  const options = palette.getByRole("option");
  await expect(
    options.filter({ hasText: "History: Create checkpoint" }),
  ).toHaveCount(1);
  await expect(
    options.filter({ hasText: "History: Show or hide history" }),
  ).toHaveCount(1);
  await expect(options.filter({ hasText: "History: Time travel" })).toHaveCount(
    1,
  );
  // Not bound yet (H2/H3): never offered as a no-op.
  await expect(options.filter({ hasText: "Restore" })).toHaveCount(0);
});

test("the palette runs Time travel and opens the panel", async ({ page }) => {
  await page.keyboard.press("Meta+Shift+KeyP");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill(">History: Time travel");
  await page.keyboard.press("Enter");
  await expect(panel(page)).toBeVisible();
});

test("autosave makes no history calls", async ({ page }) => {
  const before = await historyCalls(page);
  expect(before).toContain("configure");
  expect(before).toContain("opened");
  for (let i = 0; i < 3; i++) {
    await nextSave(page, () => drawRectangle(page));
  }
  expect(await historyCalls(page)).toEqual(before);
});

test("switching drawings reports opened and leaves a version of the edited one", async ({
  page,
}) => {
  await nextSave(page, () => drawRectangle(page));
  await page
    .locator(".vault-tree-item__name", { hasText: "Dynamic Programming" })
    .first()
    .click();
  await page
    .locator(".vault-tree-item__name", { hasText: "01 Introduction" })
    .first()
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__historyRepo.openedLog.map((o: any) => o.path),
      ),
    )
    .toEqual([DRAWING, "DSA/Dynamic Programming/01 Introduction.excalidraw"]);
  const reasons = await page.evaluate(() =>
    (window as any).__historyRepo
      .allVersions("DSA/Graphs.excalidraw")
      .map((v: any) => v.reason),
  );
  expect(reasons).toEqual(["leave"]);
});
