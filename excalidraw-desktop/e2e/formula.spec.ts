/* eslint-disable no-eval -- evaluates appHandle (a string) in the page to reach the editor instance */
import { expect, test } from "@playwright/test";

import { AFTER_AUTOSAVE_MS } from "./constants";
import {
  exportDialogButton,
  exportedNames,
  openExportDialogFromMenu,
  readScene,
  trackErrors,
} from "./helpers";
import {
  focusCanvas,
  pixelAtClient,
  runCommand,
  toClient,
} from "./pageHelpers";
import {
  SRC,
  appHandle,
  centreOf,
  confirmKey,
  dblclickElement,
  decodeSvg,
  dialog,
  images,
  inkPixels,
  insertViaPalette,
  lastExport,
  openEmpty,
  preview,
  previewSrc,
  scene,
  source,
} from "./formulaHelpers";

// LaTeX formulas: insert, edit, undo, persistence, dark theme, perf.

test.describe("formula", () => {
  test("palette insert, shortcut insert with $$, error, edit, undo", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openEmpty(page);

    // 1. palette insert
    await runCommand(page, "Formula: Insert formula");
    await expect(dialog(page)).toBeVisible();
    await source(page).fill(SRC);
    await expect(preview(page)).toBeVisible();
    await confirmKey(page);
    await expect(dialog(page)).toHaveCount(0);
    await expect.poll(async () => (await images(page)).length).toBe(1);
    let s = await scene(page);
    const el1 = s.elements[0];
    expect(el1.customData.latex.source).toBe(SRC);
    expect(el1.customData.latex.display).toBe(true);
    const file = s.files[el1.fileId];
    expect(file.mimeType).toBe("image/svg+xml");
    expect(file.dataURL.startsWith("data:image/svg+xml;base64")).toBe(true);
    const svg = decodeSvg(file.dataURL);
    expect(svg).toContain("<path");
    expect(svg).not.toMatch(/foreignObject|<script/i);
    expect(el1.width).toBeGreaterThan(0);
    expect(el1.height).toBeGreaterThan(0);
    expect(s.selected).toEqual([el1.id]);

    // 2. shortcut + $$ delimiters
    await page.keyboard.press("Escape");
    await focusCanvas(page);
    await page.keyboard.press("ControlOrMeta+Shift+KeyM");
    await expect(dialog(page)).toBeVisible();
    await source(page).fill("$$a^2+b^2=c^2$$");
    await expect(preview(page)).toBeVisible();
    await confirmKey(page);
    await expect.poll(async () => (await images(page)).length).toBe(2);
    s = await scene(page);
    const el2 = s.elements.find((e) => e.id !== el1.id)!;
    expect(el2.customData.latex.display).toBe(true);
    expect(el2.customData.latex.source).toBe("a^2+b^2=c^2");

    // 3. error state; Escape inserts nothing
    await focusCanvas(page);
    await runCommand(page, "Formula: Insert formula");
    await source(page).fill(String.raw`\frac{`);
    await expect(dialog(page).getByRole("alert")).toBeVisible();
    await expect(
      dialog(page).getByRole("button", { name: "Insert" }),
    ).toBeDisabled();
    await confirmKey(page);
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    expect((await images(page)).length).toBe(2);

    // 4. edit by double-click
    await focusCanvas(page);
    // move el2 away from el1 (both are at the view centre): use el1 only via a fresh scene lookup
    s = await scene(page);
    // el1 and el2 overlap; delete el2 first so the double-click hits el1
    await page.evaluate(
      ([code, id]) => {
        const app = (0, eval)(code as string);
        app.updateScene({
          elements: app.scene
            .getElementsIncludingDeleted()
            .map((e: any) => (e.id === id ? { ...e, isDeleted: true } : e)),
        });
      },
      [appHandle, el2.id] as const,
    );
    await expect.poll(async () => (await images(page)).length).toBe(1);
    await focusCanvas(page);
    const before = (await images(page))[0];
    const c0 = centreOf(before);
    await dblclickElement(page, before);
    await expect(dialog(page)).toBeVisible();
    await expect(source(page)).toHaveValue(SRC);
    await source(page).fill(String.raw`\sum_{n=1}^{\infty} \frac1{n^2}`);
    await expect(preview(page)).toBeVisible();
    await expect
      .poll(async () => (await previewSrc(page))?.length ?? 0)
      .toBeGreaterThan(0);
    await page.waitForTimeout(400);
    await confirmKey(page);
    await expect(dialog(page)).toHaveCount(0);
    await expect
      .poll(async () => (await images(page))[0].fileId)
      .not.toBe(before.fileId);
    s = await scene(page);
    const after = s.elements.find((e) => e.type === "image")!;
    expect(after.id).toBe(before.id);
    expect(after.customData.latex.source).toBe(
      String.raw`\sum_{n=1}^{\infty} \frac1{n^2}`,
    );
    const c1 = centreOf(after);
    expect(Math.abs(c1.x - c0.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(c1.y - c0.y)).toBeLessThanOrEqual(1);
    expect(s.croppingElementId).toBeNull();

    // undo restores in one step
    // (no focusCanvas click here: deselecting is itself an undo entry)
    await page.keyboard.press("ControlOrMeta+KeyZ");
    await expect
      .poll(async () => (await images(page))[0]?.fileId)
      .toBe(before.fileId);
    const undone = (await images(page))[0];
    expect(undone.customData.latex.source).toBe(SRC);

    // 6. persistence
    await page.waitForTimeout(AFTER_AUTOSAVE_MS + 300);
    const saved = await readScene(page, "Formula.excalidraw");
    const savedImg = saved.elements.find(
      (e: any) => e.type === "image" && !e.isDeleted,
    );
    expect(savedImg.customData.latex.source).toBe(SRC);
    expect(saved.files[savedImg.fileId].mimeType).toBe("image/svg+xml");

    expect(errors).toEqual([]);
  });

  test("Enter and the Edit command open the edit dialog; dark theme; plain image still crops", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openEmpty(page, "Formula2.excalidraw");
    await insertViaPalette(page, String.raw`E=mc^2`);
    // element is selected: Enter opens edit
    await focusCanvas(page);
    const el = (await images(page))[0];
    await page.evaluate(
      ([code, id]) => {
        const app = (0, eval)(code as string);
        app.setState({ selectedElementIds: { [id as string]: true } });
      },
      [appHandle, el.id] as const,
    );
    // setState commits asynchronously: on a loaded machine Enter can arrive
    // before the selection exists, so wait for it.
    await expect
      .poll(async () => (await scene(page)).selected)
      .toEqual([el.id]);
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toBeVisible();
    await expect(source(page)).toHaveValue("E=mc^2");
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    expect((await scene(page)).croppingElementId).toBeNull();

    // Edit command
    await runCommand(page, "Formula: Edit formula");
    await expect(dialog(page)).toBeVisible();
    await expect(source(page)).toHaveValue("E=mc^2");
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);

    // dark theme
    await runCommand(page, "Mode: Dark");
    await expect(page.locator(".excalidraw.theme--dark").first()).toBeVisible();
    await page.waitForTimeout(500);
    const c = centreOf(el);
    const p = await toClient(page, c.x, c.y);
    // Light-on-dark: some pixel in the formula's box is brighter than the dark background.
    const bg = await pixelAtClient(page, p.x - el.width, p.y);
    let brightest = 0;
    for (let dx = -el.width / 2; dx <= el.width / 2; dx += 1) {
      for (const dy of [-4, 0, 4]) {
        const px = await pixelAtClient(page, p.x + dx, p.y + dy);
        brightest = Math.max(brightest, px[0] + px[1] + px[2]);
      }
    }
    expect(brightest).toBeGreaterThan(bg[0] + bg[1] + bg[2] + 150);
    await runCommand(page, "Mode: Light");

    // plain svg image: double-click enters crop mode
    await page.evaluate(
      ([code]) => {
        const app = (0, eval)(code as string);
        const svg =
          '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80" fill="#c00"/></svg>';
        const fileId = "plainsvg0000000000000000000000000000000001";
        app.addFiles([
          {
            id: fileId,
            mimeType: "image/svg+xml",
            dataURL: `data:image/svg+xml;base64,${btoa(svg)}`,
            created: Date.now(),
          },
        ]);
        const base = app.scene.getNonDeletedElements()[0];
        app.updateScene({
          elements: [
            ...app.scene.getElementsIncludingDeleted(),
            {
              ...base,
              id: "plainimg",
              fileId,
              x: base.x + 400,
              y: base.y + 200,
              width: 160,
              height: 100,
              customData: undefined,
              versionNonce: 12345,
            },
          ],
        });
      },
      [appHandle] as const,
    );
    await page.waitForTimeout(500);
    await focusCanvas(page);
    const plain = (await images(page)).find((e) => e.id === "plainimg")!;
    await dblclickElement(page, plain);
    await expect
      .poll(async () => (await scene(page)).croppingElementId)
      .toBe("plainimg");
    await expect(dialog(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("export: PNG has formula ink, SVG embeds the svg dataURL, PDF is valid", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openEmpty(page, "FormulaExport.excalidraw");
    await insertViaPalette(page, SRC);
    await page.waitForTimeout(300);

    await openExportDialogFromMenu(page);
    await exportDialogButton(page, "PNG").click();
    await expect
      .poll(() => exportedNames(page), { timeout: 15000 })
      .toContain("FormulaExport.png");
    await exportDialogButton(page, "SVG").click();
    await expect
      .poll(() => exportedNames(page), { timeout: 15000 })
      .toContain("FormulaExport.svg");
    await page.keyboard.press("Escape");

    const exported = await page.evaluate(() =>
      (window as any).__vaultRepo.exported.map((e: any) => ({
        name: e.name as string,
        bytes: Array.from(e.bytes as Uint8Array),
      })),
    );
    const pngBytes = exported.find((e: any) => e.name === "FormulaExport.png")
      .bytes as number[];
    expect(pngBytes.slice(0, 4)).toEqual([137, 80, 78, 71]);
    const ink = await page.evaluate(async (bytes) => {
      const bmp = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: "image/png" }),
      );
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let dark = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 200 && d[i] + d[i + 1] + d[i + 2] < 300) {
          dark++;
        }
      }
      return { dark, w: c.width, h: c.height };
    }, pngBytes);
    // the formula's glyphs are dark ink on the white export background
    expect(ink.dark).toBeGreaterThan(50);
    expect(ink.dark).toBeLessThan(ink.w * ink.h * 0.6);

    const svgText = Buffer.from(
      exported.find((e: any) => e.name === "FormulaExport.svg")
        .bytes as number[],
    ).toString("utf8");
    const m =
      /<image[^>]*href="(data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+)"/.exec(
        svgText,
      );
    expect(m, "exported svg has an <image> with an svg dataURL").not.toBeNull();
    const inner = decodeSvg(m![1]);
    expect(inner).toContain("<svg");
    expect(inner).toContain("<path");

    const before = await page.evaluate(
      () => (window as any).__vaultRepo.exported.length as number,
    );
    await focusCanvas(page);
    await runCommand(page, "Export: PDF");
    await expect
      .poll(
        () =>
          page.evaluate(
            () => (window as any).__vaultRepo.exported.length as number,
          ),
        { timeout: 30000 },
      )
      .toBe(before + 1);
    const pdf = await lastExport(page);
    const txt = Buffer.from(pdf.bytes).toString("latin1");
    expect(txt.startsWith("%PDF-")).toBe(true);
    expect(txt.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(pdf.bytes.length).toBeGreaterThan(1500);
    // the page is one raster (JPEG) image
    expect(txt).toContain("/DCTDecode");
    expect(errors).toEqual([]);
  });

  test("search finds the drawing by the formula's LaTeX source", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openEmpty(page, "FormulaSearch.excalidraw");
    await insertViaPalette(page, String.raw`\zeta_{quark} = mc^2`);
    await page.waitForTimeout(AFTER_AUTOSAVE_MS + 500);
    const box = page.getByPlaceholder("Search drawings and text…");
    await box.fill("quark");
    await expect(
      page
        .locator('.vault-search-row[data-kind="drawing"]')
        .filter({ hasText: "FormulaSearch" }),
    ).toBeVisible();
    await expect(
      page.locator('.vault-search-row[data-kind="snippet"]').first(),
    ).toContainText("quark");
    await box.fill("mc^2");
    await expect(
      page
        .locator('.vault-search-row[data-kind="drawing"]')
        .filter({ hasText: "FormulaSearch" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("dark theme keeps a red formula red (no cyan hue flip)", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openEmpty(page, "FormulaRed.excalidraw");
    await page.evaluate(
      ([code]) => {
        (0, eval)(code as string).setState({
          currentItemStrokeColor: "#e03131",
        });
      },
      [appHandle] as const,
    );
    await insertViaPalette(page, String.raw`\int_0^1 x^2\,dx`);
    await page.waitForTimeout(300);
    const el = (await images(page))[0];
    // deselect so no selection chrome overlaps (it lives on another canvas anyway)
    expect(el.customData.latex.color).toBe("#e03131");
    // The SVG decodes asynchronously: poll until the image (not its placeholder) is painted.
    await expect
      .poll(async () => {
        const ink = await inkPixels(page, el);
        const red = ink.filter((p) => p[0] > p[1] && p[0] > p[2]).length;
        return ink.length > 30 && red > ink.length * 0.8;
      })
      .toBe(true);

    await runCommand(page, "Mode: Dark");
    await expect(page.locator(".excalidraw.theme--dark").first()).toBeVisible();
    await page.waitForTimeout(600);
    const ink = await inkPixels(page, el, 120);
    expect(ink.length).toBeGreaterThan(30);
    // the most visible (strongest) pixels stay red-dominant, not cyan
    const strongest = [...ink]
      .sort(
        (a, b) =>
          Math.abs(b[0] - b[1]) +
          Math.abs(b[0] - b[2]) -
          (Math.abs(a[0] - a[1]) + Math.abs(a[0] - a[2])),
      )
      .slice(0, Math.max(10, Math.floor(ink.length / 3)));
    const redish = strongest.filter((p) => p[0] > p[1] && p[0] > p[2]).length;
    expect(redish).toBeGreaterThan(strongest.length * 0.8);
    await runCommand(page, "Mode: Light");
    expect(errors).toEqual([]);
  });

  test("no loading placeholder shortly after insert", async ({ page }) => {
    const errors = trackErrors(page);
    await openEmpty(page, "FormulaPlaceholder.excalidraw");
    await insertViaPalette(page, SRC);
    // Wait on the condition, not a timer (a fixed 150 ms flaked under load): the image is cached
    // and saved/inline right after insert, and the first paint shows ink, not the placeholder.
    // The bound stays short (well under an async SVG decode + autosave round trip).
    await expect.poll(async () => (await images(page)).length).toBe(1);
    const el = (await images(page))[0];
    await expect
      .poll(
        () =>
          page.evaluate(
            ([code, fileId]) => {
              const app = (0, eval)(code as string);
              const file = app.files[fileId as string];
              const status = file?.status ?? null;
              return (
                app.imageCache.has(fileId) &&
                (status === "saved" || status === null)
              );
            },
            [appHandle, el.fileId] as const,
          ),
        { timeout: 2000 },
      )
      .toBe(true);
    await expect
      .poll(async () => (await inkPixels(page, el)).length, { timeout: 2000 })
      .toBeGreaterThan(30);
    expect(errors).toEqual([]);
  });

  test("double-click does not open the dialog in view mode or on a locked formula", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openEmpty(page, "FormulaGuards.excalidraw");
    await insertViaPalette(page, SRC);
    await focusCanvas(page);
    await page.waitForTimeout(200);
    const el = (await images(page))[0];

    // view mode
    await page.evaluate(
      ([code]) => {
        (0, eval)(code as string).setState({ viewModeEnabled: true });
      },
      [appHandle] as const,
    );
    await dblclickElement(page, el);
    await page.waitForTimeout(500);
    await expect(dialog(page)).toHaveCount(0);
    await page.evaluate(
      ([code]) => {
        (0, eval)(code as string).setState({ viewModeEnabled: false });
      },
      [appHandle] as const,
    );

    // locked
    await page.evaluate(
      ([code, id]) => {
        const app = (0, eval)(code as string);
        app.updateScene({
          elements: app.scene
            .getElementsIncludingDeleted()
            .map((e: any) => (e.id === id ? { ...e, locked: true } : e)),
        });
      },
      [appHandle, el.id] as const,
    );
    await expect
      .poll(async () => (await images(page))[0].customData?.latex?.source)
      .toBe(SRC);
    await dblclickElement(page, el);
    await page.waitForTimeout(500);
    await expect(dialog(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
