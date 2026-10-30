import { expect } from "@playwright/test";

import { test } from "../fixture";
import {
  exportDialogButton,
  exportedNames,
  openExportDialogFromMenu,
} from "../helpers";
import { openSeededVault, sceneJson, treeName } from "../tabsHelpers";

// Hunter B round 4: export to SVG keeps the stored colour of Markdown role text (headings,
// bold, link) in the light and in the dark app theme (only the dialog's own "Dark mode" inverts).
const text = (id: string, role: string, color: string, y: number) => ({
  id,
  type: "text",
  x: 100,
  y,
  width: 200,
  height: 40,
  angle: 0,
  strokeColor: color,
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 1,
  strokeStyle: "solid",
  roughness: 0,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  boundElements: [],
  link: null,
  locked: false,
  isDeleted: false,
  version: 1,
  versionNonce: 1,
  index: null,
  updated: 1,
  seed: 5,
  text: id,
  fontSize: 32,
  fontFamily: 2,
  textAlign: "left",
  verticalAlign: "top",
  containerId: null,
  originalText: id,
  autoResize: true,
  lineHeight: 1.25,
  customData: { role },
});

const scene2 = sceneJson(
  [],
  [
    {
      ...text("Regular", "h1", "#1e1e1f", 100),
      fontFamily: 2,
      text: "WWWWWWWW",
      originalText: "WWWWWWWW",
      customData: {},
    },
    {
      ...text("Bold", "h1", "#1e1e1f", 300),
      fontFamily: 102,
      text: "WWWWWWWW",
      originalText: "WWWWWWWW",
    },
  ],
);
test("hunter B: export draws a bold heading bold in SVG (font-weight) and in PNG (more ink)", async ({
  page,
}) => {
  await openSeededVault(page, { "Bold.excalidraw": scene2 });
  await treeName(page, "Bold").click();
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  await page.waitForTimeout(1500);
  await openExportDialogFromMenu(page);
  await exportDialogButton(page, "SVG").click();
  await expect.poll(() => exportedNames(page)).toContain("Bold.svg");
  await exportDialogButton(page, "PNG").click();
  await expect.poll(() => exportedNames(page)).toContain("Bold.png");
  const r = await page.evaluate(async () => {
    const files = (window as any).__vaultRepo.exported as any[];
    const svg = new TextDecoder().decode(
      files.find((f) => f.name === "Bold.svg").bytes,
    );
    const png = files.find((f) => f.name === "Bold.png").bytes;
    const bmp = await createImageBitmap(new Blob([png], { type: "image/png" }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const x = c.getContext("2d")!;
    x.drawImage(bmp, 0, 0);
    const d = x.getImageData(0, 0, bmp.width, bmp.height).data;
    // ink per half: top (regular) vs bottom (bold)
    let top = 0;
    let bot = 0;
    const half = Math.floor(bmp.height / 2);
    for (let yy = 0; yy < bmp.height; yy++) {
      for (let xx = 0; xx < bmp.width; xx++) {
        const i = (yy * bmp.width + xx) * 4;
        if (d[i] < 128 && d[i + 3] > 128) {
          if (yy < half) {
            top++;
          } else {
            bot++;
          }
        }
      }
    }
    return {
      texts: [...svg.matchAll(/<text[^>]*>/g)].map((m) => m[0]),
      face: (svg.match(/@font-face[^}]*}/g) || []).map((s) => s.slice(0, 160)),
      fonts: [...svg.matchAll(/font-family="([^"]+)"/g)].map((m) => m[1]),
      faces: [...svg.matchAll(/font-family:\s*([^;"]+);/g)]
        .map((m) => m[1])
        .slice(0, 8),
      top,
      bot,
      w: bmp.width,
      h: bmp.height,
    };
  });
  expect(r.texts[0]).not.toContain("font-weight");
  expect(r.texts[1]).toContain('font-weight="bold"');
  expect(r.bot).toBeGreaterThan(r.top * 1.15);
});
