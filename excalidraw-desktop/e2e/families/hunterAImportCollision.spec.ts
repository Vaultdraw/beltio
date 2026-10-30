import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import {
  clickMainMenuItem,
  openVault,
  readScene,
  trackErrors,
} from "../helpers";
import { rect, seedAndOpen } from "../pageHelpers";

// Hunter A round 3: names collide. The user already has a folder "Vault" with their own drawing
// "Alpha"; they import an Obsidian vault that is also called "Vault" and holds "Alpha.md".
// Nothing of the user's may be overwritten or mixed in; importing the same vault again must not
// touch the first import either (Obsidian never overwrites on a paste or copy: "Alpha 1").
const ALPHA = "Alpha words from the other app.";
const row = (page: Page, path: string) =>
  page.locator(
    `.vault-tree-container .vault-tree-item[data-tree-path="${path}"]`,
  );

test("importing a vault whose name and notes collide with the user's own files overwrites nothing", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Start.excalidraw");
  await page.evaluate((json) => {
    const repo = (window as any).__vaultRepo;
    repo.seedDrawing("Vault/Alpha.excalidraw", json);
    repo.emit({ handle: repo.handle, paths: [], rescan: true });
  }, JSON.stringify({ type: "excalidraw", version: 2, elements: [rect("userRect", 10, 10)], appState: {}, files: {} }));
  const userBefore = JSON.stringify(
    (await readScene(page, "Vault/Alpha.excalidraw")).elements.map(
      (e: any) => e.id,
    ),
  );
  const pick = () =>
    page.evaluate((t) => {
      (window as any).__plugins.backend.folders.sourcePick = {
        name: "Vault",
        files: { "Alpha.md": t },
      };
    }, ALPHA);
  const userIntact = async (when: string) => {
    const ids = JSON.stringify(
      (await readScene(page, "Vault/Alpha.excalidraw")).elements.map(
        (e: any) => e.id,
      ),
    );
    expect(ids, `the user's own Alpha after ${when}`).toBe(userBefore);
  };
  const countWith = async (word: string) =>
    page.evaluate(async (w) => {
      const r = (window as any).__vaultRepo;
      const names: string[] = [];
      const seen = new Set<string>();
      const walk = async (dir: string) => {
        if (seen.has(dir)) {
          return;
        }
        seen.add(dir);
        const res = await r.listDirectory(r.handle, dir);
        for (const e of res) {
          const p: string = e.path;
          if (e.kind === "folder") {
            await walk(p);
          } else if (/\.excalidraw$/.test(p)) {
            names.push(p);
          }
        }
      };
      await walk("");
      let n = 0;
      for (const p of names) {
        const d = await r.readDrawing(r.handle, p);
        if (d.json.includes(w)) {
          n++;
        }
      }
      return n;
    }, word);

  await pick();
  await clickMainMenuItem(page, "Import Obsidian vault…");
  await expect
    .poll(() => countWith("Alpha words"), { timeout: 30_000 })
    .toBe(1);
  await userIntact("the first import");

  await pick();
  await clickMainMenuItem(page, "Import Obsidian vault…");
  await expect
    .poll(() => countWith("Alpha words"), { timeout: 30_000 })
    .toBe(2);
  await page.waitForTimeout(1500);
  expect(await countWith("Alpha words"), "a second import adds a copy").toBe(2);
  await userIntact("the second import");
  expect(errors).toEqual([]);
});
