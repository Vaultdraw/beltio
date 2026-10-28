/**
 * One stack for everything that closes on Escape (dialogs, modal pages, Settings): only the
 * top layer answers, so a confirm opened over another dialog closes alone, as in VS Code and
 * Obsidian (bug hunt BH-14). Use `useEscapeLayer`; never add a bare document Escape listener
 * for a modal (guarded by escapeLayers.family.test.tsx).
 */
import { useEffect, useRef } from "react";

const stack: object[] = [];

/** Joins the stack; `isTop` is true while nothing newer is open. */
export function pushEscapeLayer(): { isTop: () => boolean; pop: () => void } {
  const layer = {};
  stack.push(layer);
  return {
    isTop: () => stack[stack.length - 1] === layer,
    pop: () => {
      const i = stack.indexOf(layer);
      if (i >= 0) {
        stack.splice(i, 1);
      }
    },
  };
}

/** Open layers (tests and overlays that must yield to a dialog). */
export const escapeDepth = (): number => stack.length;

/**
 * Escape on `doc` (capture phase, wherever focus sits) calls `onEscape` when this layer is on
 * top and `busy()` is false; the key then goes no further. Lower layers never see it.
 */
export function useEscapeLayer(
  doc: Document | null | undefined,
  onEscape: (event: KeyboardEvent) => void,
  busy: () => boolean = () => false,
): void {
  const live = useRef({ onEscape, busy });
  live.current = { onEscape, busy };
  useEffect(() => {
    if (!doc) {
      return;
    }
    const layer = pushEscapeLayer();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || !layer.isTop()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (!live.current.busy()) {
        live.current.onEscape(event);
      }
    };
    doc.addEventListener("keydown", onKeyDown, true);
    return () => {
      layer.pop();
      doc.removeEventListener("keydown", onKeyDown, true);
    };
  }, [doc]);
}
