import { writeFileSync, mkdirSync } from "node:fs";

import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { canvasBox, openVault } from "./helpers";
import { rect, runCommand, seedAndOpen, setupOf } from "./pageHelpers";

// Visual review of page mode (not assertions): PAGE_SHOTS_DIR=<dir> to run.
// Cendre dark and Default light; separate and continuous layouts; the three
// paper themes; the Settings page; a PDF export (bytes saved for rendering).
const DIR = process.env.PAGE_SHOTS_DIR;

test.skip(!DIR, "set PAGE_SHOTS_DIR to capture page mode screenshots");

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${DIR}/${name}.png` });

const settings = async (page: Page) => {
  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
};

const setTheme = async (page: Page, theme: string, mode: "Dark" | "Light") => {
  const dialog = await settings(page);
  await dialog.getByRole("tab", { name: "Appearance" }).click();
  await dialog.getByRole("radio", { name: theme, exact: true }).click();
  await dialog.getByRole("button", { name: mode, exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.waitForTimeout(300);
};

const ellipse = (id: string, x: number, y: number, w: number, h: number) => ({
  ...rect(id, x, y, w, h),
  type: "ellipse",
  strokeColor: "#1971c2",
});

const text = (id: string, x: number, y: number, value: string) => ({
  ...rect(id, x, y, value.length * 12, 25),
  type: "text",
  text: value,
  originalText: value,
  fontSize: 20,
  fontFamily: 5,
  textAlign: "left",
  verticalAlign: "top",
  lineHeight: 1.25,
  containerId: null,
  autoResize: true,
});

const notes = (pageTop: number) => [
  text(`t${pageTop}`, 110, pageTop + 70, "Lecture notes: graphs"),
  rect(`r${pageTop}`, 110, pageTop + 130, 260, 140),
  ellipse(`e${pageTop}`, 430, pageTop + 140, 200, 120),
  text(`u${pageTop}`, 110, pageTop + 320, "BFS visits by layers"),
];

const PITCH = 1123 + 40;
const content = [...notes(0), ...notes(PITCH)];

const scrollDown = async (page: Page, steps: number) => {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(300);
};

for (const [theme, mode, tag] of [
  ["Cendre", "Dark", "cendre-dark"],
  ["Default", "Light", "default-light"],
] as const) {
  test(`page mode ${tag}`, async ({ page }) => {
    await openVault(page);
    await setTheme(page, theme, mode);

    await seedAndOpen(page, `Separate ${tag}.excalidraw`, {
      pageSetup: setupOf({ pageCount: 2 }),
      elements: content,
    });
    await shot(page, `${tag}-separate-normal`);
    await scrollDown(page, 3);
    await shot(page, `${tag}-separate-page-break`);

    await runCommand(page, "Paper theme: Old school");
    await shot(page, `${tag}-separate-old-school`);
    await runCommand(page, "Paper theme: Match current theme");
    await shot(page, `${tag}-separate-match`);

    await seedAndOpen(page, `Continuous ${tag}.excalidraw`, {
      pageSetup: setupOf({ layout: "continuous", pageCount: 2 }),
      elements: content,
      appState: {
        viewBackgroundPattern: {
          type: "grid",
          spacing: 20,
          color: null,
          opacity: 1,
          majorEvery: 5,
          marginLine: false,
        },
      },
    });
    await scrollDown(page, 3);
    await shot(page, `${tag}-continuous-grid`);

    const dialog = await settings(page);
    await dialog.getByRole("tab", { name: "Page" }).click();
    await page.waitForTimeout(300);
    await shot(page, `${tag}-settings-page`);
    await dialog
      .locator('[data-setting-id="page-paper-theme"]')
      .scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await shot(page, `${tag}-settings-page-paper-theme`);
    await page.keyboard.press("Escape");
  });
}

test("PDF export (old school, 2 pages)", async ({ page }) => {
  await openVault(page);
  await seedAndOpen(page, "Pdf.excalidraw", {
    pageSetup: setupOf({ pageCount: 2 }),
    elements: content,
  });
  await runCommand(page, "Paper theme: Old school");
  const count = () =>
    page.evaluate(() => (window as any).__vaultRepo.exported.length as number);
  const before = await count();
  await runCommand(page, "Export: PDF");
  await expect.poll(count, { timeout: 60000 }).toBe(before + 1);
  const bytes = await page.evaluate(() =>
    Array.from((window as any).__vaultRepo.exported.at(-1).bytes as Uint8Array),
  );
  mkdirSync(DIR!, { recursive: true });
  writeFileSync(`${DIR}/export.pdf`, Buffer.from(bytes as number[]));
});
