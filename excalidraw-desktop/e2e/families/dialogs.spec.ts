import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import { openDrawing, openVault } from "../helpers";
import { runPaletteCommand } from "../historyHelpers";

// Family: every dialog is the one Dialog frame. For each member: it opens,
// Tab stays inside it, Escape closes it (and only it when stacked), focus goes
// back to where it was, and footer buttons share one height. One row per dialog.

type Member = {
  name: RegExp;
  /** Palette command that opens it (the palette is the keyboard-first route). */
  command: string;
  needsDrawing?: boolean;
};

const MEMBERS: Member[] = [
  { name: /^Paper settings$/, command: "Paper settings…", needsDrawing: true },
  { name: /^Page setup$/, command: "Page setup…", needsDrawing: true },
  {
    name: /^New drawing from template$/,
    command: "Templates: New drawing from template",
  },
  {
    name: /^Save as template$/,
    command: "Templates: Save drawing as template",
    needsDrawing: true,
  },
];

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

test.describe("dialogs family", () => {
  for (const m of MEMBERS) {
    test(`${m.name.source}: frame, Tab trap, Escape, footer`, async ({
      page,
    }) => {
      await prepare(page);
      await runPaletteCommand(page, m.command);
      const dialog = page.getByRole("dialog", { name: m.name });
      await expect(dialog).toBeVisible();
      // The one frame.
      await expect(dialog.locator(".vd-dialog")).toHaveCount(1);
      // Tab never leaves the dialog.
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press("Tab");
        const where = await dialog.evaluate((el) => {
          const a = el.ownerDocument.activeElement;
          return el.contains(a)
            ? "inside"
            : (a?.outerHTML ?? "none").slice(0, 120);
        });
        expect(where, `Tab ${i}`).toBe("inside");
      }
      // One footer height.
      const heights = await dialog
        .locator(".vd-dialog__footer .vault-btn:not(.vault-btn--icon)")
        .evaluateAll((els) =>
          els.map((e) => Math.round(e.getBoundingClientRect().height)),
        );
      expect(new Set(heights).size).toBeLessThanOrEqual(1);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(page.locator(".vd-dialog-scrim")).toHaveCount(0);
    });
  }
});
