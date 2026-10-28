import { useEffect, useRef } from "react";

import {
  getDefaultBackgroundPattern,
  setDefaultBackgroundPattern,
} from "../../vault/paperDefaults";
import { pushEscapeLayer } from "../escapeLayers";
import { IconClose } from "../Icons";

import { PaperControls } from "./PaperControls";
import { PaperPreview } from "./PaperPreview";
import { usePaperPattern } from "./usePaperPattern";

import "./paper.css";

type Props = { onClose: () => void; ownerDocument?: Document | null };

/** Per-drawing paper settings. Render inside the Excalidraw tree. */
export const PaperDialog = ({ onClose, ownerDocument }: Props) => {
  const { pattern, setPattern, readOnly, theme } = usePaperPattern();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

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
        // Focus trap: cycle within the dialog.
        const focusable = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled)",
          ) ?? [],
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
  }, [onClose, ownerDocument]);

  if (readOnly) {
    return null;
  }
  return (
    <div
      className="vault-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="paper-dialog-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div ref={dialogRef} className="vault-modal paper-dialog">
        <div className="vault-modal__header">
          <h3 id="paper-dialog-title" className="vault-modal__title">
            Paper settings
          </h3>
          <button
            ref={closeRef}
            type="button"
            className="vault-btn vault-btn--ghost vault-btn--icon"
            onClick={onClose}
            aria-label="Close"
          >
            <IconClose />
          </button>
        </div>
        <div className="vault-modal__body paper-dialog__body">
          <PaperPreview pattern={pattern} theme={theme} />
          <PaperControls
            value={pattern}
            onChange={setPattern}
            canvasTheme={theme}
          />
        </div>
        <div className="vault-modal__footer">
          <button
            type="button"
            className="vault-btn"
            onClick={() => setPattern(getDefaultBackgroundPattern())}
          >
            Use app default
          </button>
          <button
            type="button"
            className="vault-btn vault-btn--primary"
            onClick={() => setDefaultBackgroundPattern(pattern)}
          >
            Make app default
          </button>
        </div>
      </div>
    </div>
  );
};
