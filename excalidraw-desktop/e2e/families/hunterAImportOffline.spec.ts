import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import { openVault, readScene, trackErrors } from "../helpers";
import { seedAndOpen } from "../pageHelpers";

// Hunter A round 3: "Import file…" (right-click the canvas) with a Markdown note that holds a web
// picture, while Offline mode is on: the note still opens as its own drawing, the picture becomes a
// labelled box, nothing leaves the page. Turning Offline off and importing again downloads it.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#f00"/></svg>`;
const PIC = "https://images.example.org/static/chip.png";
const NOTE = `# Chip note\n\nBefore the picture.\n\n![A chip](${PIC})\n\nAfter the picture.\n`;

const setOffline = async (page: Page, on: boolean) => {
  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.locator(".vault-settings-modal");
  await dialog.getByRole("tab", { name: "General", exact: true }).click();
  await dialog
    .getByRole("switch", { name: "Offline mode", exact: true })
    .setChecked(on, { force: true });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
};

const importNote = async (page: Page, name: string) => {
  await page.locator(".vault-editor canvas.interactive").click({
    button: "right",
    position: { x: 300, y: 200 },
  });
  const chooser = page.waitForEvent("filechooser");
  await page
    .locator(".context-menu")
    .getByRole("button", { name: "Import file…" })
    .click();
  await (
    await chooser
  ).setFiles({
    name,
    mimeType: "text/markdown",
    buffer: Buffer.from(NOTE),
  });
};

const scene = async (page: Page, path: string) =>
  expect
    .poll(
      () =>
        page.evaluate(async (p) => {
          const r = (window as any).__vaultRepo;
          try {
            const d = await r.readDrawing(r.handle, p);
            const els = JSON.parse(d.json).elements.filter(
              (e: any) => !e.isDeleted,
            );
            return {
              images: els.filter((e: any) => e.type === "image").length,
              text: els
                .filter((e: any) => e.type === "text")
                .map((e: any) => String(e.text).replace(/\s+/g, " "))
                .join(" | "),
            };
          } catch {
            return null;
          }
        }, path),
      { timeout: 30_000 },
    )
    .not.toBeNull();

test("importing a note with a web picture offline gives a labelled box, online downloads it", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const errors = trackErrors(page);
  const requests: string[] = [];
  page.on("request", (req) => {
    const u = new URL(req.url());
    if (
      /^https?:$/.test(u.protocol) &&
      !/^(localhost|127\.0\.0\.1)$/.test(u.hostname)
    ) {
      requests.push(req.url());
    }
  });
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await page.evaluate(
    ([svg, pic]) => {
      (window as any).__plugins.backend.network.images = {
        [pic]: new TextEncoder().encode(svg),
      };
    },
    [SVG, PIC] as const,
  );
  await seedAndOpen(page, "Start.excalidraw");
  await setOffline(page, true);
  await importNote(page, "Chip.md");
  await expect(
    page.locator(".vault-tree-item__name", { hasText: "Chip (imported)" }),
  ).toBeVisible({ timeout: 30_000 });
  await scene(page, "Chip (imported).excalidraw");
  const read = (path: string) =>
    page.evaluate(async (p) => {
      const r = (window as any).__vaultRepo;
      const d = await r.readDrawing(r.handle, p);
      const els = JSON.parse(d.json).elements.filter((e: any) => !e.isDeleted);
      return {
        images: els.filter((e: any) => e.type === "image").length,
        text: els
          .filter((e: any) => e.type === "text")
          .map((e: any) => String(e.text).replace(/\s+/g, " "))
          .join(" | "),
      };
    }, path);
  await expect
    .poll(async () => (await read("Chip (imported).excalidraw")).text, {
      timeout: 20_000,
    })
    .toContain("After the picture.");
  const off = await read("Chip (imported).excalidraw");
  expect(off.images, "no picture offline").toBe(0);
  expect(off.text).toMatch(/Offline mode is on/);
  expect(off.text).toContain("Before the picture.");
  expect(requests, "requests while offline").toEqual([]);

  await setOffline(page, false);
  await page
    .locator(".vault-tree-item__name", { hasText: "Start" })
    .first()
    .click();
  await importNote(page, "Chip2.md");
  await expect(
    page.locator(".vault-tree-item__name", { hasText: "Chip2 (imported)" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => (await read("Chip2 (imported).excalidraw")).images, {
      timeout: 30_000,
    })
    .toBe(1);
  void readScene;
  expect(errors).toEqual([]);
});
