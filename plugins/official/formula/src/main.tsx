/**
 * formula: LaTeX formulas as images in a drawing, and the TeX renderer behind `$...$` in notes.
 * An official, bundled plugin. MathJax runs in a worker that starts on the first render; the
 * dialog is a modal overlay (`ctx.overlays`, `modal`), so the drawing stays visible behind it.
 */
import { definePlugin } from "@vaultdraw/api";

import FormulaDialog from "./FormulaDialog";
import dialogCss from "./FormulaDialog.css";
import { insertFormula, replaceFormula, selectedFormula } from "./insertFormula";
import { disposeFormulaRenderer, renderFormula } from "./renderer";

import type { OverlayHandle, PluginContext } from "@vaultdraw/api";

import type { FormulaData, RenderedFormula } from "./types";

type Mode =
  | { mode: "insert"; color: string }
  | { mode: "edit"; id: string; data: FormulaData };

export default definePlugin({
  activate(ctx: PluginContext) {
    let shown: OverlayHandle | null = null;
    const style = document.createElement("style");
    style.textContent = `${dialogCss}`;
    document.head.appendChild(style);
    ctx.subscriptions.push({
      dispose: () => {
        shown?.close();
        style.remove();
        disposeFormulaRenderer();
      },
    });

    // The renderer for the notes view and other plugins (`ctx.math.render`).
    ctx.math.provide((req) => renderFormula(req));

    const fail = (e: unknown) =>
      ctx.ui.toast(e instanceof Error ? e.message : "Could not place the formula");

    const open = (what: Mode) => {
      shown?.close();
      const handle = ctx.overlays.open(
        ({ close }) => (
          <FormulaDialog
            mode={what.mode}
            initialSource={what.mode === "edit" ? what.data.source : ""}
            initialDisplay={what.mode === "edit" ? what.data.display : true}
            color={what.mode === "edit" ? what.data.color : what.color}
            onCancel={close}
            onConfirm={(r: RenderedFormula) => {
              close();
              const done =
                what.mode === "insert"
                  ? insertFormula(ctx.scene, r)
                  : replaceFormula(ctx.scene, what.id, what.data, r);
              void done.catch(fail);
            }}
          />
        ),
        {
          modal: true,
          onClose: () => {
            if (shown === handle) {
              shown = null;
            }
          },
        },
      );
      shown = handle;
    };

    ctx.commands.register("insert", () =>
      open({ mode: "insert", color: ctx.scene.currentStrokeColor() }),
    );
    ctx.commands.register("edit", () => {
      const target = selectedFormula(ctx.scene);
      if (target) {
        open({ mode: "edit", ...target });
      } else {
        ctx.ui.toast("Select one formula to edit");
      }
    });
    // Runs only to start the plugin (the notes view asks for the renderer).
    ctx.commands.register("provide", () => undefined);
  },
});
