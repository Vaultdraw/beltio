import { useEffect, type RefObject } from "react";

import { pushEscapeLayer } from "../escapeLayers";

const FOCUSABLE =
  "button:not(:disabled), input:not(:disabled), select:not(:disabled)";

/**
 * Modal keyboard behaviour: focus the close button, Escape closes, Tab cycles
 * inside `dialogRef`, focus returns to where it was. Same as PaperDialog's.
 */
export const useModalKeys = (
  dialogRef: RefObject<HTMLElement | null>,
  closeRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  ownerDocument?: Document | null,
) => {
  useEffect(() => {
    const doc = ownerDocument ?? dialogRef.current?.ownerDocument;
    if (!doc) {
      return;
    }
    const previous = doc.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const layer = pushEscapeLayer();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!layer.isTop() || event.isComposing) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (event.key === "Tab") {
        const focusable = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
        );
        if (!focusable.length) {
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && doc.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && doc.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    doc.addEventListener("keydown", onKeyDown, true);
    return () => {
      layer.pop();
      doc.removeEventListener("keydown", onKeyDown, true);
      previous?.focus?.();
    };
  }, [dialogRef, closeRef, onClose, ownerDocument]);
};
