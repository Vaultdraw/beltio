/* eslint-disable no-eval -- evaluates appHandle (a string) in the page to reach the editor instance */
import { expect, type Page } from "@playwright/test";

import { openVault } from "./helpers";
import { focusCanvas, runCommand, toClient } from "./pageHelpers";

// Shared by formula.spec.ts and formulaPerf.spec.ts.

export const SRC = String.raw`\int_0^1 x^2\,dx`;

/** The editor's App instance (found through React's fibers). */
export const appHandle = `(() => {
  const el = document.querySelector(".vault-editor canvas.interactive");
  const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"));
  let fiber = el[key];
  while (fiber) {
    const s = fiber.stateNode;
    if (s && s.state && s.scene && typeof s.state.scrollX === "number" && "zoom" in s.state) return s;
    fiber = fiber.return;
  }
  throw new Error("editor instance not found");
})()`;

export type Img = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fileId: string;
  customData: any;
  crop: unknown;
};

export const scene = (page: Page) =>
  page.evaluate((code) => {
    const app = (0, eval)(code);
    const els = app.scene.getNonDeletedElements();
    return {
      elements: els.map((e: any) => ({
        id: e.id,
        type: e.type,
        x: e.x,
        y: e.y,
        width: e.width,
        height: e.height,
        fileId: e.fileId,
        customData: e.customData,
        crop: e.crop ?? null,
      })) as Img[],
      files: JSON.parse(JSON.stringify(app.files)) as Record<string, any>,
      selected: Object.keys(app.state.selectedElementIds).filter(
        (k) => app.state.selectedElementIds[k],
      ),
      croppingElementId: app.state.croppingElementId ?? null,
    };
  }, appHandle);

export const images = async (page: Page) =>
  (await scene(page)).elements.filter((e) => e.type === "image");

export const decodeSvg = (dataURL: string) =>
  Buffer.from(dataURL.split(",")[1], "base64").toString("utf8");

export const dialog = (page: Page) =>
  page.getByRole("dialog", { name: /formula/i });
export const preview = (page: Page) =>
  dialog(page).getByRole("img", { name: "Formula preview" });
export const source = (page: Page) => dialog(page).getByLabel("LaTeX");

export const previewSrc = (page: Page) => preview(page).getAttribute("src");

export const confirmKey = (page: Page) => page.keyboard.press("Meta+Enter");

export const insertViaPalette = async (page: Page, tex: string) => {
  await runCommand(page, "Formula: Insert formula");
  await expect(dialog(page)).toBeVisible();
  await source(page).fill(tex);
  await expect(preview(page)).toBeVisible();
  await confirmKey(page);
  await expect(dialog(page)).toHaveCount(0);
  await expect.poll(async () => (await images(page)).length).toBeGreaterThan(0);
};

export const centreOf = (e: Img) => ({
  x: e.x + e.width / 2,
  y: e.y + e.height / 2,
});

export const openEmpty = async (
  page: Page,
  name = "Formula.excalidraw",
  appState: Record<string, unknown> = {},
) => {
  await openVault(page);
  await page.evaluate(
    ([n, st]) => {
      const repo = (window as any).__vaultRepo;
      repo.seedDrawing(
        n,
        JSON.stringify({
          type: "excalidraw",
          version: 2,
          elements: [],
          appState: { viewBackgroundColor: "#ffffff", ...st },
          files: {},
        }),
      );
      repo.emit({ handle: repo.handle, paths: [], rescan: true });
    },
    [name, appState] as const,
  );
  await page
    .locator(".vault-tree-item__name", {
      hasText: name.replace(/\.excalidraw$/, ""),
    })
    .first()
    .click();
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  await page.waitForTimeout(600);
  await focusCanvas(page);
};

export const dblclickElement = async (page: Page, e: Img) => {
  const c = centreOf(e);
  const p = await toClient(page, c.x, c.y);
  await page.mouse.dblclick(p.x, p.y);
};

/** RGBA of a static-canvas corner pixel (the painted background). */
export const canvasCorner = (page: Page) =>
  page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>(
      ".vault-editor canvas.static",
    )!;
    return Array.from(c.getContext("2d")!.getImageData(2, 2, 1, 1).data);
  });

const luma = ([r, g, b]: number[]) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * True once the background is painted opaque and darker than `before` (the
 * corner read before switching to dark): an unpainted, transparent canvas
 * (0,0,0,0) does not count.
 */
export const repaintedDarker = async (page: Page, before: number[]) => {
  const now = await canvasCorner(page);
  return now[3] === 255 && luma(now) < 128 && luma(now) < luma(before);
};

/** Non-background pixels (by sum distance from the corner pixel) in the element's box on the static canvas. */
export const inkPixels = async (page: Page, el: Img, minDiff = 90) => {
  const b = await clientBox(page, el);
  return page.evaluate(
    ([x, y, w, h, diff]) => {
      const c = document.querySelector<HTMLCanvasElement>(
        ".vault-editor canvas.static",
      )!;
      const r = c.getBoundingClientRect();
      const k = c.width / r.width;
      const px = Math.max(0, Math.round((x - r.left) * k));
      const py = Math.max(0, Math.round((y - r.top) * k));
      const pw = Math.min(c.width - px, Math.round(w * k));
      const ph = Math.min(c.height - py, Math.round(h * k));
      const d = c.getContext("2d")!.getImageData(px, py, pw, ph).data;
      const bg = [d[0], d[1], d[2]];
      const out: number[][] = [];
      for (let i = 0; i < d.length; i += 4) {
        const diffSum =
          Math.abs(d[i] - bg[0]) +
          Math.abs(d[i + 1] - bg[1]) +
          Math.abs(d[i + 2] - bg[2]);
        if (diffSum >= diff) {
          out.push([d[i], d[i + 1], d[i + 2]]);
        }
      }
      return out;
    },
    [b.x, b.y, b.w, b.h, minDiff] as [number, number, number, number, number],
  );
};

const clientBox = async (page: Page, el: Img) => {
  const a = await toClient(page, el.x, el.y);
  const b = await toClient(page, el.x + el.width, el.y + el.height);
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
};

/** The bytes of the most recent exported file. */
export const lastExport = (page: Page) =>
  page.evaluate(() => {
    const files = (window as any).__vaultRepo.exported;
    const last = files[files.length - 1];
    return {
      name: last.name as string,
      bytes: Array.from(last.bytes as Uint8Array),
    };
  });
