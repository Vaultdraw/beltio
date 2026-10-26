import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ExcalidrawImageElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { registerCommandHandlers } from "../commands/handlerRegistry";

import { FORMULA_COMMAND_IDS } from "./formulaCommands";
import { getFormulaData } from "./types";

import type { ComponentType, ReactNode, RefObject } from "react";

import type { FormulaDialogProps } from "./FormulaDialog";
import type { RenderedFormula } from "./insertFormula";
import type { FormulaData } from "./types";

// Loaded on first use, then the dialog is mounted directly. Not React.lazy:
// React 19 holds a resolved Suspense boundary back for ~300 ms (fallback
// throttle), which was most of the first-formula latency.
let FormulaDialog: ComponentType<FormulaDialogProps> | null = null;
const loadDialog = async () => {
  FormulaDialog ??= (await import("./FormulaDialog")).default;
};
// Insert/replace (hash, base64, element building) loads with the dialog's
// chunk, not at startup.
const loadInsert = () => import("./insertFormula");

type Target = { element: ExcalidrawImageElement; data: FormulaData };
type DialogState =
  | { mode: "insert"; color: string }
  | ({ mode: "edit" } & Target);

type Options = {
  apiRef: RefObject<ExcalidrawImperativeAPI | null>;
  readOnly?: boolean;
  /** `extensions.formula`: off = no handlers, formula images edit as images. */
  enabled?: boolean;
};

/** Exactly one selected, unlocked formula image, else null. */
export function getSelectedFormula(
  api: ExcalidrawImperativeAPI,
): Target | null {
  const ids = Object.keys(api.getAppState().selectedElementIds);
  if (ids.length !== 1) {
    return null;
  }
  const el = api
    .getSceneElements()
    .find((e) => e.id === ids[0] && e.type === "image");
  return el ? formulaTarget(el as ExcalidrawImageElement) : null;
}

function formulaTarget(el: ExcalidrawImageElement): Target | null {
  const data = getFormulaData(el);
  return data && !el.locked ? { element: el, data } : null;
}

export function useFormulaCommands({
  apiRef,
  readOnly = false,
  enabled = true,
}: Options): {
  onImageEdit: (el: ExcalidrawImageElement) => boolean;
  dialog: ReactNode;
  /** Closes the dialog (another document is being shown). */
  close: () => void;
} {
  const [state, setState] = useState<DialogState | null>(null);
  const live = useRef({ readOnly, enabled });
  live.current = { readOnly, enabled };

  const open = useCallback((next: DialogState) => {
    void loadDialog().then(() => setState(next));
  }, []);

  const openEdit = useCallback(
    (target: Target) => open({ mode: "edit", ...target }),
    [open],
  );

  const onImageEdit = useCallback(
    (el: ExcalidrawImageElement) => {
      const api = apiRef.current;
      if (
        !api ||
        !live.current.enabled ||
        live.current.readOnly ||
        api.getAppState().viewModeEnabled
      ) {
        return false;
      }
      const target = formulaTarget(el);
      if (!target) {
        return false;
      }
      openEdit(target);
      return true;
    },
    [apiRef, openEdit],
  );

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    return registerCommandHandlers({
      [FORMULA_COMMAND_IDS.insert]: () => {
        const api = apiRef.current;
        if (!api || live.current.readOnly) {
          return;
        }
        open({
          mode: "insert",
          color: api.getAppState().currentItemStrokeColor,
        });
      },
      [FORMULA_COMMAND_IDS.edit]: () => {
        const api = apiRef.current;
        const target = api && !live.current.readOnly && getSelectedFormula(api);
        if (target) {
          openEdit(target);
        }
      },
    });
  }, [apiRef, open, openEdit, enabled]);

  const close = useCallback(() => setState(null), []);

  const confirm = useCallback(
    (formula: RenderedFormula) => {
      const api = apiRef.current;
      const current = state;
      setState(null);
      if (!api || !current) {
        return;
      }
      if (current.mode === "insert") {
        void loadInsert().then((m) => m.insertFormula(api, formula));
        return;
      }
      // Re-read: the element may have changed or gone while the dialog was open.
      const el = api
        .getSceneElements()
        .find((e) => e.id === current.element.id);
      const target = el && formulaTarget(el as ExcalidrawImageElement);
      if (target) {
        void loadInsert().then((m) =>
          m.replaceFormula(api, target.element, target.data, formula),
        );
      }
    },
    [apiRef, state],
  );

  const dialog = useMemo(
    () =>
      state && FormulaDialog ? (
        <FormulaDialog
          mode={state.mode}
          initialSource={state.mode === "edit" ? state.data.source : ""}
          initialDisplay={state.mode === "edit" ? state.data.display : true}
          color={state.mode === "edit" ? state.data.color : state.color}
          onConfirm={confirm}
          onCancel={close}
        />
      ) : null,
    [state, confirm, close],
  );

  return { onImageEdit, dialog, close };
}
