import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import {
  closeTopDialog,
  exportDialogButton,
  exportedNames,
  openDrawing,
  openExportDialogFromMenu,
  openVault,
  readScene,
  trackErrors,
} from "./helpers";

const GRAPHS = "DSA/Graphs.excalidraw";

const dialog = (page: Page) => page.locator(".ImageExportModal");

const liveCount = async (page: Page, path: string) =>
  (await readScene(page, path)).elements.filter((e: any) => !e.isDeleted)
    .length;

test.beforeEach(async ({ page }) => {
  await openVault(page);
  // Seeded tree: DSA/ is collapsed.
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
});

/** Mermaid opens from the toolbar's "More tools" menu (not the main menu). */
const openMermaidFromToolbar = async (page: Page) => {
  await page.locator(".App-toolbar__extra-tools-trigger").click();
  await page.getByRole("menuitem", { name: "Mermaid to Excalidraw" }).click();
};

test("1. main menu offers Export image and Save a copy; Mermaid is in the toolbar only", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.getByTestId("main-menu-trigger").click();
  const items = await page.getByRole("menuitem").allTextContents();
  const labels = items.map((t) => t.trim());
  expect(labels.some((l) => l.startsWith("Export image"))).toBe(true);
  expect(labels).toContain("Save a copy…");
  expect(labels).not.toContain("Insert Mermaid diagram…");
  expect(labels.some((l) => /^Export as (PNG|SVG)/.test(l))).toBe(false);
  expect(errors).toEqual([]);
});

test("2. dialog PNG and SVG buttons export with the right file names", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openExportDialogFromMenu(page);
  // The host names the file: no file name input.
  await expect(dialog(page).locator("input.TextInput")).toHaveCount(0);

  await exportDialogButton(page, "PNG").click();
  await expect
    .poll(() => exportedNames(page), { timeout: 15000 })
    .toContain("Graphs.png");
  await exportDialogButton(page, "SVG").click();
  await expect
    .poll(() => exportedNames(page), { timeout: 15000 })
    .toContain("Graphs.svg");

  const exported = await page.evaluate(() =>
    (window as any).__vaultRepo.exported.map((e: any) => ({
      name: e.name as string,
      head: Array.from((e.bytes as Uint8Array).slice(0, 4)),
      size: (e.bytes as Uint8Array).length,
    })),
  );
  const png = exported.find((e: any) => e.name === "Graphs.png");
  expect(png.head).toEqual([137, 80, 78, 71]);
  expect(png.size).toBeGreaterThan(100);
  const svg = exported.find((e: any) => e.name === "Graphs.svg");
  expect(svg.size).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test("3. embed scene names the file .excalidraw.png / .excalidraw.svg", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openExportDialogFromMenu(page);
  await dialog(page).locator('input[name="exportEmbedSwitch"]').check();
  await exportDialogButton(page, "PNG").click();
  await expect
    .poll(() => exportedNames(page), { timeout: 15000 })
    .toContain("Graphs.excalidraw.png");
  await exportDialogButton(page, "SVG").click();
  await expect
    .poll(() => exportedNames(page), { timeout: 15000 })
    .toContain("Graphs.excalidraw.svg");
  expect(errors).toEqual([]);
});

test("4. scale 3x gives a bigger PNG; transparent background has alpha 0", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openExportDialogFromMenu(page);
  // The default scale follows devicePixelRatio; start from an explicit 1x.
  await dialog(page)
    .locator('.RadioGroup__choice:has-text("1×") input')
    .check();
  await exportDialogButton(page, "PNG").click();
  await expect.poll(() => exportedNames(page)).toContain("Graphs.png");
  await dialog(page)
    .locator('.RadioGroup__choice:has-text("3×") input')
    .check();
  await dialog(page).locator('input[name="exportBackgroundSwitch"]').uncheck();
  await exportDialogButton(page, "PNG").click();
  await expect
    .poll(async () => (await exportedNames(page)).length)
    .toBeGreaterThanOrEqual(2);

  const result = await page.evaluate(async () => {
    const files = (window as any).__vaultRepo.exported as Array<{
      bytes: Uint8Array;
    }>;
    const decode = async (bytes: Uint8Array) => {
      const bitmap = await createImageBitmap(
        new Blob([bytes as BlobPart], { type: "image/png" }),
      );
      const c = document.createElement("canvas");
      c.width = bitmap.width;
      c.height = bitmap.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      return {
        w: bitmap.width,
        h: bitmap.height,
        alpha: ctx.getImageData(1, 1, 1, 1).data[3],
      };
    };
    return {
      first: await decode(files[0].bytes),
      second: await decode(files[1].bytes),
    };
  });
  expect(Math.abs(result.second.w - result.first.w * 3)).toBeLessThanOrEqual(6);
  expect(Math.abs(result.second.h - result.first.h * 3)).toBeLessThanOrEqual(6);
  expect(result.first.alpha).toBe(255);
  expect(result.second.alpha).toBe(0);
  expect(errors).toEqual([]);
});

test("5. export options persist across dialog reopen and drawing switch", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openExportDialogFromMenu(page);
  await dialog(page)
    .locator('.RadioGroup__choice:has-text("3×") input')
    .check();
  await dialog(page).locator('input[name="exportBackgroundSwitch"]').uncheck();
  await dialog(page).locator('input[name="exportEmbedSwitch"]').check();
  await closeTopDialog(page);

  await page
    .locator(".vault-tree-item__name", { hasText: "Dynamic Programming" })
    .first()
    .click();
  await openDrawing(page, "01 Introduction");
  await openExportDialogFromMenu(page);
  await expect(
    dialog(page).locator('.RadioGroup__choice:has-text("3×") input'),
  ).toBeChecked();
  await expect(
    dialog(page).locator('input[name="exportBackgroundSwitch"]'),
  ).not.toBeChecked();
  await expect(
    dialog(page).locator('input[name="exportEmbedSwitch"]'),
  ).toBeChecked();
  // and it is saved as the machine preference
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("excalidraw-vault-preferences-v1") ?? "{}"),
  );
  expect(stored.exportOptions).toEqual({
    scale: 3,
    background: false,
    embedScene: true,
    // paper pattern switch (F20): default on, remembered too
    pattern: true,
    // page shape switch (page mode): default off, remembered too
    pageShaped: false,
  });
  expect(errors).toEqual([]);
});

test("6. Copy PNG and Copy SVG use the web clipboard fallback outside Tauri", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.evaluate(() => {
    const calls: any[] = [];
    (window as any).__clipboardCalls = calls;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async (items: ClipboardItem[]) =>
          calls.push({ kind: "write", types: items.flatMap((i) => i.types) }),
        writeText: async (text: string) => calls.push({ kind: "text", text }),
      },
    });
  });
  await openExportDialogFromMenu(page);
  await exportDialogButton(page, "Copy PNG").click();
  await exportDialogButton(page, "Copy SVG").click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__clipboardCalls.length), {
      timeout: 15000,
    })
    .toBe(2);
  const calls = await page.evaluate(() => (window as any).__clipboardCalls);
  expect(calls[0]).toEqual({ kind: "write", types: ["image/png"] });
  expect(calls[1].kind).toBe("text");
  expect(calls[1].text).toContain("<svg");
  // Copying never writes a file.
  expect(await exportedNames(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("7. Insert Mermaid diagram converts and adds elements, no AI tab", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const before = await liveCount(page, GRAPHS);
  await openMermaidFromToolbar(page);
  const ttd = page.locator(".ttd-dialog");
  await expect(ttd).toBeVisible();
  await expect(ttd.getByRole("tab")).toHaveCount(0);
  await expect(ttd).not.toContainText("Text to diagram");
  await expect(
    ttd.locator(".ttd-dialog-output-canvas-content canvas"),
  ).toBeVisible({ timeout: 20000 });
  await ttd.getByRole("button", { name: "Insert", exact: true }).click();
  await expect(ttd).toHaveCount(0);
  await expect
    .poll(() => liveCount(page, GRAPHS), { timeout: 10000 })
    .toBeGreaterThan(before);
  expect(errors).toEqual([]);
});

test("8. Mermaid conversion of 200 nodes under 4x CPU throttling (Chromium)", async ({
  page,
  browserName,
}, info) => {
  test.skip(browserName !== "chromium", "CDP throttling is Chromium only");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const lines = ["flowchart TD"];
  for (let i = 1; i < 200; i += 1) {
    const p = Math.floor((i - 1) / 2);
    lines.push(`  N${p}[Node ${p}] --> N${i}[Node ${i}]`);
  }
  await openMermaidFromToolbar(page);
  const ttd = page.locator(".ttd-dialog");
  const canvasSel = ".ttd-dialog-output-canvas-content canvas";
  await expect(ttd.locator(canvasSel)).toBeVisible({ timeout: 40000 });
  const timing = await page.evaluate(
    async ({ text, sel }) => {
      // CodeMirror 6 (lazy chunk); the textarea only exists as a fallback.
      const content = document.querySelector<any>(".cm-content");
      // CodeMirror >= 6.39 stores the tile on `cmTile` (older: `cmView`).
      const view = content?.cmTile?.root?.view ?? content?.cmView?.view;
      const textarea = document.querySelector<HTMLTextAreaElement>(
        "textarea.ttd-dialog-input",
      );
      if (!view && !textarea) {
        throw new Error("Mermaid editor not found");
      }
      const before = document.querySelector(sel);
      let maxGap = 0;
      let last = performance.now();
      let stop = false;
      const beat = () => {
        const n = performance.now();
        maxGap = Math.max(maxGap, n - last);
        last = n;
        if (!stop) {
          setTimeout(beat, 0);
        }
      };
      setTimeout(beat, 0);
      const t0 = performance.now();
      if (view) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: text },
        });
      } else {
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )!.set!.call(textarea, text);
        textarea!.dispatchEvent(new Event("input", { bubbles: true }));
      }
      while (document.querySelector(sel) === before) {
        await new Promise((r) => setTimeout(r, 20));
        if (performance.now() - t0 > 120000) {
          break;
        }
      }
      stop = true;
      return {
        ms: Math.round(performance.now() - t0),
        longestBlockMs: Math.round(maxGap),
      };
    },
    { text: lines.join("\n"), sel: canvasSel },
  );
  // eslint-disable-next-line no-console
  console.log(
    `[perf] mermaid 200 nodes, CPU 4x throttled: ${JSON.stringify(timing)}`,
  );
  info.annotations.push({
    type: "mermaid-200-4x",
    description: JSON.stringify(timing),
  });
  expect(timing.ms).toBeLessThan(60000);
});
