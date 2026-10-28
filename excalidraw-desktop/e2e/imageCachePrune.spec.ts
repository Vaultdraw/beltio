import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openVault } from "./helpers";
import {
  focusCanvas,
  live,
  rect,
  runCommand,
  seedAndOpen,
} from "./pageHelpers";

// imageCache idle prune: import a 40 page PDF (fake bridge), undo the import,
// and the decoded images are released after the idle grace; redo re-decodes
// them (placeholder, then the real image). Logs `PERF {json}` (cache size and
// JS heap, chromium CDP, after GC) so the numbers can be recorded.

const PAGES = 40;
test.describe.configure({ timeout: 120_000 });

const cacheSize = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector(".vault-editor canvas.interactive")!;
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"))!;
    let fiber = (el as any)[key];
    while (fiber) {
      const s = fiber.stateNode;
      if (s && s.imageCache && s.scene) {
        let decoded = 0;
        for (const v of s.imageCache.values()) {
          if (v.image instanceof HTMLImageElement) {
            decoded++;
          }
        }
        return { size: s.imageCache.size as number, decoded };
      }
      fiber = fiber.return;
    }
    throw new Error("editor instance not found");
  });

const heapMb = async (page: Page) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  const h = await cdp.send("Runtime.getHeapUsage");
  await cdp.detach();
  return +(h.usedSize / 1048576).toFixed(1);
};

const images = async (page: Page) =>
  (await live(page)).elements.filter((e) => e.type === "image").length;

test("undoing a PDF import releases the decoded images; redo re-decodes them", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "CDP heap is chromium-only");
  await openVault(page);
  await seedAndOpen(page, "Prune.excalidraw", {
    elements: [rect("a", 50, 50)],
  });
  await page.evaluate((n) => {
    const b = (window as any).__pdfBridge;
    b.textLines = 70;
    b.nextPick = b.makeDoc(
      "prune.pdf",
      Array.from({ length: n }, () => ({ widthPt: 595, heightPt: 842 })),
    );
  }, PAGES);
  await runCommand(page, "Import: PDF…");
  const dialog = page.getByRole("dialog", { name: "Import PDF" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect.poll(() => images(page), { timeout: 60_000 }).toBe(PAGES);
  await expect
    .poll(async () => (await cacheSize(page)).decoded, { timeout: 30_000 })
    .toBe(PAGES);
  await page.waitForTimeout(1500);
  const imported = { ...(await cacheSize(page)), heapMb: await heapMb(page) };

  await focusCanvas(page);
  await page.keyboard.press("Meta+KeyZ");
  await expect.poll(() => images(page)).toBe(0);
  const undone = { ...(await cacheSize(page)), heapMb: await heapMb(page) };

  // debounce 2.2 s + idle, then a second prune after the 2 s grace
  await expect
    .poll(async () => (await cacheSize(page)).size, {
      timeout: 20_000,
      intervals: [500],
    })
    .toBe(0);
  const pruned = { ...(await cacheSize(page)), heapMb: await heapMb(page) };

  await page.keyboard.press("Meta+Shift+KeyZ");
  await expect.poll(() => images(page)).toBe(PAGES);
  await expect
    .poll(async () => (await cacheSize(page)).decoded, { timeout: 30_000 })
    .toBe(PAGES);
  const redone = { ...(await cacheSize(page)), heapMb: await heapMb(page) };

  // eslint-disable-next-line no-console
  console.log(
    `PERF ${JSON.stringify({
      test: "imageCachePrune",
      pages: PAGES,
      imported,
      undone,
      pruned,
      redone,
    })}`,
  );
});
