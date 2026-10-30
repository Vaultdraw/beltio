import { expect } from "@playwright/test";

import { test } from "../fixture";
import { openVault } from "../helpers";

// Launch hunter 3: the palette's commands mode finds a command by words in any order, with
// accents folded (Obsidian's command palette and Zed's picker do).
test("palette commands mode: words in any order and accents folded find New folder", async ({
  page,
}) => {
  await openVault(page, "?seed=obsidian");
  await page.keyboard.press("Meta+Shift+KeyP");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const out: Record<string, string> = {};
  for (const q of ["new folder", "folder new", "NEW   FOLDER", "nëw földer"]) {
    await page.keyboard.press("Meta+KeyA");
    await page.keyboard.type(`>${q}`);
    await page.waitForTimeout(300);
    out[q] = (await dialog.getByRole("option").allTextContents())
      .slice(0, 3)
      .join(" | ");
  }
  // eslint-disable-next-line no-console
  console.log(`PALETTE ${JSON.stringify(out)}`);
  expect(out["new folder"]).toMatch(/New folder/);
  expect.soft(out["folder new"], "words in any order").toMatch(/New folder/);
  expect.soft(out["nëw földer"], "accents folded").toMatch(/New folder/);
});
