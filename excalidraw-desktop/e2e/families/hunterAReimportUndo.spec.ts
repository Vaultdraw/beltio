import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import {
  canvasBox,
  clickMainMenuItem,
  openVault,
  readScene,
  trackErrors,
} from "../helpers";
import { seedAndOpen } from "../pageHelpers";

// Hunter A round 3: re-import an untouched note WHILE it is open, then undo and redo with the editor
// focused. The drawing must always hold exactly one copy of the note (old or new words, never both,
// never empty, never doubled), and a save after the undo must not bring the old note back over
// the new one without the user asking.
const note = (word: string) => `# Title ${word}\n\nBody about ${word}.\n`;
const row = (page: Page, path: string) =>
  page.locator(
    `.vault-tree-container .vault-tree-item[data-tree-path="${path}"]`,
  );
const PATH = "Vault/Undo.excalidraw";
const texts = async (page: Page) =>
  (await readScene(page, PATH)).elements
    .filter((e: any) => e.type === "text" && !e.isDeleted)
    .map((e: any) => String(e.text).replace(/\s+/g, " "));

test("re-importing an open note, then undo and redo, never doubles, empties or reverts the note silently", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Start.excalidraw");
  const pick = (w: string) =>
    page.evaluate((n) => {
      (window as any).__plugins.backend.folders.sourcePick = {
        name: "Vault",
        files: { "Undo.md": n },
      };
    }, note(w));
  await pick("alpha");
  await clickMainMenuItem(page, "Import Obsidian vault…");
  await expect(row(page, "Vault")).toBeVisible({ timeout: 30_000 });
  if (!(await row(page, PATH).isVisible())) {
    await row(page, "Vault").locator(".vault-tree-item__toggle").click();
  }
  await row(page, PATH).click();
  await expect
    .poll(async () => (await texts(page)).join(" "))
    .toContain("alpha");

  await pick("bravo");
  await row(page, "Vault").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Re-import unchanged imported notes here" })
    .click();
  await expect(page.getByText(/Re-imported/)).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => (await texts(page)).join(" "))
    .toContain("bravo");

  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width - 30, box.y + box.height - 30);
  const state = async (label: string) => {
    await page.waitForTimeout(1500);
    const t = (await texts(page)).join(" | ");
    const live = (await readScene(page, PATH)).elements.filter(
      (e: any) => !e.isDeleted,
    ).length;
    return { label, t, live };
  };
  const seen = [await state("after re-import")];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Meta+z");
    seen.push(await state(`undo ${i + 1}`));
  }
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Control+Shift+z");
    await page.keyboard.press("Meta+Shift+z");
    seen.push(await state(`redo ${i + 1}`));
  }
  const problems: string[] = [];
  for (const s of seen) {
    if (s.live === 0) {
      problems.push(`${s.label}: drawing is empty`);
    }
    if (/alpha/.test(s.t) && /bravo/.test(s.t)) {
      problems.push(`${s.label}: old and new words both present: ${s.t}`);
    }
    if ((s.t.match(/Title/g) ?? []).length > 1) {
      problems.push(`${s.label}: heading doubled: ${s.t}`);
    }
  }
  // the file ends on the new note unless the user undid into the old one on purpose
  expect(seen[0].t).toContain("bravo");
  expect(
    problems,
    `${problems.join("\n")}\n${JSON.stringify(seen, null, 1)}`,
  ).toEqual([]);
  expect(errors).toEqual([]);
});
