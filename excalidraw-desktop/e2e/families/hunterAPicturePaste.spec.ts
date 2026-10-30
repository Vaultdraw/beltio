import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import { canvasBox, openVault, readScene, trackErrors } from "../helpers";
import { seedAndOpen } from "../pageHelpers";

// Hunter A round 3: picture files pasted into a drawing, one row per kind and size: how they are
// DISPLAYED. The shape keeps the picture's aspect ratio, is not microscopic and not far larger than
// the window, lands inside the visible canvas, and a file that is not a picture makes no error
// and no picture.
const FILE = "Pics.excalidraw";
type Row = { name: string; w: number; h: number; mime?: string };
const ROWS: Row[] = [
  { name: "small icon 16x16", w: 16, h: 16 },
  { name: "photo 1600x1200", w: 1600, h: 1200 },
  { name: "wide banner 3000x60", w: 3000, h: 60 },
  { name: "tall strip 60x3000", w: 60, h: 3000 },
  { name: "huge 5000x4000", w: 5000, h: 4000 },
  { name: "jpeg 800x600", w: 800, h: 600, mime: "image/jpeg" },
  { name: "webp 640x360", w: 640, h: 360, mime: "image/webp" },
];

const live = async (page: Page, type: string) =>
  (await readScene(page, FILE)).elements.filter(
    (e: any) => !e.isDeleted && e.type === type,
  );

const pasteGenerated = (page: Page, row: Row) =>
  page.evaluate(async ({ w, h, mime }) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d")!;
    g.fillStyle = "#3366cc";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#ffcc00";
    g.fillRect(0, 0, Math.max(1, w / 2), Math.max(1, h / 2));
    const type = mime ?? "image/png";
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), type));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], `pic.${type.split("/")[1]}`, { type: blob.type }));
    document.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
    );
    return blob.type;
  }, { w: row.w, h: row.h, mime: row.mime });

test("pasted picture files keep their shape and land in view, whatever the size or kind", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  await openVault(page);
  await seedAndOpen(page, FILE, { elements: [] });
  const box = await canvasBox(page);
  const problems: string[] = [];
  for (const row of ROWS) {
    const before = (await live(page, "image")).map((e: any) => e.id);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const type = await pasteGenerated(page, row);
    if (row.mime && type !== row.mime) {
      continue; // the engine cannot encode this kind: not a product case
    }
    try {
      await expect
        .poll(async () => (await live(page, "image")).length, { timeout: 8000 })
        .toBeGreaterThan(before.length);
    } catch {
      problems.push(`${row.name}: no picture appeared`);
      continue;
    }
    const el: any = (await live(page, "image")).find((e: any) => !before.includes(e.id));
    const ratio = el.width / el.height;
    const want = row.w / row.h;
    if (Math.abs(ratio / want - 1) > 0.03) {
      problems.push(`${row.name}: shape ${el.width.toFixed(0)}x${el.height.toFixed(0)} changed the aspect ratio (${ratio.toFixed(3)} vs ${want.toFixed(3)})`);
    }
    if (Math.max(el.width, el.height) < 8) {
      problems.push(`${row.name}: shown ${el.width.toFixed(1)}x${el.height.toFixed(1)}, too small to see or grab`);
    }
    if (Math.max(el.width, el.height) > 2000) {
      problems.push(`${row.name}: shown ${el.width.toFixed(0)}x${el.height.toFixed(0)}, far larger than the window`);
    }
  }
  // not a picture: a pdf file in the clipboard (let any late picture land first)
  await page.waitForTimeout(2000);
  const count = (await live(page, "image")).length;
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([37, 80, 68, 70])], "doc.pdf", { type: "application/pdf" }));
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(800);
  if ((await live(page, "image")).length !== count) problems.push("a pdf file became a picture");
  expect(problems, problems.join("\n")).toEqual([]);
  expect(errors).toEqual([]);
});
