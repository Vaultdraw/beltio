import { expect, test, type Page } from "@playwright/test";

import {
  canvasBox,
  openVault,
  readScene,
  screenshot,
  SHOTS,
  trackErrors,
} from "../helpers";
import { seedAndOpen } from "../pageHelpers";

// Family: every way a drawing is created starts with the user's paper/theme and
// font settings (toimprove #63: an imported note was a white page in a hand-drawn
// font). Data-driven: one row per creation path; every row is reached through
// visible UI in the dark theme with a non-default drawing font (Nunito, id 6), and
// checks what the user gets: a dark canvas, and the font in the saved file.
// Add a creation path = add a row. See personal/feature/import-theme/FAMILY.md.

const NUNITO = 6;

const NOTE = ["# Plan", "", "A paragraph of plain words.", ""].join("\n");

const settingsDialog = async (page: Page) => {
  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
};

/** Luma of a few static-canvas pixels along the bottom and right edges (empty paper). */
const edgeLuma = (page: Page) =>
  page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>(
      ".vault-editor canvas.static",
    )!;
    const g = c.getContext("2d")!;
    const at = (x: number, y: number) => {
      const d = g.getImageData(x, y, 1, 1).data;
      return 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2];
    };
    return [
      at(c.width - 6, c.height - 6),
      at(Math.floor(c.width * 0.9), c.height - 6),
    ];
  });

type Row = {
  name: string;
  path: string;
  create: (page: Page) => Promise<void>;
  /** Extra checks on the saved file. */
  saved?: (scene: any) => void;
};

const ROWS: Row[] = [
  {
    name: "New drawing (navigator button)",
    path: "Fresh.excalidraw",
    create: async (page) => {
      await page
        .getByLabel("Vault File Navigator")
        .getByRole("button", { name: "New Drawing" })
        .first()
        .click();
      const nd = page.getByRole("dialog");
      await nd.getByLabel("Name").fill("Fresh");
      await nd.getByRole("button", { name: "Create" }).click();
      await expect(nd).toHaveCount(0);
    },
  },
  {
    name: "Markdown import (canvas menu, Import file…)",
    path: "Note (imported).excalidraw",
    create: async (page) => {
      await page.locator(".vault-editor canvas.interactive").click({
        button: "right",
        position: { x: 300, y: 200 },
      });
      const item = page
        .locator(".context-menu")
        .getByRole("button", { name: "Import file…" });
      const chooser = page.waitForEvent("filechooser");
      await item.click();
      await (
        await chooser
      ).setFiles({
        name: "Note.md",
        mimeType: "text/markdown",
        buffer: Buffer.from(NOTE),
      });
    },
    saved: (scene) => {
      const texts = scene.elements.filter(
        (e: any) => e.type === "text" && !e.text.startsWith("zebra"),
      );
      expect(texts.length).toBeGreaterThan(0);
      for (const t of texts) {
        expect(t.fontFamily).toBe(NUNITO);
      }
    },
  },
];

test("every way a drawing is created follows the dark theme and the drawing font", async ({
  page,
}, info) => {
  const errors = trackErrors(page);
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);

  // The user's settings: dark theme, Nunito as the drawing font.
  const dialog = await settingsDialog(page);
  await dialog.getByRole("tab", { name: "Appearance", exact: true }).click();
  await dialog
    .getByRole("group", { name: "Mode" })
    .getByRole("button", { name: "Dark" })
    .click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await dialog.getByRole("tab", { name: "Drawing", exact: true }).click();
  await dialog
    .getByLabel("Default Font Family")
    .selectOption(String(NUNITO));
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // A drawing to start from (the import menu lives on the canvas).
  await seedAndOpen(page, "Start.excalidraw");

  for (const row of ROWS) {
    await test.step(row.name, async () => {
      await row.create(page);
      const tab = page.locator('[data-testid="vault-tab"][data-active="true"]');
      await expect(tab).toHaveAttribute("data-path", row.path, {
        timeout: 20_000,
      });
      await expect(
        page.locator(".vault-editor canvas.interactive"),
      ).toBeVisible();
      // Text typed in it uses the drawing font setting.
      await page.getByTestId("toolbar-text").click();
      const box = await canvasBox(page);
      await page.mouse.click(box.x + 60, box.y + box.height - 80);
      await page.keyboard.type(`zebra ${row.path.length}`);
      await page.keyboard.press("Escape");
      await expect
        .poll(
          async () => {
            const s = await readScene(page, row.path).catch(() => null);
            const t = s?.elements.find(
              (e: any) => e.type === "text" && e.text.startsWith("zebra"),
            );
            return t?.fontFamily ?? null;
          },
          { timeout: 20_000 },
        )
        .toBe(NUNITO);
      await expect(async () => {
        row.saved?.(await readScene(page, row.path));
      }).toPass({ timeout: 20_000 });
      // What the user sees: a dark page, not a white one.
      await expect
        .poll(async () => Math.max(...(await edgeLuma(page))), {
          timeout: 10_000,
        })
        .toBeLessThan(80);
      await screenshot(page, {
        path: `${SHOTS}/${info.project.name}-new-drawing-defaults-${row.path.slice(0, 4)}.png`,
      });
    });
  }
  expect(errors).toEqual([]);
});
