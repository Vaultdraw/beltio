/**
 * Pointer-down on a drawing's row, tab or switcher item starts the speculative
 * open (speculativeOpen.ts). One delegated listener on the document, installed
 * only while `files.speculative_open` is on. Hover is not used: a pointer
 * passing over a list would read every file it crosses.
 */
import {
  SPECULATIVE_DRAG_PX,
  discardSpeculativeOpen,
  startSpeculativeOpen,
} from "./speculativeOpen";

import type { DrawingFile } from "../vault/types";

/** Elements a click on which opens a drawing, and where each keeps the path. */
const TARGET =
  '[data-tree-kind="drawing"][data-tree-path], .vault-tabs__tab[data-path], [data-open-path]';

export const pathOfTarget = (el: Element | null): string | null => {
  const hit = el?.closest<HTMLElement>(TARGET);
  if (!hit) {
    return null;
  }
  const path =
    hit.dataset.openPath ??
    (hit.dataset.treePath !== undefined
      ? hit.dataset.treePath
      : hit.dataset.path);
  return path ? path : null;
};

export type PrefetchDeps = {
  /** The open vault's handle, or null. */
  handle(): string | null;
  /** The open drawing's path: opening it again needs nothing. */
  activePath(): string | null;
  read(handle: string, path: string): Promise<DrawingFile>;
};

/** Returns the function that removes the listener. */
export const installPointerPrefetch = (
  doc: Document,
  deps: PrefetchDeps,
): (() => void) => {
  let stopDrag: (() => void) | null = null;
  const endDrag = () => {
    stopDrag?.();
    stopDrag = null;
  };
  const onDown = (e: PointerEvent) => {
    endDrag();
    if (e.button !== 0 || !e.isPrimary) {
      return;
    }
    const handle = deps.handle();
    const path = pathOfTarget(e.target as Element | null);
    if (!handle || !path || path === deps.activePath()) {
      return;
    }
    startSpeculativeOpen(handle, path, deps.read);
    // a drag (tab reorder, tree move) is not a click: drop the entry
    const { clientX: x0, clientY: y0 } = e;
    const onMove = (m: PointerEvent) => {
      if (Math.hypot(m.clientX - x0, m.clientY - y0) > SPECULATIVE_DRAG_PX) {
        discardSpeculativeOpen();
        endDrag();
      }
    };
    const onEnd = () => endDrag();
    doc.addEventListener("pointermove", onMove, true);
    doc.addEventListener("pointerup", onEnd, true);
    doc.addEventListener("pointercancel", onEnd, true);
    doc.addEventListener("dragstart", onDragStart, true);
    stopDrag = () => {
      doc.removeEventListener("pointermove", onMove, true);
      doc.removeEventListener("pointerup", onEnd, true);
      doc.removeEventListener("pointercancel", onEnd, true);
      doc.removeEventListener("dragstart", onDragStart, true);
    };
  };
  const onDragStart = () => {
    discardSpeculativeOpen();
    endDrag();
  };
  doc.addEventListener("pointerdown", onDown, true);
  return () => {
    doc.removeEventListener("pointerdown", onDown, true);
    endDrag();
    discardSpeculativeOpen();
  };
};
