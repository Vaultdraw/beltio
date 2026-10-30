/**
 * In a narrow window (`[layout] narrow_width`) the file list is an overlay over the drawing, as
 * Obsidian's drawer: Esc closes it, so does opening a file, and focus goes back to where it was.
 * Nothing runs while the overlay is closed.
 */
import { useEffect, useRef } from "react";

/** Something else owns Esc while a dialog or menu is open. */
const escapeBelongsToOther = (doc: Document) =>
  !!doc.querySelector(
    '[role="dialog"], [role="menu"], .vault-menu, dialog[open]',
  );

export function useNavigatorOverlay(
  doc: Document | null,
  open: boolean,
  close: () => void,
  /** Changes when a file is opened (path of the open drawing or note). */
  contentKey: string | null,
): void {
  const closeRef = useRef(close);
  closeRef.current = close;

  // Esc closes; focus returns to what had it when the overlay opened.
  useEffect(() => {
    if (!open || !doc) {
      return undefined;
    }
    const before = doc.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        !e.defaultPrevented &&
        !escapeBelongsToOther(doc)
      ) {
        e.preventDefault();
        closeRef.current();
      }
    };
    doc.addEventListener("keydown", onKey);
    return () => {
      doc.removeEventListener("keydown", onKey);
      if (before && before !== doc.body && before.isConnected) {
        before.focus({ preventScroll: true });
      }
    };
  }, [open, doc]);

  // Opening a file closes it (the key changes while the overlay is up).
  const keyOnOpen = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      keyOnOpen.current = null;
      return;
    }
    if (keyOnOpen.current === null) {
      keyOnOpen.current = contentKey ?? "";
      return;
    }
    if (keyOnOpen.current !== (contentKey ?? "")) {
      closeRef.current();
    }
  }, [open, contentKey]);
}
