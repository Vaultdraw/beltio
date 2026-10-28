/**
 * Renders the chosen PDF pages natively (one in flight), then commits them to the drawing as
 * locked pictures in ONE batch (one undo step). Nothing is committed when aborted. The document
 * is always closed. Two steps (`renderPages`, `commitPages`), and `importPdf` runs both.
 */
import { byteBudget, pageJsonCost, planImportSides } from "./budget";
import { PdfImportAborted } from "./errors";
import { MAX_IMAGE_BYTES, PT_TO_SCENE } from "./limits";

import type {
  PdfDocument,
  PdfImportSettings,
  PluginContext,
  SceneOp,
} from "@vaultdraw/api";

const MIN_QUALITY = 0.6;
/** Below this a page is unreadable whatever the budget. */
const MIN_RETRY_SIDE = 200;
const RETRY_MARGIN = 0.95;

export type PdfImportProgress = { done: number; total: number };

export type PdfImportResult = {
  /** Number of pages placed in the drawing. */
  imported: number;
  /** 0-based PDF page indices that failed to render. */
  skipped: number[];
  /** Pages not imported because the drawing reached its size limit or page limit. */
  truncated: number;
};

/** The native side may answer a JPEG request with a (gray) PNG when that is smaller. */
const mimeOf = (bytes: Uint8Array): "image/png" | "image/jpeg" =>
  bytes[0] === 0x89 &&
  bytes[1] === 0x50 &&
  bytes[2] === 0x4e &&
  bytes[3] === 0x47
    ? "image/png"
    : "image/jpeg";

const yieldToEventLoop = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

const isPageFailed = (err: unknown) =>
  (err as { code?: unknown } | null)?.code === "PDF_PAGE_FAILED";

export const sizeOf = (doc: PdfDocument, index: number) => ({
  width: doc.pages[index].widthPt * PT_TO_SCENE,
  height: doc.pages[index].heightPt * PT_TO_SCENE,
});

export type Rendered = { index: number; bytes: Uint8Array };

export type RenderedPages = {
  rendered: Rendered[];
  /** 0-based PDF page indices that failed to render. */
  skipped: number[];
  /** Pages not imported because the drawing reached its size limit or page limit. */
  truncated: number;
};

/** Step one: render the pages (the document is closed afterwards, whatever happens). */
export const renderPages = async ({
  ctx,
  doc,
  indices,
  settings,
  signal,
  onProgress,
}: {
  ctx: Pick<PluginContext, "scene">;
  doc: PdfDocument;
  indices: readonly number[];
  settings: PdfImportSettings;
  signal?: AbortSignal;
  onProgress?: (progress: PdfImportProgress) => void;
}): Promise<RenderedPages> => {
  try {
    const abortCheck = () => {
      if (signal?.aborted) {
        throw new PdfImportAborted();
      }
    };
    abortCheck();

    // Page mode: never run past the page limit.
    const fit = ctx.scene.placePages(
      indices.map((i) => sizeOf(doc, i)),
    ).maxPages;
    const wanted = fit === null ? [...indices] : indices.slice(0, fit);
    const clamped = indices.length - wanted.length;

    let side = planImportSides(doc.pages, wanted, settings);
    let quality = settings.quality;
    let remaining = byteBudget(ctx.scene.sizeBytes());
    const rendered: Rendered[] = [];
    const skipped: number[] = [];
    let truncated = clamped;

    const renderOnce = (index: number, maxSide: number, q: number) =>
      doc.render(index, { maxSide, format: settings.format, quality: q });

    onProgress?.({ done: 0, total: wanted.length });
    for (let i = 0; i < wanted.length; i++) {
      abortCheck();
      const index = wanted[i];
      const pagesLeft = wanted.length - i;
      // One picture is at most MAX_IMAGE_BYTES, whatever room the drawing has.
      const target = Math.min(
        remaining / pagesLeft,
        pageJsonCost(MAX_IMAGE_BYTES),
      );
      try {
        let bytes = await renderOnce(index, side, quality);
        abortCheck();
        let cost = pageJsonCost(bytes.length);
        if (cost > target) {
          const nextSide = Math.max(
            MIN_RETRY_SIDE,
            Math.floor(side * Math.sqrt(target / cost) * RETRY_MARGIN),
          );
          const nextQuality =
            settings.format === "jpeg"
              ? Math.max(MIN_QUALITY, quality - 0.1)
              : quality;
          if (target > 0 && nextSide < side) {
            bytes = await renderOnce(index, nextSide, nextQuality);
            abortCheck();
            cost = pageJsonCost(bytes.length);
            // later pages start from the reduced settings
            side = nextSide;
            quality = nextQuality;
          }
        }
        if (bytes.length > MAX_IMAGE_BYTES) {
          skipped.push(index);
        } else if (cost > remaining) {
          truncated += pagesLeft;
          break;
        } else {
          remaining -= cost;
          rendered.push({ index, bytes });
        }
      } catch (err) {
        if (err instanceof PdfImportAborted || !isPageFailed(err)) {
          throw err;
        }
        skipped.push(index);
      }
      onProgress?.({ done: i + 1, total: wanted.length });
      await yieldToEventLoop();
    }
    abortCheck();
    return { rendered, skipped, truncated };
  } finally {
    await doc.close().catch(() => {});
  }
};

/** Step two: put the rendered pages in the drawing as one undo step. */
export const commitPages = async ({
  ctx,
  doc,
  pages,
  settings,
  path,
}: {
  ctx: Pick<PluginContext, "scene">;
  /** Only its name and page sizes are read (it is already closed). */
  doc: PdfDocument;
  pages: RenderedPages;
  settings: PdfImportSettings;
  /** The drawing the pages go into (the batch is refused when another one is active). */
  path: string;
}): Promise<PdfImportResult> => {
  const { rendered, skipped, truncated } = pages;
  if (rendered.length === 0) {
    return { imported: 0, skipped, truncated };
  }
  // Placement from what was actually rendered (no holes for skipped pages).
  const placement = ctx.scene.placePages(
    rendered.map((r) => sizeOf(doc, r.index)),
  );
  const ops: SceneOp[] = rendered.map(({ index, bytes }, k) => ({
    op: "add",
    element: {
      type: "image",
      ...placement.rects[k],
      image: { mime: mimeOf(bytes), bytes },
      locked: settings.lockPages,
      data: { name: doc.name, page: index + 1 },
    },
  }));
  // Normal mode brings the first page into view; page mode keeps the view where it is.
  await ctx.scene.batch(ops, {
    path,
    reveal: true,
    ...(placement.pageCount !== null ? { pageCount: placement.pageCount } : {}),
  });
  return { imported: rendered.length, skipped, truncated };
};

/** Both steps in one call (tests, and flows with no dialog in between). */
export const importPdf = async (o: {
  ctx: Pick<PluginContext, "scene">;
  doc: PdfDocument;
  indices: readonly number[];
  settings: PdfImportSettings;
  path: string;
  signal?: AbortSignal;
  onProgress?: (progress: PdfImportProgress) => void;
}): Promise<PdfImportResult> =>
  commitPages({ ...o, pages: await renderPages(o) });
