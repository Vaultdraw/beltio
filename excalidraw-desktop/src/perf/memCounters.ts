/**
 * Perf builds only: `window.__perfMemCounters()` reports what the page holds in app
 * data (scene elements, image dataURL characters), element bitmaps and canvases, so a
 * memory probe (perf/lib/browser.mjs with PERF_HEAP_PROBE) can attribute the JS heap
 * and the graphics memory to their owners at each perf mark. The first call also starts
 * a 100 ms poll that keeps each perf step's peak of the element bitmap cache and of the
 * document's canvases (`peaks`); nothing runs until a probe asks.
 */
import { allEditorApis } from "../editor/editorApi";

import { perfStep } from "./footprintTrace";

const MB = 1024 * 1024;
const round = (n: number) => Math.round(n * 10) / 10;

type Peak = { bitmapMB: number; bitmapEntries: number; canvasMB: number };

export function installMemCounters(win: Window): void {
  const peaks: Record<string, Peak> = {};
  let polling = false;
  const canvasMB = () =>
    Array.from(win.document.querySelectorAll("canvas")).reduce(
      (sum, c) => sum + c.width * c.height * 4,
      0,
    ) / MB;

  (win as unknown as Record<string, unknown>).__perfMemCounters = async () => {
    const { elementWithCanvasCache: cache } = await import(
      "@excalidraw/element"
    );
    if (!polling) {
      polling = true;
      win.setInterval(() => {
        const p = (peaks[perfStep()] ??= {
          bitmapMB: 0,
          bitmapEntries: 0,
          canvasMB: 0,
        });
        p.bitmapMB = Math.max(p.bitmapMB, round(cache.bytes / MB));
        p.bitmapEntries = Math.max(p.bitmapEntries, cache.size);
        p.canvasMB = Math.max(p.canvasMB, round(canvasMB()));
      }, 100);
    }
    const doc = win.document;
    const editors = allEditorApis().map((api) => {
      const files = Object.values(api.getFiles());
      return {
        elements: api.getSceneElementsIncludingDeleted().length,
        files: files.length,
        filesMB: round(
          files.reduce((sum, f) => sum + (f.dataURL?.length ?? 0), 0) / MB,
        ),
      };
    });
    const images = Array.from(doc.querySelectorAll("img"));
    return {
      step: perfStep(),
      editors,
      bitmapCacheEntries: cache.size,
      bitmapCacheMB: round(cache.bytes / MB),
      domCanvases: doc.querySelectorAll("canvas").length,
      domCanvasMB: round(canvasMB()),
      domImages: images.length,
      domImageMB: round(
        images.reduce((s, i) => s + i.naturalWidth * i.naturalHeight * 4, 0) /
          MB,
      ),
      peaks,
    };
  };
}
