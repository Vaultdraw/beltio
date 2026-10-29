import { expect } from "@playwright/test";

import { test } from "../fixture";
import { canvasBox, openVault, readScene, trackErrors } from "../helpers";
import { seedAndOpen } from "../pageHelpers";

// Family: what a user pastes from the web lands as what they copied (owner, 2026-10-29): a picture
// address or a page part with a picture becomes a picture; a picture address the safety checks
// refuse becomes a box that says why; a web page address pastes as before (a link or embed). One
// row per kind; the picture bytes come from the browser stand-in's table, never the internet.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#f00"/></svg>`;
const PIC = "https://images.example.org/static-rsc-4/abc?purpose=inline";
const PAGE_PIC = "https://cdn.example.org/chip.png";

type Row = {
  name: string;
  data: Record<string, string>;
  images: number;
  refusal: boolean;
};

const ROWS: Row[] = [
  {
    name: "a picture address with no file extension",
    data: { "text/plain": PIC },
    images: 1,
    refusal: false,
  },
  {
    name: "part of a web page with a picture in it",
    data: {
      "text/html": `<p>Chip</p><img src="${PAGE_PIC}" alt="Chip">`,
      "text/plain": "Chip",
    },
    images: 1,
    refusal: false,
  },
  {
    name: "a picture address on a private network",
    data: { "text/plain": "http://192.168.1.2/router.png" },
    images: 0,
    refusal: true,
  },
  {
    name: "a web page address (not a picture)",
    data: { "text/plain": "https://example.org/article" },
    images: 0,
    refusal: false,
  },
];

for (const row of ROWS) {
  test(`paste: ${row.name}`, async ({ page }) => {
    const errors = trackErrors(page);
    await openVault(page, "?plugins=markdown-import");
    await page.waitForFunction(() => (window as any).__pluginsReady === true);
    await page.evaluate(
      ([svg, pic, pagePic]) => {
        (window as any).__plugins.backend.network.images = {
          [pic]: new TextEncoder().encode(svg),
          [pagePic]: new TextEncoder().encode(svg),
          "http://192.168.1.2/router.png": "INVALID_URL",
          "https://example.org/article": "NOT_AN_IMAGE",
        };
      },
      [SVG, PIC, PAGE_PIC] as const,
    );
    await seedAndOpen(page, "Paste.excalidraw", { elements: [] });
    const box = await canvasBox(page);
    await page.mouse.click(box.x + 200, box.y + 200);
    await page.evaluate((data) => {
      const dt = new DataTransfer();
      for (const [type, value] of Object.entries(data)) {
        dt.setData(type, value);
      }
      document.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, row.data);
    const live = async () =>
      ((await readScene(page, "Paste.excalidraw")).elements as any[]).filter(
        (e) => !e.isDeleted,
      );
    await expect
      .poll(async () => (await live()).length, { timeout: 15_000 })
      .toBeGreaterThan(0);
    const els = await live();
    expect(els.filter((e) => e.type === "image")).toHaveLength(row.images);
    const refused = els.some(
      (e) => e.type === "text" && /^Web image refused/.test(e.text),
    );
    expect(refused).toBe(row.refusal);
    if (row.images > 0) {
      const scene = await readScene(page, "Paste.excalidraw");
      const img = els.find((e) => e.type === "image");
      expect(scene.files[img.fileId]?.mimeType).toBe("image/svg+xml");
    }
    expect(errors).toEqual([]);
  });
}
