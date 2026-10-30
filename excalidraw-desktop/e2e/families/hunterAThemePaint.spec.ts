import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import {
  clickMainMenuItem,
  openVault,
  trackErrors,
} from "../helpers";
import { seedAndOpen } from "../pageHelpers";

// Hunter A round 3: switch the theme with imported notes open. What is PAINTED must be legible:
// the ink on the canvas (plain, bold, heading, table text) keeps a contrast of at least 3:1 with the
// page in light and dark, after each switch, and after switching back.
const NOTES: Record<string, string> = {
  "Plain.md": "Plain words in a paragraph that wraps over a few lines of the page.\n",
  "Bold.md": "**All bold paragraph that wraps over a few lines of the page here.**\n",
  "Head.md": "# Big heading\n\n## Smaller heading\n",
  "Table.md": "| A | B |\n|---|---|\n| one | two |\n| three | four |\n",
  "Code.md": "```js\nconst a = 1;\n```\n\n> quote text here\n",
};

const row = (page: Page, path: string) =>
  page.locator(
    `.vault-tree-container .vault-tree-item[data-tree-path="${path}"]`,
  );

const setMode = async (page: Page, mode: "Light" | "Dark") => {
  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Appearance", exact: true }).click();
  await dialog
    .getByRole("group", { name: "Mode" })
    .getByRole("button", { name: mode })
    .click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
};

/** Contrast ratio between the page colour and the ink furthest from it, over the static canvas. */
const paint = (page: Page) =>
  page.evaluate(() => {
    const c = document.querySelector(
      ".vault-editor canvas.static",
    ) as HTMLCanvasElement | null;
    if (!c) return { error: "no static canvas" };
    const ctx = c.getContext("2d");
    // draw through an offscreen copy: the page's own context may be a different kind
    const copy = document.createElement("canvas");
    copy.width = c.width;
    copy.height = c.height;
    const cx = copy.getContext("2d")!;
    cx.drawImage(c, 0, 0);
    const d = cx.getImageData(0, 0, copy.width, copy.height).data;
    const lum = (r: number, g: number, b: number) => {
      const f = (v: number) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const counts = new Map<number, number>();
    for (let i = 0; i < d.length; i += 4 * 7) {
      if (d[i + 3] < 200) continue;
      const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    if (!counts.size) return { error: "blank canvas", ctx: !!ctx };
    const bgKey = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const bgL = lum(bgKey >> 16, (bgKey >> 8) & 255, bgKey & 255);
    let best = 1;
    let inkPixels = 0;
    for (const [k, n] of counts) {
      const l = lum(k >> 16, (k >> 8) & 255, k & 255);
      const ratio = (Math.max(l, bgL) + 0.05) / (Math.min(l, bgL) + 0.05);
      if (ratio > 1.5) inkPixels += n;
      best = Math.max(best, ratio);
    }
    return { bg: bgKey.toString(16), best: +best.toFixed(2), inkPixels };
  });

test("imported notes stay legible after every theme switch", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = trackErrors(page);
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Start.excalidraw");
  await page.evaluate((n) => {
    (window as any).__plugins.backend.folders.sourcePick = {
      name: "Vault",
      files: n,
    };
  }, NOTES);
  await clickMainMenuItem(page, "Import Obsidian vault…");
  await expect(row(page, "Vault")).toBeVisible({ timeout: 30_000 });
  if (!(await row(page, "Vault/Plain.excalidraw").isVisible())) {
    await row(page, "Vault").locator(".vault-tree-item__toggle").click();
  }
  await expect(row(page, "Vault/Plain.excalidraw")).toBeVisible();

  const problems: string[] = [];
  const names = Object.keys(NOTES).map((n) => n.replace(/\.md$/, ""));
  for (const mode of ["Light", "Dark", "Light"] as const) {
    await setMode(page, mode);
    for (const name of names) {
      const path = `Vault/${name}.excalidraw`;
      await expect(row(page, path)).toBeVisible();
      await row(page, path).click();
      await page.waitForTimeout(600);
      const p: any = await page.evaluate(() =>
        document.documentElement.getAttribute("data-theme"),
      );
      const r: any = await paint(page);
      if (r.error || r.best < 3 || r.inkPixels < 20) {
        problems.push(`${mode} (${p}) ${name}: ${JSON.stringify(r)}`);
      }
    }
  }
  expect(problems, problems.join("\n")).toEqual([]);
  expect(errors).toEqual([]);
});
