import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitThumb, THUMB_BOX_CSS } from "./fit";
import {
  pngRenderVersion,
  RENDER_VERSION,
  THUMB_FILES_JSON_BYTES,
  THUMB_MAX_ELEMENTS,
  THUMB_MAX_JSON_BYTES,
  renderPng,
  renderScenePng,
  renderSceneToSvgDataUrl,
} from "./render";

const exportToCanvas = vi.fn();
const exportToSvg = vi.fn();
vi.mock("@excalidraw/excalidraw", () => ({ exportToCanvas, exportToSvg }));
vi.mock("../editor/canvasSync", () => ({
  withStandardCanvasColors: (task: () => Promise<unknown>) => task(),
  suspendCanvasSync: () => () => {},
}));

const scene = (n: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    elements: Array.from({ length: n }, (_, i) => ({ id: `e${i}` })),
    appState: { viewBackgroundColor: "#fff" },
    files: { f1: { dataURL: "data:x" } },
    ...extra,
  });

/** The scene's content canvas (what exportToCanvas returns). */
const contentCanvas = () => ({ width: 100, height: 50 } as any);

/** Box canvas created by renderScenePng; `type` is the blob type toBlob yields. */
let boxType = "image/png";
let box: any;
let ctx: any;
const realCreate = document.createElement.bind(document);

/** exportToCanvas mock: asks the renderer for dimensions like the real one. */
const exportsContent = (w = 200, h = 100) =>
  exportToCanvas.mockImplementation(async (opts: any) => {
    const dims = opts.getDimensions(w, h);
    return { ...contentCanvas(), dims };
  });

beforeEach(() => {
  exportToCanvas.mockReset();
  exportToSvg.mockReset();
  boxType = "image/png";
  ctx = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    if (tag !== "canvas") {
      return realCreate(tag);
    }
    box = {
      width: 0,
      height: 0,
      getContext: () => ctx,
      toBlob: (cb: (b: Blob | null) => void) =>
        cb(boxType ? new Blob([new Uint8Array([1])], { type: boxType }) : null),
    };
    return box;
  }) as any);
});

describe("renderScenePng slicing", () => {
  it("paints in slices (6 ms budget) unless the one-task reference is asked for", async () => {
    exportsContent();
    await renderScenePng(scene(3), 1);
    const sliced = exportToCanvas.mock.calls[0][0].slicing;
    expect(sliced.budgetMs).toBe(6);
    expect(typeof sliced.yieldFn).toBe("function");

    await renderPng(scene(3), 1, false);
    expect(exportToCanvas.mock.calls[1][0].slicing).toBeUndefined();
  });
});

describe("renderScenePng", () => {
  it("renders the whole scene into the 4:3 box at the density, centred, and frees both canvases", async () => {
    exportsContent(200, 100);
    const res = await renderScenePng(scene(3), 2);
    expect(res.kind).toBe("png");
    const arg = exportToCanvas.mock.calls[0][0];
    expect(arg.maxWidthOrHeight).toBeUndefined();
    expect(arg.exportPadding).toBe(0);
    expect(arg.appState.exportBackground).toBe(true);
    expect(arg.appState.exportWithDarkMode).toBe(false);
    expect(arg.files).toEqual({ f1: { dataURL: "data:x" } });
    const fit = fitThumb(200, 100, 2);
    const content = await exportToCanvas.mock.results[0].value;
    expect(content.dims).toEqual({
      width: fit.width,
      height: fit.height,
      scale: fit.scale,
    });
    // The PNG is the full box (box canvas released after encoding).
    expect(ctx.fillRect).toHaveBeenCalledWith(
      0,
      0,
      THUMB_BOX_CSS.width * 2,
      THUMB_BOX_CSS.height * 2,
    );
    expect(ctx.fillStyle).toBe("#fff");
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), fit.x, fit.y);
    expect(box.width).toBe(0);
  });

  it("defaults to density 1", async () => {
    exportsContent();
    await renderScenePng(scene(1));
    expect(ctx.fillRect).toHaveBeenCalledWith(
      0,
      0,
      THUMB_BOX_CSS.width,
      THUMB_BOX_CSS.height,
    );
  });

  it("fails without rendering for invalid, empty and over-cap scenes", async () => {
    expect(await renderScenePng("nope")).toEqual({
      kind: "fail",
      reason: "invalid",
    });
    expect(await renderScenePng(scene(0))).toEqual({
      kind: "fail",
      reason: "empty",
    });
    expect(await renderScenePng(scene(THUMB_MAX_ELEMENTS + 1))).toEqual({
      kind: "fail",
      reason: "too-many",
    });
    expect(
      await renderScenePng(scene(1, { pad: "x".repeat(THUMB_MAX_JSON_BYTES) })),
    ).toEqual({
      kind: "fail",
      reason: "too-large",
    });
    expect(exportToCanvas).not.toHaveBeenCalled();
  });

  it("renders drawings well over the old 600-element cap, time-sliced", async () => {
    expect(THUMB_MAX_ELEMENTS).toBeGreaterThanOrEqual(2500);
    exportsContent();
    const result = await renderScenePng(scene(2400), 2);
    expect(result.kind).toBe("png");
    const opts = exportToCanvas.mock.calls[0][0];
    expect(opts.elements).toHaveLength(2400);
    expect(opts.slicing.budgetMs).toBe(6);
  });

  it("stops after the parse when cancelled: no restore, no paint", async () => {
    exportsContent();
    expect(await renderScenePng(scene(10), 1, () => true)).toEqual({
      kind: "fail",
      reason: "cancelled",
    });
    expect(exportToCanvas).not.toHaveBeenCalled();
  });

  it("stops at a paint slice when cancelled mid-render", async () => {
    let stop = false;
    exportToCanvas.mockImplementation(async (opts: any) => {
      opts.getDimensions(10, 10);
      stop = true; // e.g. scrolled past while painting
      await opts.slicing.yieldFn();
      return contentCanvas();
    });
    expect(await renderScenePng(scene(10), 1, () => stop)).toEqual({
      kind: "fail",
      reason: "cancelled",
    });
  });

  it("drops embedded files above the files size limit", async () => {
    exportsContent();
    await renderScenePng(scene(1, { pad: "x".repeat(THUMB_FILES_JSON_BYTES) }));
    expect(exportToCanvas.mock.calls[0][0].files).toEqual({});
  });

  it("fails when the blob is not a PNG, there is no 2d context or the export throws", async () => {
    exportsContent();
    boxType = "image/webp";
    expect(await renderScenePng(scene(1))).toEqual({
      kind: "fail",
      reason: "encode",
    });
    boxType = "";
    expect(await renderScenePng(scene(1))).toEqual({
      kind: "fail",
      reason: "encode",
    });
    boxType = "image/png";
    ctx = null;
    expect(await renderScenePng(scene(1))).toEqual({
      kind: "fail",
      reason: "encode",
    });
    exportToCanvas.mockRejectedValueOnce(new Error("boom"));
    expect(await renderScenePng(scene(1))).toEqual({
      kind: "fail",
      reason: "error",
    });
  });
});

describe("renderSceneToSvgDataUrl", () => {
  it("keeps the old behaviour: null for invalid/empty, data URL otherwise", async () => {
    expect(await renderSceneToSvgDataUrl("x")).toBeNull();
    expect(await renderSceneToSvgDataUrl('{"elements":[]}')).toBeNull();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "480");
    svg.setAttribute("height", "240");
    exportToSvg.mockResolvedValue(svg);
    const url = await renderSceneToSvgDataUrl(scene(2));
    expect(url).toMatch(/^data:image\/svg\+xml/);
    expect(decodeURIComponent(url!)).toContain('width="240"');
    expect(exportToSvg.mock.calls[0][0].files).toEqual({
      f1: { dataURL: "data:x" },
    });
  });
});

it("versions PNGs by renderer generation and density (v2 re-renders v1 thumbnails)", () => {
  expect(RENDER_VERSION).toBeGreaterThanOrEqual(2);
  expect(pngRenderVersion(1)).not.toBe(pngRenderVersion(2));
  expect(pngRenderVersion(2)).toBeGreaterThan(1);
});
