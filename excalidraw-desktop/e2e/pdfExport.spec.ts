import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";

import { expect, test, type CDPSession, type Page } from "@playwright/test";

import {
  exportDialogButton,
  openExportDialogFromMenu,
  openVault,
  trackErrors,
} from "./helpers";
import {
  A4,
  PAGE_SHOTS,
  rect,
  runCommand,
  seed,
  seedAndOpen,
  setupOf,
} from "./pageHelpers";

// PDF export (offline, one JPEG per page). Correctness runs on WebKit; the
// perf part is E2E_PERF-gated and needs Chromium (CDP CPU throttle).

type Exported = { name: string; bytes: number[] };

const exportedCount = (page: Page) =>
  page.evaluate(() => (window as any).__vaultRepo.exported.length as number);

const lastExport = (page: Page): Promise<Exported> =>
  page.evaluate(() => {
    const files = (window as any).__vaultRepo.exported;
    const last = files[files.length - 1];
    return {
      name: last.name,
      bytes: Array.from(last.bytes as Uint8Array) as number[],
    };
  });

const waitForExport = async (page: Page, before: number, timeout = 60000) => {
  await expect.poll(() => exportedCount(page), { timeout }).toBe(before + 1);
  return lastExport(page);
};

const pdfInfo = (bytes: number[]) => {
  const buf = Buffer.from(bytes);
  const txt = buf.toString("latin1");
  return {
    header: txt.slice(0, 5),
    tail: txt.trimEnd().endsWith("%%EOF"),
    pages: (txt.match(/\/Type \/Page /g) ?? []).length,
    declared: Number(/\/Type \/Pages \/Count (\d+)/.exec(txt)?.[1]),
    boxes: [...txt.matchAll(/\/MediaBox \[0 0 (\S+) (\S+)\]/g)].map((m) => [
      Number(m[1]),
      Number(m[2]),
    ]),
    size: buf.length,
  };
};

const exportViaPalette = async (page: Page) => {
  const before = await exportedCount(page);
  await runCommand(page, "Export: PDF");
  return waitForExport(page, before);
};

const row = (page: Page, path: string) =>
  page.locator(`[data-tree-path="${path}"]`);

const exportViaNavigator = async (page: Page, path: string) => {
  const before = await exportedCount(page);
  await row(page, path).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Export", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export as PDF…" }).click();
  return waitForExport(page, before);
};

/** `n` rectangles spread over `pages` separate pages, none on a gap. */
const content = (n: number, pages = 1) =>
  Array.from({ length: n }, (_, i) => {
    const p = i % pages;
    const k = Math.floor(i / pages);
    return rect(
      `r${i}`,
      60 + (k % 3) * 200,
      p * 1163 + 60 + Math.floor(k / 3) * 130,
      160,
      100,
    );
  });

/** 36 rectangles (6 x 6) per page, all clear of the auto-extend zone. */
const dense = (pages: number) =>
  Array.from({ length: pages * 36 }, (_, i) =>
    rect(
      `d${i}`,
      60 + (i % 6) * 120,
      Math.floor(i / 216) * 1163 + 60 + (Math.floor(i / 6) % 6) * 120,
      90,
      90,
    ),
  );

test.beforeEach(async ({ page }) => {
  await openVault(page);
});

test.describe("PDF export correctness", () => {
  test("palette and navigator menu: valid PDF, page count, MediaBox per size", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    const cases: [string, Parameters<typeof setupOf>[0], number, number[]][] = [
      ["A4p", { pageCount: 3 }, 3, [595, 842]],
      [
        "A4l",
        {
          orientation: "landscape",
          width: A4.height,
          height: A4.width,
          pageCount: 2,
        },
        2,
        [842, 595],
      ],
      [
        "Letter",
        { size: "letter", width: 816, height: 1056, pageCount: 2 },
        2,
        [612, 792],
      ],
    ];
    for (const [name, over, count, box] of cases) {
      await seedAndOpen(page, `${name}.excalidraw`, {
        pageSetup: setupOf(over),
        elements: content(5, count),
      });
      for (const via of ["palette", "navigator"] as const) {
        const file =
          via === "palette"
            ? await exportViaPalette(page)
            : await exportViaNavigator(page, `${name}.excalidraw`);
        expect(file.name).toBe(`${name}.pdf`);
        const info = pdfInfo(file.bytes);
        expect(info.header).toBe("%PDF-");
        expect(info.tail).toBe(true);
        expect(info.pages, `${name} via ${via}`).toBe(count);
        expect(info.declared).toBe(count);
        expect(info.boxes).toEqual(Array(count).fill(box));
      }
    }
    expect(errors).toEqual([]);
  });

  test("continuous layout with content down to 2.5 pages exports 3 pages", async ({
    page,
  }) => {
    await seedAndOpen(page, "Roll.excalidraw", {
      pageSetup: setupOf({ layout: "continuous", pageCount: 1 }),
      elements: [
        rect("a", 100, 100),
        rect("b", 100, Math.round(2.5 * A4.height) - 90, 200, 80),
      ],
    });
    // let the page runtime extend the roll if it does so on open
    await page.waitForTimeout(800);
    const info = pdfInfo((await exportViaPalette(page)).bytes);
    expect(info.pages).toBe(3);
    expect(info.boxes[0]).toEqual([595, 842]);
  });

  test("a normal-mode drawing exports one page", async ({ page }) => {
    await seedAndOpen(page, "Plain.excalidraw", {
      elements: [rect("a", 0, 0, 400, 300), rect("b", 900, 2000)],
    });
    const info = pdfInfo((await exportViaPalette(page)).bytes);
    expect(info.pages).toBe(1);
    expect(info.header).toBe("%PDF-");
  });

  test("export makes no network requests (only same-origin, blob and data)", async ({
    page,
  }) => {
    await seedAndOpen(page, "Off.excalidraw", {
      pageSetup: setupOf({ pageCount: 2 }),
      elements: content(6, 2),
    });
    const urls: string[] = [];
    page.on("request", (r) => urls.push(r.url()));
    const info = pdfInfo((await exportViaPalette(page)).bytes);
    expect(info.pages).toBe(2);
    await page.waitForTimeout(500);
    const origin = new URL(page.url()).origin;
    const foreign = urls.filter(
      (u) =>
        !(
          u.startsWith(origin) ||
          u.startsWith("blob:") ||
          u.startsWith("data:")
        ),
    );
    expect(foreign).toEqual([]);
  });

  test("a multi-page export shows a busy notice", async ({ page }) => {
    await seedAndOpen(page, "Busy.excalidraw", {
      pageSetup: setupOf({ pageCount: 12 }),
      elements: content(60, 12),
    });
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as any).__alerts = seen;
      new MutationObserver(() => {
        document.querySelectorAll(".vd-toast").forEach((n) => {
          const t = n.textContent ?? "";
          if (t && seen[seen.length - 1] !== t) {
            seen.push(t);
          }
        });
      }).observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    });
    const before = await exportedCount(page);
    await runCommand(page, "Export: PDF");
    await waitForExport(page, before, 120000);
    const seen: string[] = await page.evaluate(() => (window as any).__alerts);
    expect(
      seen.some((t) => /Exporting Busy\.excalidraw… page \d+ of 12/.test(t)),
    ).toBe(true);
    await expect(page.locator(".vd-toast")).toHaveCount(0);
  });

  test("export dialog: Page shape switch makes PNG/SVG page-shaped", async ({
    page,
  }) => {
    await seedAndOpen(page, "Shape.excalidraw", {
      pageSetup: setupOf({ pageCount: 2 }),
      elements: [rect("a", 100, 100)],
    });
    const size = async () =>
      page.evaluate(async () => {
        const f = (window as any).__vaultRepo.exported.at(-1);
        const bm = await createImageBitmap(
          new Blob([f.bytes], { type: "image/png" }),
        );
        return { w: bm.width, h: bm.height };
      });
    await openExportDialogFromMenu(page);
    const sw = page
      .locator(".ImageExportModal")
      .locator('input[name="exportPageShapedSwitch"]');
    await expect(sw).toBeVisible();
    if (await sw.isChecked()) {
      await sw.uncheck();
    }
    let n = await exportedCount(page);
    await exportDialogButton(page, "PNG").click();
    await waitForExport(page, n);
    const off = await size();
    await sw.check();
    n = await exportedCount(page);
    await exportDialogButton(page, "PNG").click();
    await waitForExport(page, n);
    const on = await size();
    expect(off.h).toBeLessThan(on.h / 3);
    expect(on.h / on.w).toBeGreaterThan(2.5); // two A4 pages and a gap
    expect(on.w / on.h).toBeLessThan(0.45);
  });

  test("first page of an export is saved for the visual check", async ({
    page,
  }) => {
    mkdirSync(PAGE_SHOTS, { recursive: true });
    await seedAndOpen(page, "Shot.excalidraw", {
      pageSetup: setupOf({ pageCount: 2, paperTheme: "oldSchool" }),
      appState: {
        viewBackgroundPattern: { type: "lines", spacing: 32, color: null },
      },
      elements: [
        rect("a", 80, 120, 300, 160),
        rect("b", 120, 500, 220, 120),
        rect("c", 100, 1250, 260, 140),
      ],
    });
    const file = await exportViaPalette(page);
    writeFileSync(`${PAGE_SHOTS}/export.pdf`, Buffer.from(file.bytes));
    expect(pdfInfo(file.bytes).pages).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Perf (E2E_PERF=1, Chromium): export time, longest task, JS heap peak.
// ---------------------------------------------------------------------------
const PERF = process.env.E2E_PERF === "1";
const OUT = process.env.PERF_OUT ?? "../.cache/perf-pdf-export.jsonl";

test.describe("PDF export perf", () => {
  test.skip(!PERF, "set E2E_PERF=1 (and run the chromium project)");
  test.describe.configure({ timeout: 900_000 });

  test("export time, longest task and heap peak for 1, 10 and 50 pages at 1x and 6x CPU", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "CDP throttling needs Chromium");
    await seed(page, "stub.excalidraw"); // keep the navigator warm
    let cdp: CDPSession | null = null;
    const throttle = async (rate: number) => {
      cdp ??= await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    };
    const rows: Record<string, unknown>[] = [];
    for (const pages of [1, 10, 50]) {
      const name = `Perf${pages}`;
      await seedAndOpen(page, `${name}.excalidraw`, {
        pageSetup: setupOf({ pageCount: pages }),
        elements: dense(pages),
        appState: {
          viewBackgroundPattern: { type: "lines", spacing: 32, color: null },
        },
      });
      for (const rate of [1, 6]) {
        if (pages === 50 && rate === 6 && process.env.PERF_SKIP_50_6X) {
          continue;
        }
        await throttle(rate);
        await page.evaluate(() => {
          const w = window as any;
          w.__t = { t0: 0, t1: 0, long: [] as number[], heap: [] as number[] };
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) {
              w.__t.long.push(e.duration);
            }
          }).observe({ entryTypes: ["longtask"] });
          const repo = w.__vaultRepo;
          const orig = repo.exportFile.bind(repo);
          repo.exportFile = (n: string, b: Uint8Array) => {
            w.__t.t1 = performance.now();
            clearInterval(w.__t.timer);
            return orig(n, b);
          };
          w.__t.timer = setInterval(
            () => w.__t.heap.push((performance as any).memory.usedJSHeapSize),
            5,
          );
        });
        const palette = page.getByRole("dialog", { name: "Command palette" });
        await page.keyboard.press("Meta+Shift+KeyP");
        await page.keyboard.type("Export: PDF");
        await expect(palette.getByRole("option").first()).toContainText(
          "Export: PDF",
        );
        const before = await exportedCount(page);
        const cdpHeap: number[] = [];
        const session = cdp!;
        let polling = true;
        const poll = (async () => {
          while (polling) {
            const usage = await session.send("Runtime.getHeapUsage");
            cdpHeap.push(usage.usedSize);
            await new Promise((r) => setTimeout(r, 50));
          }
        })();
        await page.evaluate(() => ((window as any).__t.t0 = performance.now()));
        await page.keyboard.press("Enter");
        const file = await waitForExport(page, before, 800_000);
        polling = false;
        await poll;
        await throttle(1);
        const t = await page.evaluate(() => {
          const w = window as any;
          return {
            ms: w.__t.t1 - w.__t.t0,
            longest: Math.max(0, ...w.__t.long),
            longCount: w.__t.long.length,
            heapPeakMB: Math.max(0, ...w.__t.heap) / 1048576,
            heapStartMB: (w.__t.heap[0] ?? 0) / 1048576,
          };
        });
        const info = pdfInfo(file.bytes);
        expect(info.pages).toBe(pages);
        const row = {
          test: "pdf-export",
          pages,
          rate,
          ms: Math.round(t.ms),
          msPerPage: Math.round(t.ms / pages),
          longestTaskMs: Math.round(t.longest),
          longTasks: t.longCount,
          heapStartMB: +t.heapStartMB.toFixed(1),
          heapPeakMB: +Math.max(
            t.heapPeakMB,
            Math.max(0, ...cdpHeap) / 1048576,
          ).toFixed(1),
          heapSamples: cdpHeap.length,
          pdfMB: +(info.size / 1048576).toFixed(2),
        };
        rows.push(row);
        appendFileSync(OUT, `${JSON.stringify(row)}\n`);
        // eslint-disable-next-line no-console
        console.log(`PERF ${JSON.stringify(row)}`);
      }
    }
    expect(rows.length).toBeGreaterThan(0);
  });
});
