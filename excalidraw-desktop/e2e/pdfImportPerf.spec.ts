import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openVault, readScene } from "./helpers";
import { rect, runCommand, seedAndOpen } from "./pageHelpers";

// PDF import cost (E2E_PERF=1, chromium: longtask + CDP heap), fake bridge,
// default settings, empty drawing. One `PERF {json}` line per page count:
//   wallMs        Import click -> all images in the scene
//   longestTaskMs / longTasks50  main-thread long tasks during the import
//   heapBeforeMb / heapAfterMb / heapDeltaMb  after GC + settle
//   peakHeapMb    max used JS heap (CDP, every 25 ms) during the import
//   imported / truncated / notice  result and the notice text
//   autosaveMs / autosaveBytes     next drawing write after the import
// The fake bridge encodes pages in the webview; the native app does that in Rust.
const PERF = process.env.E2E_PERF === "1";
const DRAWING = "PdfPerf.excalidraw";
const COMMAND = "Import: PDF…";

test.skip(!PERF, "set E2E_PERF=1 to run the PDF import measurements");
test.describe.configure({ timeout: 180_000 });

const imageCount = async (page: Page) =>
  ((await readScene(page, DRAWING)).elements as any[]).filter(
    (e) => e.type === "image" && !e.isDeleted,
  ).length;

const heapMb = async (page: Page) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  const h = await cdp.send("Runtime.getHeapUsage");
  await cdp.detach();
  return h.usedSize / 1048576;
};

for (const pages of [20, 100]) {
  test(`pdf import ${pages} A4 pages`, async ({ page, browserName }) => {
    test.skip(
      browserName !== "chromium",
      "longtask + CDP heap are chromium-only",
    );
    await openVault(page);
    await seedAndOpen(page, DRAWING, { elements: [rect("a", 50, 50)] });
    await page.evaluate((n) => {
      const b = (window as any).__pdfBridge;
      b.textLines = 70; // dense text pages: realistic encoded sizes
      b.nextPick = b.makeDoc(
        "perf.pdf",
        Array.from({ length: n }, () => ({ widthPt: 595, heightPt: 842 })),
      );
    }, pages);

    await runCommand(page, COMMAND);
    const dialog = page.getByRole("dialog", { name: "Import PDF" });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(500);
    const heapBefore = await heapMb(page);

    await page.evaluate(() => {
      const w = window as any;
      w.__lt = [] as number[];
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) {
          w.__lt.push(e.duration);
        }
      }).observe({ entryTypes: ["longtask"] });
      // time + size of drawing writes after the import click
      w.__writes = [] as { t: number; bytes: number }[];
      const repo = w.__vaultRepo;
      const write = repo.writeDrawing.bind(repo);
      repo.writeDrawing = async (input: { json: unknown }) => {
        const t0 = performance.now();
        const r = await write(input);
        w.__writes.push({
          t: performance.now() - t0,
          bytes:
            typeof input.json === "string"
              ? input.json.length
              : JSON.stringify(input.json).length,
        });
        return r;
      };
    });

    // sanity: the long-task observer sees a 120 ms busy loop
    await page.evaluate(() =>
      setTimeout(() => {
        const end = performance.now() + 120;
        while (performance.now() < end) {
          // busy
        }
      }, 0),
    );
    await expect
      .poll(() => page.evaluate(() => (window as any).__lt.length))
      .toBeGreaterThan(0);
    await page.evaluate(() => ((window as any).__lt.length = 0));

    // peak JS heap during the import: CDP samples every 25 ms (no forced GC)
    const cdp = await page.context().newCDPSession(page);
    let peakHeap = 0;
    let sampling = true;
    const sampler = (async () => {
      while (sampling) {
        const h = await cdp.send("Runtime.getHeapUsage");
        peakHeap = Math.max(peakHeap, h.usedSize);
        await new Promise((r) => setTimeout(r, 25));
      }
    })();

    const t0 = Date.now();
    await dialog.getByRole("button", { name: "Import", exact: true }).click();
    await expect
      .poll(() => imageCount(page), { timeout: 90_000, intervals: [50] })
      .toBeGreaterThan(0);
    // the import commits in one step; wait until the count stops growing
    let n = await imageCount(page);
    for (let stable = 0; stable < 2; ) {
      await page.waitForTimeout(100);
      const m = await imageCount(page);
      stable = m === n ? stable + 1 : 0;
      n = m;
    }
    const wallMs = Date.now() - t0;
    sampling = false;
    await sampler;
    await cdp.detach();
    const peakHeapMb = peakHeap / 1048576;

    const notice =
      (await page.locator(".vd-toast").first().textContent()) ?? "";
    await expect
      .poll(() => page.evaluate(() => (window as any).__writes.length), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    await page.waitForTimeout(2000);
    const heapAfter = await heapMb(page);
    const { lt, writes } = await page.evaluate(() => ({
      lt: (window as any).__lt as number[],
      writes: (window as any).__writes as { t: number; bytes: number }[],
    }));
    const last = writes[writes.length - 1];
    const truncated = Number(
      /(\d+) pages? not imported/.exec(notice)?.[1] ?? 0,
    );
    const longest = lt.length ? Math.max(...lt) : 0;

    // eslint-disable-next-line no-console
    console.log(
      `PERF ${JSON.stringify({
        test: "pdfImport",
        pages,
        wallMs,
        longestTaskMs: Math.round(longest),
        longTasks50: lt.filter((d) => d > 50).length,
        heapBeforeMb: +heapBefore.toFixed(1),
        heapAfterMb: +heapAfter.toFixed(1),
        heapDeltaMb: +(heapAfter - heapBefore).toFixed(1),
        peakHeapMb: +peakHeapMb.toFixed(1),
        imported: n,
        truncated,
        notice,
        autosaveMs: +last.t.toFixed(1),
        autosaveBytes: last.bytes,
      })}`,
    );

    expect(n + truncated).toBe(pages);
    expect(wallMs).toBeLessThan(pages > 50 ? 30_000 : 10_000);
    expect(longest).toBeLessThan(1000);
  });
}
