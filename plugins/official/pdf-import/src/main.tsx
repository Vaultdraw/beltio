/**
 * pdf-import: pick or drop a PDF, choose the pages, and place them as locked pictures in the open
 * drawing. An official, bundled plugin: the native renderer is the app's (ctx.pdf), the dialog is
 * an overlay (ctx.overlays), and the pages go in as one undo step (ctx.scene.batch).
 */
import { definePlugin } from "@vaultdraw/api";

import dialogCss from "./dialog.css";
import { pdfErrorMessage } from "./errors";
import { runImport } from "./flow";

import type { PdfDocument } from "@vaultdraw/api";

export default definePlugin({
  activate(ctx) {
    const style = document.createElement("style");
    style.textContent = `${dialogCss}`;
    document.head.appendChild(style);
    ctx.subscriptions.push({ dispose: () => style.remove() });

    /** One import at a time: the overlay is modal, so a second one would replace it. */
    let busy = false;
    const guarded = async (job: () => Promise<void>) => {
      if (busy) {
        ctx.ui.toast("A PDF import is already running");
        return;
      }
      busy = true;
      try {
        await job();
      } finally {
        busy = false;
      }
    };

    // A PDF dropped on the canvas, or picked in Import file…
    ctx.importers.register("pdf", {
      import: (input, opts) =>
        guarded(async () => {
          let doc: PdfDocument;
          try {
            doc = await ctx.pdf.open(input.name, await input.bytes());
          } catch (err) {
            ctx.ui.toast(pdfErrorMessage(err));
            return;
          }
          await runImport(ctx, doc, opts.path, opts.signal);
        }),
    });

    // Import: PDF… (native file picker). The command returns at once; the dialog outlives it.
    ctx.commands.register("import", () => {
      void guarded(async () => {
        const path = ctx.scene.path();
        if (path === null) {
          return;
        }
        let doc: PdfDocument | null;
        try {
          doc = await ctx.pdf.pick();
        } catch (err) {
          ctx.ui.toast(pdfErrorMessage(err));
          return;
        }
        if (doc) {
          await runImport(ctx, doc, path);
        }
      });
    });
  },
});
