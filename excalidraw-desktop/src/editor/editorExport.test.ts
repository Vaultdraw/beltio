import { afterEach, describe, expect, it, vi } from "vitest";

import { loadBuiltinThemes } from "../theme";
import { copyWithWebClipboard } from "../vault/clipboard";
import {
  DEFAULT_EXPORT_OPTIONS,
  getPreferences,
  normalizeExportOptions,
} from "../vault/preferences";

import {
  registerCanvasRepaint,
  resetCanvasSync,
  setCanvasSync,
  suspendCanvasSync,
} from "./canvasSync";
import {
  appStateToExportOptions,
  exportOptionsToAppState,
  loadExportOptions,
  rememberExportOptions,
} from "./exportOptions";
import { exportFileName, renderImageExport } from "./imageExport";

const setTransform = vi.fn();
const exportToBlob = vi.fn();
const exportToSvg = vi.fn();

vi.mock("@excalidraw/excalidraw", () => ({
  setDisplayTextRoleColor: () => {},
  setDisplayColorTransform: (t: unknown) => setTransform(t),
  invertColorForDarkMode: (c: string) => c,
  exportToBlob: (o: unknown) => exportToBlob(o),
  exportToSvg: (o: unknown) => exportToSvg(o),
}));

const theme = (await loadBuiltinThemes())[0];
const syncOn = () =>
  setCanvasSync({ variant: theme.dark, mode: "dark", key: "t" });
const win = window as unknown as Window & typeof globalThis;

afterEach(() => {
  resetCanvasSync();
  vi.clearAllMocks();
});

describe("suspendCanvasSync", () => {
  it("nests and restores on the last release only", () => {
    syncOn();
    setTransform.mockClear();
    const a = suspendCanvasSync();
    const b = suspendCanvasSync();
    expect(setTransform).toHaveBeenLastCalledWith(null);
    a();
    expect(setTransform).toHaveBeenCalledTimes(1);
    b();
    expect(setTransform).toHaveBeenCalledTimes(2);
    expect(setTransform.mock.calls[1][0]).toBeTypeOf("function");
  });

  it("release is idempotent", () => {
    syncOn();
    const a = suspendCanvasSync();
    const b = suspendCanvasSync();
    a();
    a();
    setTransform.mockClear();
    b();
    expect(setTransform).toHaveBeenCalledTimes(1);
  });

  it("repaints on the last release", () => {
    syncOn();
    const repaint = vi.fn();
    registerCanvasRepaint(repaint);
    suspendCanvasSync()();
    expect(repaint).toHaveBeenCalledTimes(1);
  });
});

describe("export options: page shape", () => {
  it("round-trips through the appState fields", () => {
    const opts = { ...DEFAULT_EXPORT_OPTIONS, pageShaped: true };
    expect(exportOptionsToAppState(opts).exportPageShaped).toBe(true);
    expect(
      appStateToExportOptions(exportOptionsToAppState(opts)).pageShaped,
    ).toBe(true);
    expect(normalizeExportOptions({ pageShaped: "x" }).pageShaped).toBe(false);
  });
});

describe("renderImageExport", () => {
  const base = {
    elements: [{ id: "a" }],
    appState: { exportEmbedScene: false, exportBackground: true },
    files: {},
    exportingFrame: null,
    name: "Plan.excalidraw",
  };
  const req = (extra: object) => ({ ...base, ...extra } as never);

  it("builds file names", () => {
    expect(exportFileName("Plan.excalidraw", "png", false)).toBe("Plan.png");
    expect(exportFileName("Plan.excalidraw", "svg", true)).toBe(
      "Plan.excalidraw.svg",
    );
    expect(exportFileName(".excalidraw", "png", false)).toBe("Drawing.png");
  });

  it("renders png with the transform off and the embed suffix", async () => {
    syncOn();
    setTransform.mockClear();
    exportToBlob.mockImplementation(async () => {
      expect(setTransform).toHaveBeenLastCalledWith(null);
      return new Blob([new Uint8Array([1, 2, 3])]);
    });
    const out = await renderImageExport(
      req({ type: "png", appState: { exportEmbedScene: true } }),
      win,
    );
    expect(out.fileName).toBe("Plan.excalidraw.png");
    expect(Array.from(out.bytes)).toEqual([1, 2, 3]);
    expect(setTransform.mock.calls.at(-1)?.[0]).toBeTypeOf("function");
  });

  it("png honours the export scale (public exportToBlob ignores it alone)", async () => {
    exportToBlob.mockResolvedValue(new Blob([new Uint8Array([1])]));
    await renderImageExport(
      req({ type: "png", appState: { exportScale: 3 } }),
      win,
    );
    const { getDimensions } = exportToBlob.mock.calls[0][0];
    expect(getDimensions(100, 50)).toEqual({
      width: 300,
      height: 150,
      scale: 3,
    });
    exportToBlob.mockClear();
    await renderImageExport(req({ type: "png" }), win);
    expect(exportToBlob.mock.calls[0][0].getDimensions(100, 50)).toEqual({
      width: 100,
      height: 50,
      scale: 1,
    });
  });

  it("page-shaped exports the whole page column as a synthetic frame", async () => {
    exportToBlob.mockResolvedValue(new Blob([new Uint8Array([1])]));
    const pageSetup = {
      enabled: true,
      layout: "separate",
      width: 100,
      height: 200,
      pageCount: 3,
    };
    await renderImageExport(
      req({ type: "png", appState: { exportPageShaped: true, pageSetup } }),
      win,
    );
    const { exportingFrame } = exportToBlob.mock.calls[0][0];
    expect(exportingFrame).toMatchObject({
      type: "frame",
      x: 0,
      y: 0,
      width: 100,
      height: 3 * 240 - 40,
    });
    exportToBlob.mockClear();
    // not page mode / switch off / a frame chosen by the caller: unchanged
    await renderImageExport(
      req({ type: "png", appState: { exportPageShaped: true } }),
      win,
    );
    await renderImageExport(
      req({ type: "png", appState: { exportPageShaped: false, pageSetup } }),
      win,
    );
    expect(exportToBlob.mock.calls.map((c) => c[0].exportingFrame)).toEqual([
      null,
      null,
    ]);
  });

  it("builds pdf file names", () => {
    expect(exportFileName("Plan.excalidraw", "pdf", false)).toBe("Plan.pdf");
  });

  it("clipboard never embeds the scene", async () => {
    exportToBlob.mockResolvedValue(new Blob([new Uint8Array([9])]));
    const out = await renderImageExport(
      req({ type: "clipboard", appState: { exportEmbedScene: true } }),
      win,
    );
    expect(out.fileName).toBe("Plan.png");
    expect(exportToBlob.mock.calls[0][0].appState.exportEmbedScene).toBe(false);
  });

  it("svg gets the preamble", async () => {
    exportToSvg.mockResolvedValue(
      document.createElementNS("http://www.w3.org/2000/svg", "svg"),
    );
    const out = await renderImageExport(req({ type: "svg" }), win);
    expect(new TextDecoder().decode(out.bytes)).toMatch(/^<\?xml[\s\S]*<svg/);
    expect(out.mime).toBe("image/svg+xml");
  });

  it("passes padding to both renderers, and none when unset", async () => {
    exportToBlob.mockResolvedValue(new Blob([new Uint8Array([1])]));
    exportToSvg.mockResolvedValue(
      document.createElementNS("http://www.w3.org/2000/svg", "svg"),
    );
    await renderImageExport(req({ type: "png" }), win, { padding: 0 });
    await renderImageExport(req({ type: "svg" }), win, { padding: 42 });
    expect(exportToBlob.mock.calls[0][0].exportPadding).toBe(0);
    // The public exportToSvg ignores appState.exportPadding: it must be an option.
    expect(exportToSvg.mock.calls[0][0].exportPadding).toBe(42);
    await renderImageExport(req({ type: "png" }), win);
    await renderImageExport(req({ type: "svg" }), win);
    expect(exportToBlob.mock.calls[1][0].exportPadding).toBeUndefined();
    expect(exportToSvg.mock.calls[1][0].exportPadding).toBeUndefined();
  });

  it("rejects empty elements", async () => {
    await expect(
      renderImageExport(req({ elements: [], type: "png" }), win),
    ).rejects.toThrow(/empty/i);
  });
});

describe("export options", () => {
  it("round-trips", () => {
    const opts = {
      scale: 2,
      background: false,
      embedScene: true,
      pattern: false,
      pageShaped: false,
    } as const;
    expect(
      appStateToExportOptions(exportOptionsToAppState(opts) as never),
    ).toEqual(opts);
  });

  it("normalizes field by field", () => {
    expect(
      normalizeExportOptions({ scale: 5, background: "x", embedScene: true }),
    ).toEqual({
      scale: expect.any(Number),
      background: true,
      embedScene: true,
      pattern: true,
      pageShaped: false,
    });
  });

  it("remembers the pattern toggle", () => {
    const base = exportOptionsToAppState(DEFAULT_EXPORT_OPTIONS);
    loadExportOptions();
    rememberExportOptions({ ...base, exportBackgroundPattern: false });
    expect(getPreferences().exportOptions.pattern).toBe(false);
    rememberExportOptions({ ...base, exportBackgroundPattern: true });
    expect(getPreferences().exportOptions.pattern).toBe(true);
  });
});

describe("clipboard fallback", () => {
  it("writes png as ClipboardItem and svg as text", async () => {
    const write = vi.fn();
    const writeText = vi.fn();
    const nav = { clipboard: { write, writeText } } as never;
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(public data: unknown) {}
      },
    );
    await copyWithWebClipboard("png", new Uint8Array([1]), nav);
    expect(write).toHaveBeenCalledOnce();
    await copyWithWebClipboard("svg", new TextEncoder().encode("<svg/>"), nav);
    expect(writeText).toHaveBeenCalledWith("<svg/>");
    vi.unstubAllGlobals();
  });
});
