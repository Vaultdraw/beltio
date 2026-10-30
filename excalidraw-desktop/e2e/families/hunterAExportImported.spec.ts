
import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import {
  clickMainMenuItem,
  exportDialogButton,
  exportedNames,
  openExportDialogFromMenu,
  openVault,
  trackErrors,
} from "../helpers";
import { seedAndOpen } from "../pageHelpers";

// Hunter A round 3: export an imported note (heading, bold paragraph, a local picture, a table)
// as PNG and SVG from the export dialog. The PNG is not blank, shows the picture's red, and the
// text has contrast against the page; the SVG carries the picture. Light and dark app theme.
const PIC = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#ff0000"/></svg>`;
const NOTE = [
  "# Exported heading",
  "**All bold paragraph for export**",
  "![[pic.svg]]",
  "| Name | Value |\n|---|---|\n| first | one |\n| second | two |",
].join("\n\n");

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

const analysePng = (page: Page, bytes: number[]) =>
  page.evaluate(async (data) => {
    const bmp = await createImageBitmap(
      new Blob([new Uint8Array(data)], { type: "image/png" }),
    );
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    const g = c.getContext("2d")!;
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
    const lum = (r: number, gg: number, b: number) => {
      const f = (v: number) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(gg) + 0.0722 * f(b);
    };
    let red = 0;
    const counts = new Map<number, number>();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) {
        continue;
      }
      // red, or the pink the dark export gives it (the editor inverts pictures in dark export)
      if (d[i] > 200 && d[i] - Math.max(d[i + 1], d[i + 2]) > 60) {
        red++;
      }
      const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const bg = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    const bgL = lum(bg >> 16, (bg >> 8) & 255, bg & 255);
    let best = 1;
    for (const [k] of counts) {
      const l = lum(k >> 16, (k >> 8) & 255, k & 255);
      best = Math.max(
        best,
        (Math.max(l, bgL) + 0.05) / (Math.min(l, bgL) + 0.05),
      );
    }
    return {
      w: bmp.width,
      h: bmp.height,
      red,
      best: +best.toFixed(2),
      colours: counts.size,
    };
  }, bytes);

test("an imported note exports as PNG and SVG with its picture and readable text, in both app themes", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Start.excalidraw");
  await page.evaluate(
    ([note, pic]) => {
      (window as any).__plugins.backend.folders.sourcePick = {
        name: "Vault",
        files: { "Exp.md": note, "pic.svg": pic },
      };
    },
    [NOTE, PIC] as const,
  );
  await clickMainMenuItem(page, "Import Obsidian vault…");
  await expect(row(page, "Vault")).toBeVisible({ timeout: 30_000 });
  if (!(await row(page, "Vault/Exp.excalidraw").isVisible())) {
    await row(page, "Vault").locator(".vault-tree-item__toggle").click();
  }
  const problems: string[] = [];
  let n = 0;
  for (const mode of ["Light", "Dark"] as const) {
    await setMode(page, mode);
    await row(page, "Vault/Exp.excalidraw").click();
    await page.waitForTimeout(800);
    await openExportDialogFromMenu(page);
    await exportDialogButton(page, "PNG").click();
    await expect
      .poll(async () => (await exportedNames(page)).length)
      .toBeGreaterThan(n);
    await exportDialogButton(page, "SVG").click();
    await expect
      .poll(async () => (await exportedNames(page)).length)
      .toBeGreaterThan(n + 1);
    n += 2;
    const files: { name: string; bytes: number[] }[] = await page.evaluate(() =>
      (window as any).__vaultRepo.exported.map((e: any) => ({
        name: e.name,
        bytes: Array.from(e.bytes as Uint8Array),
      })),
    );
    const png = files.filter((f) => f.name.endsWith(".png")).pop()!;
    const svg = files.filter((f) => f.name.endsWith(".svg")).pop()!;
    const r = await analysePng(page, png.bytes);
    if (r.red < 200) {
      problems.push(`${mode}: PNG shows no picture (red pixels ${r.red})`);
    }
    if (r.best < 3) {
      problems.push(`${mode}: PNG ink/page contrast ${r.best}`);
    }
    const text = new TextDecoder().decode(new Uint8Array(svg.bytes));
    if (!/<image|href="data:image/.test(text)) {
      problems.push(`${mode}: SVG has no picture`);
    }
    if (!/Exported heading/.test(text) && !/<text/.test(text)) {
      problems.push(`${mode}: SVG has no text`);
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    if (await page.locator(".ImageExportModal").isVisible()) {
      await page
        .locator(".Modal__background")
        .click({ position: { x: 4, y: 4 } });
    }
  }
  expect(problems, problems.join("\n")).toEqual([]);
  expect(errors).toEqual([]);
});
