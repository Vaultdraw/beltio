/**
 * One import: the dialog as a modal overlay (the drawing stays visible behind it), the render
 * loop behind its Import button, then the pages go into the drawing as one undo step and a
 * message says what happened. Resolves when the dialog has closed.
 */
import { useCallback, useRef, useState } from "react";

import { PdfImportDialog } from "./Dialog";
import { pdfErrorMessage, PdfImportAborted } from "./errors";
import { importPdf } from "./importPdf";

import type {
  PdfDocument,
  PdfImportSettings,
  PluginContext,
} from "@vaultdraw/api";
import type { PdfImportProgress, PdfImportResult } from "./importPdf";

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

  function Root({ close }: { close: () => void }) {
    const [current, setCurrent] = useState(first);
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
        const result = await importPdf({
          ctx,
          doc: current,
          indices,
          settings,
          path,
          signal: abort.signal,
          onProgress: setProgress,
        });
        ctx.ui.toast(importSummary(result, settings));
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

  return new Promise((resolve) => {
    const handle = ctx.overlays.open(Root, {
      modal: true,
      onClose: () => {
        // Any way out (Cancel, done, another overlay, the plugin stopping) ends the import.
        signal?.removeEventListener("abort", stop);
        abort.abort();
        void first.close().catch(() => {});
        resolve();
      },
    });
    signal?.addEventListener("abort", () => handle.close(), { once: true });
  });
}
