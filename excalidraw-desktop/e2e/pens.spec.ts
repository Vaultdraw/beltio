import { expect, test, type Page } from "@playwright/test";

import {
  canvasBox,
  openDrawing,
  openVault,
  readScene,
  trackErrors,
} from "./helpers";

const DRAWING = "DSA/Graphs.excalidraw";

const live = async (page: Page) =>
  (await readScene(page, DRAWING)).elements.filter((el: any) => !el.isDeleted);

/** Waits for the autosave to contain a stroke matching `pick`. */
const savedStroke = async (page: Page, pick: (el: any) => boolean) => {
  await expect
    .poll(async () => (await live(page)).some(pick), { timeout: 8000 })
    .toBe(true);
  return (await live(page)).find(pick);
};

/** Drags from (fx, fy) by dx, ending dy lower (0: a stroke-like gesture). */
const drag = async (page: Page, fx: number, fy: number, dx: number, dy = 0) => {
  const box = await canvasBox(page);
  const x = box.x + box.width * fx;
  const y = box.y + box.height * fy;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + 30, { steps: 6 });
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
};

const pickFreedraw = (page: Page) =>
  page.locator(".vault-editor [data-testid='toolbar-freedraw']").click();

const pensBar = (page: Page) => page.getByRole("toolbar", { name: "Pens" });

test.beforeEach(async ({ page }) => {
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
});

test("pen bar shows only with the freedraw tool", async ({ page }) => {
  const errors = trackErrors(page);
  await expect(pensBar(page)).toHaveCount(0);
  await pickFreedraw(page);
  await expect(pensBar(page)).toBeVisible();
  await page.locator(".vault-editor [data-testid='toolbar-rectangle']").click();
  await expect(pensBar(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a pen chosen in the bar styles the stroke", async ({ page }) => {
  const errors = trackErrors(page);
  await pickFreedraw(page);
  await pensBar(page).getByRole("button", { name: "Red pen" }).click();
  await expect(
    pensBar(page).getByRole("button", { name: "Red pen" }),
  ).toHaveAttribute("aria-pressed", "true");
  await drag(page, 0.3, 0.8, 160);
  const stroke = await savedStroke(page, (el) => el.type === "freedraw");
  expect(stroke.strokeColor).toBe("#e03131");
  expect(stroke.opacity).toBe(100);
  expect(stroke.strokeWidth).toBeCloseTo(1 / 1.4, 1);
  expect(stroke.strokeOptions).toEqual({
    variability: "constant",
    streamline: 0.4,
  });
  expect(errors).toEqual([]);
});

test("a pen's colour does not leak into the next shape", async ({ page }) => {
  const errors = trackErrors(page);
  const before = new Set((await live(page)).map((el: any) => el.id));
  await pickFreedraw(page);
  await page.keyboard.press("Alt+Digit5");
  await drag(page, 0.3, 0.7, 200);
  await page.locator(".vault-editor [data-testid='toolbar-rectangle']").click();
  await drag(page, 0.3, 0.4, 200, 60);
  const rect = await savedStroke(
    page,
    (el) => !before.has(el.id) && el.type === "rectangle",
  );
  expect(rect.strokeColor).toBe("#1e1e1e");
  expect(rect.opacity).toBe(100);
  expect(errors).toEqual([]);
});

test("Alt+2 selects the marker while drawing", async ({ page }) => {
  const errors = trackErrors(page);
  await pickFreedraw(page);
  await page.keyboard.press("Alt+Digit2");
  await expect(
    pensBar(page).getByRole("button", { name: "Marker" }),
  ).toHaveAttribute("aria-pressed", "true");
  await drag(page, 0.3, 0.85, 160);
  const stroke = await savedStroke(page, (el) => el.type === "freedraw");
  expect(stroke.strokeWidth).toBeCloseTo(2 / 1.4, 1);
  expect(stroke.strokeOptions).toEqual({
    variability: "constant",
    streamline: 0.5,
  });
  expect(errors).toEqual([]);
});

test("highlighter lands beneath the ink and shapes drawn before it", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const before = new Set((await live(page)).map((el: any) => el.id));
  await page.locator(".vault-editor [data-testid='toolbar-rectangle']").click();
  // A zero-height rectangle would be discarded, so end it lower.
  await drag(page, 0.3, 0.5, 200, 60);
  await page.keyboard.press("Escape");
  await pickFreedraw(page);
  await page.keyboard.press("Alt+Digit4");
  await drag(page, 0.3, 0.7, 200);
  await page.keyboard.press("Alt+Digit5");
  await drag(page, 0.3, 0.52, 200);
  const stroke = await savedStroke(
    page,
    (el) => el.type === "freedraw" && el.opacity < 100,
  );
  const elements = await live(page);
  const at = (pick: (el: any) => boolean) => elements.findIndex(pick);
  const mine = (el: any) => !before.has(el.id);
  expect(stroke.strokeColor).toBe("#ffd43b");
  expect(stroke.opacity).toBe(40);
  const highlighter = at((el) => el.id === stroke.id);
  const pen = at(
    (el) => mine(el) && el.type === "freedraw" && el.opacity === 100,
  );
  const rect = at((el) => mine(el) && el.type === "rectangle");
  expect(pen).toBeGreaterThan(highlighter);
  expect(rect).toBeGreaterThan(highlighter);
  expect(errors).toEqual([]);
});

test("the pen bar's settings link opens the Tools page on the Pen section", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await pickFreedraw(page);
  await pensBar(page).getByRole("button", { name: "Pens settings" }).click();
  await expect(page.locator("#settings-title")).toHaveText("Tools");
  await expect(page.getByTestId("tools-pen")).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Pen", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Close Settings" }).click();
  // Opening Settings another way starts on the default page again.
  await page.keyboard.press("Meta+Comma");
  await expect(page.locator("#settings-title")).not.toHaveText("Tools");
  expect(errors).toEqual([]);
});

test("pen keys are rebindable commands listed on the Hotkeys page", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.keyboard.press("Meta+Comma");
  await page.getByRole("tab", { name: "Hotkeys" }).click();
  await expect(
    page.locator('.vault-hotkeys__row[data-command-id="pen.select9"]'),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close Settings" }).click();

  await page.evaluate(() =>
    (window as any).__updatePreferences({
      hotkeys: { "pen.select2": ["Alt+Shift+2"] },
    }),
  );
  // Works from any tool: it switches to freedraw with that pen.
  await page.keyboard.press("Alt+Shift+Digit2");
  const marker = pensBar(page).getByRole("button", { name: "Marker" });
  await expect(marker).toHaveAttribute("aria-pressed", "true");
  await expect(marker).toHaveAttribute("title", /Marker \(.*2\)/);
  expect(errors).toEqual([]);
});
