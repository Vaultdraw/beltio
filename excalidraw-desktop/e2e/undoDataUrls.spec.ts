import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { canvasBox, openDrawing, openVault, readScene } from "./helpers";

// Images no element and no undo step can bring back are released from memory.
// Clicks only: lower "Undo steps kept per drawing" in Settings, delete three
// of four large images with the Delete button, draw rectangles to push the
// deletions past the undo horizon, then check that the three files left the
// editor while the fourth stayed and the saved drawing did not change.
// Logs `PERF {json}` (file bytes, JS heap in Chromium after GC) for REPORT.md.

test.describe.configure({ timeout: 120_000 });

const IMAGES = 4;
const SIDE = 1000; // noise PNG of about 3-4 MB each

/** Incompressible PNG dataURLs, built in the page. */
const makeImages = (page: Page) =>
  page.evaluate(
    ([n, side]) => {
      const out: string[] = [];
      for (let k = 0; k < n; k++) {
        const c = document.createElement("canvas");
        c.width = c.height = side;
        const ctx = c.getContext("2d")!;
        const data = ctx.createImageData(side, side);
        for (let i = 0; i < data.data.length; i += 4) {
          data.data[i] = (Math.random() * 256) | 0;
          data.data[i + 1] = (Math.random() * 256) | 0;
          data.data[i + 2] = (Math.random() * 256) | 0;
          data.data[i + 3] = 255;
        }
        ctx.putImageData(data, 0, 0);
        out.push(c.toDataURL("image/png"));
      }
      return out;
    },
    [IMAGES, SIDE] as const,
  );

const seedImages = (page: Page, urls: string[]) =>
  page.evaluate((dataURLs) => {
    const repo = (window as any).__vaultRepo;
    const files: Record<string, unknown> = {};
    const elements = dataURLs.map((dataURL, i) => {
      files[`img${i}`] = {
        id: `img${i}`,
        mimeType: "image/png",
        dataURL,
        created: 1,
      };
      return {
        id: `el${i}`,
        type: "image",
        fileId: `img${i}`,
        status: "saved",
        scale: [1, 1],
        x: 80 + i * 240,
        y: 120,
        width: 200,
        height: 200,
        angle: 0,
        strokeColor: "transparent",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 0,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: null,
        boundElements: null,
        link: null,
        locked: false,
        isDeleted: false,
      };
    });
    repo.seedDrawing(
      "Images.excalidraw",
      JSON.stringify({
        type: "excalidraw",
        version: 2,
        elements,
        appState: { viewBackgroundColor: "#ffffff" },
        files,
      }),
    );
    repo.emit({ handle: repo.handle, paths: [], rescan: true });
  }, urls);

/** The editor instance's files (ids, dataURL characters) and undo depth. */
const editorState = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector(".vault-editor canvas.interactive")!;
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"))!;
    let fiber = (el as any)[key];
    while (fiber) {
      const s = fiber.stateNode;
      if (s && s.files && s.scene && s.history) {
        const ids = Object.keys(s.files).sort();
        return {
          ids,
          chars: ids.reduce(
            (n: number, id: string) => n + s.files[id].dataURL.length,
            0,
          ),
          undoDepth: s.history.undoStack.length as number,
          cached: s.imageCache.size as number,
        };
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

test("images only deleted undo steps could restore are released from memory", async ({
  page,
  browserName,
}) => {
  await openVault(page);
  await seedImages(page, await makeImages(page));
  await openDrawing(page, "Images");
  await expect
    .poll(async () => (await editorState(page)).cached, { timeout: 30_000 })
    .toBe(IMAGES);

  // Settings (click): undo steps kept per drawing -> the minimum
  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const settings = page.getByRole("dialog");
  await settings.getByRole("tab", { name: "Interface" }).click();
  const steps = settings.getByRole("spinbutton", {
    name: "Undo steps kept per drawing",
  });
  await steps.scrollIntoViewIfNeeded();
  await steps.focus();
  await page.keyboard.press("Home");
  await expect(steps).toHaveAttribute("aria-valuenow", "10");
  await settings.getByRole("button", { name: "Close settings" }).click();
  await expect(settings).toHaveCount(0);

  const before = await editorState(page);
  expect(before.ids).toHaveLength(IMAGES);
  const heapBefore = browserName === "chromium" ? await heapMb(page) : null;
  const savedBefore = JSON.stringify(
    await readScene(page, "Images.excalidraw"),
  );

  // delete images 1..3 with the Delete button
  const box = await canvasBox(page);
  for (let i = 1; i < IMAGES; i++) {
    await page.mouse.click(box.x + 80 + i * 240 + 100, box.y + 120 + 100);
    await page
      .locator(".vault-editor")
      .getByRole("button", { name: "Delete", exact: true })
      .first()
      .click();
  }
  // still reachable: three undo steps hold them
  expect((await editorState(page)).ids).toHaveLength(IMAGES);

  // push the deletions past the 10-step horizon with rectangles
  for (let i = 0; i < 12; i++) {
    await page
      .locator(".vault-editor [data-testid='toolbar-rectangle']")
      .click();
    const x0 = box.x + 80 + (i % 4) * 90;
    const y0 = box.y + 400 + Math.floor(i / 4) * 60;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 + 50, y0 + 30, { steps: 3 });
    await page.mouse.up();
    await page.keyboard.press("1");
  }
  await expect
    .poll(async () => (await editorState(page)).undoDepth, { timeout: 5_000 })
    .toBeGreaterThan(10);

  // idle passes: trim the horizon, probation, release
  await expect
    .poll(async () => (await editorState(page)).ids, {
      timeout: 60_000,
      intervals: [1_000],
    })
    .toEqual(["img0"]);
  const after = await editorState(page);
  expect(after.undoDepth).toBeLessThanOrEqual(10);
  expect(after.chars).toBeLessThan(before.chars / 3);
  const heapAfter = browserName === "chromium" ? await heapMb(page) : null;

  // the surviving image still shows, and the saved drawing keeps exactly it
  await expect.poll(async () => (await editorState(page)).cached).toBe(1);
  const saved = await readScene(page, "Images.excalidraw");
  expect(Object.keys(saved.files)).toEqual(["img0"]);
  expect(saved.files.img0.dataURL).toBe(
    JSON.parse(savedBefore).files.img0.dataURL,
  );

  // eslint-disable-next-line no-console
  console.log(
    `PERF ${JSON.stringify({
      test: "undoDataUrls",
      images: IMAGES,
      fileMBBefore: +(before.chars / 1048576).toFixed(1),
      fileMBAfter: +(after.chars / 1048576).toFixed(1),
      heapMbBefore: heapBefore,
      heapMbAfter: heapAfter,
    })}`,
  );
});
