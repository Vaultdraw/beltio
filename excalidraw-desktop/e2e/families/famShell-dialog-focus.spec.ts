import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import { openDrawing, openVault } from "../helpers";
import { runPaletteCommand } from "../historyHelpers";

// Family hunter shell (2026-10-31): "a closed dialog hands focus back to where the user was".
// dialogs.spec.ts says so in its header but asserts frame, Tab trap, Escape and footer only.
// Obsidian, Zed and Neovim keep working where you were after a modal closes: here, after the
// dialog closes with Escape, the next typed letter lands on the drawing (R picks the rectangle
// tool). One row per dialog reachable from the palette, Settings, and the palette itself.
// `document.activeElement` is reported in the failure text only: Excalidraw takes its tool keys
// at the document, so a focus on the page body is not by itself a bug a user can see.

const EMPTY = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "e2e",
  elements: [],
  appState: {},
  files: {},
});

const prepare = async (page: Page) => {
  await openVault(page);
  await page.evaluate(
    (json) => (window as any).__vaultRepo.seedDrawing("Board.excalidraw", json),
    EMPTY,
  );
  await page
    .getByRole("button", { name: /Refresh/i })
    .first()
    .click();
  await openDrawing(page, "Board");
};

const where = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    return {
      isBody: !a || a === document.body || a === document.documentElement,
      inEditor: !!a?.closest(".vault-editor, .excalidraw"),
      tag: a?.tagName ?? "none",
      cls: (a?.className ?? "").toString().slice(0, 60),
    };
  });

const rect = (page: Page) =>
  page.locator(".vault-editor [data-testid='toolbar-rectangle']");

/** The next letter picks the rectangle tool: it landed on the drawing. */
const keyLands = async (page: Page, focus: string) => {
  await expect(
    rect(page),
    `rectangle tool off before: ${focus}`,
  ).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("r");
  await expect(rect(page), focus).toHaveAttribute("aria-pressed", "true");
};

const MEMBERS: { name: RegExp; command: string }[] = [
  { name: /^Paper settings$/, command: "Paper settings…" },
  { name: /^Page setup$/, command: "Page setup…" },
  {
    name: /^Save as template$/,
    command: "Templates: Save drawing as template",
  },
  {
    name: /^New drawing from template$/,
    command: "Templates: New drawing from template",
  },
  { name: /^Rename drawing$/, command: "Rename drawing" },
  { name: /^Move drawing$/, command: "Move drawing" },
];

test.describe("a closed dialog hands focus back", () => {
  for (const m of MEMBERS) {
    test(`${m.name.source}: Escape lets the next key reach the drawing`, async ({
      page,
    }) => {
      await prepare(page);
      await page
        .locator(".vault-editor canvas.interactive")
        .first()
        .click({
          position: { x: 200, y: 200 },
        });
      const before = await where(page);
      await runPaletteCommand(page, m.command);
      const dialog = page.getByRole("dialog", { name: m.name });
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await keyLands(
        page,
        JSON.stringify({ before, after: await where(page) }),
      );
    });
  }

  test("Settings: Escape lets the next key reach the drawing", async ({
    page,
  }) => {
    await prepare(page);
    await page
      .locator(".vault-editor canvas.interactive")
      .first()
      .click({
        position: { x: 200, y: 200 },
      });
    const before = await where(page);
    await runPaletteCommand(page, "Open settings");
    const dialog = page.locator(".vd-settings-scrim");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await keyLands(page, JSON.stringify({ before, after: await where(page) }));
  });

  test("Command palette (Cmd+Shift+P): Escape lets the next key reach the drawing", async ({
    page,
  }) => {
    await prepare(page);
    await page
      .locator(".vault-editor canvas.interactive")
      .first()
      .click({
        position: { x: 200, y: 200 },
      });
    const before = await where(page);
    await page.keyboard.press("Meta+Shift+KeyP");
    const dialog = page.getByRole("dialog", { name: "Command palette" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await keyLands(page, JSON.stringify({ before, after: await where(page) }));
  });
});
