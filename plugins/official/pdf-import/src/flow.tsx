/**
 * One import: the dialog as an overlay, the render loop behind its Import button, then the pages
 * go into the drawing and a message says what happened. The editor is read-only while an overlay
 * is open and a change made then is not an undo step, so the pages are committed after the
 * overlay has closed. Resolves when all of that is done (or the import was cancelled).
 */
import { useCallback, useRef, useState } from "react";

import { PdfImportDialog } from "./Dialog";
import { pdfErrorMessage, PdfImportAborted } from "./errors";
import { commitPages, renderPages } from "./importPdf";

import type {
  PdfDocument,
  PdfImportSettings,
  PluginContext,
} from "@vaultdraw/api";
import type {
  PdfImportProgress,
  PdfImportResult,
  RenderedPages,
} from "./importPdf";

const pages = (n: number) => `${n} page${n === 1 ? "" : "s"}`;

export const importSummary = (
  result: PdfImportResult,
  settings: PdfImportSettings,
): string => {
  let text = `Imported ${pages(result.imported)}`;
  if (settings.lockPages && result.imported > 0) {
    text += " (locked; use Unlock all to edit them)";
  }
  if (result.truncated > 0) {
    text += `. ${pages(
      result.truncated,
    )} not imported: the drawing reached its size limit`;
  }
  if (result.skipped.length > 0) {
    text += `. ${pages(
      result.skipped.length,
    )} could not be rendered (${result.skipped.map((i) => i + 1).join(", ")})`;
  }
  return text;
};

export function runImport(
  ctx: PluginContext,
  first: PdfDocument,
  path: string,
  signal?: AbortSignal,
): Promise<void> {
  const settings = ctx.pdf.settings();
  const abort = new AbortController();
  const stop = () => abort.abort();
  signal?.addEventListener("abort", stop, { once: true });
  /** Set when the render finished: what the commit step puts in the drawing. */
  let pending: RenderedPages | null = null;
  let doc = first;

  function Root({ close }: { close: () => void }) {
    const [current, setCurrent] = useState(first);
    doc = current;
    const [progress, setProgress] = useState<PdfImportProgress | null>(null);
    const running = useRef(false);

    const cancel = useCallback(() => {
      // Running: the importer notices the signal, closes the document and throws.
      if (running.current) {
        abort.abort();
      } else {
        close();
      }
    }, [close]);

    const start = async (indices: number[]) => {
      if (running.current) {
        return;
      }
      running.current = true;
      setProgress({ done: 0, total: indices.length });
      try {
        pending = await renderPages({
          ctx,
          doc: current,
          indices,
          settings,
          signal: abort.signal,
          onProgress: setProgress,
        });
      } catch (err) {
        if (!(err instanceof PdfImportAborted)) {
          ctx.ui.toast(pdfErrorMessage(err));
        }
      } finally {
        running.current = false;
        close();
      }
    };

    return (
      <PdfImportDialog
        ctx={ctx}
        doc={current}
        settings={settings}
        progress={progress}
        onImport={(indices) => void start(indices)}
        onCancel={cancel}
        onUnlock={async (password) => {
          setCurrent(await current.unlock(password));
        }}
      />
    );
  }

  /** The overlay is gone: the editor takes a frame or two to turn writable again. */
  const afterClose = async () => {
    signal?.removeEventListener("abort", stop);
    const pages = pending;
    const stopped = abort.signal.aborted || signal?.aborted;
    abort.abort();
    void doc.close().catch(() => {});
    if (!pages || stopped) {
      return;
    }
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
    try {
      const result = await commitPages({ ctx, doc, pages, settings, path });
      ctx.ui.toast(importSummary(result, settings));
    } catch (err) {
      ctx.ui.toast(pdfErrorMessage(err));
    }
  };

  return new Promise((resolve) => {
    const handle = ctx.overlays.open(Root, {
      onClose: () => void afterClose().finally(resolve),
    });
    signal?.addEventListener("abort", () => handle.close(), { once: true });
  });
}
