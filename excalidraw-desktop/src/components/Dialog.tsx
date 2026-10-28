import { useEffect, useRef, useState } from "react";

import { useEscapeLayer } from "./escapeLayers";
import { IconClose } from "./Icons";

import "./dialogs.css";

import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ReactNode } from "react";

interface DialogProps {
  title: ReactNode;
  titleId: string;
  /** Escape, backdrop click and the close button all call this. */
  onClose: () => void;
  children: ReactNode;
  /** Action row; the confirming action is the only filled button. */
  footer?: ReactNode;
  /** Wraps header, body and footer in a form (Enter submits). */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  /** Extra class on the dialog frame (e.g. `vd-dialog--wide`). */
  className?: string;
  /** Leading icon next to the title. */
  icon?: ReactNode;
  /** Ignore Escape / backdrop while an action is running. */
  busy?: boolean;
  /** Test id of the frame. */
  testId?: string;
}

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * The one frame every Vaultdraw dialog uses (16 px title, 20 px padding, 34 px
 * buttons; see dialogs.css). It owns the keyboard contract, so every dialog
 * closes on Escape regardless of how it was opened or where focus sits:
 * a capture-phase keydown on the dialog's own document (focus may still be in
 * a closing palette, an input, or the canvas; the editor never sees the key).
 * It also keeps Tab inside the dialog.
 */
export const Dialog = ({
  title,
  titleId,
  onClose,
  children,
  footer,
  onSubmit,
  className,
  icon,
  busy = false,
  testId,
}: DialogProps) => {
  const backdropRef = useRef<HTMLDivElement>(null);
  // Read during the first render, before the dialog's own autofocus runs.
  const [opener] = useState(() => globalThis.document?.activeElement ?? null);
  const live = useRef({ onClose, busy });
  live.current = { onClose, busy };

  const [doc, setDoc] = useState<Document | null>(null);
  useEffect(() => setDoc(backdropRef.current?.ownerDocument ?? null), []);
  // Escape closes only the top dialog (escapeLayers), wherever focus sits.
  useEscapeLayer(
    doc,
    () => live.current.onClose(),
    () => live.current.busy,
  );

  useEffect(() => {
    const doc = backdropRef.current?.ownerDocument;
    if (!doc) {
      return;
    }
    return () => {
      // Hand focus back (never body; skipped if that element is gone).
      if (
        opener instanceof HTMLElement &&
        opener !== doc.body &&
        opener.isConnected
      ) {
        opener.focus();
      }
    };
  }, [opener]);

  const trapTab = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") {
      return;
    }
    const nodes = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE),
    );
    if (nodes.length === 0) {
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = event.currentTarget.ownerDocument.activeElement;
    if (
      event.shiftKey &&
      (active === first || !nodes.includes(active as never))
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const content = (
    <>
      <div className="vault-modal__header vd-dialog__header">
        <div className="vd-dialog__heading">
          {icon}
          <h3 id={titleId} className="vault-modal__title vd-dialog__title">
            {title}
          </h3>
        </div>
        <button
          type="button"
          className="vault-btn vault-btn--ghost vault-btn--icon vd-dialog__close"
          onClick={onClose}
          aria-label="Close"
        >
          <IconClose />
        </button>
      </div>
      <div className="vault-modal__body vd-dialog__body">{children}</div>
      {footer && (
        <div className="vault-modal__footer vd-dialog__footer">{footer}</div>
      )}
    </>
  );

  return (
    <div
      ref={backdropRef}
      className="vault-modal-backdrop vd-dialog-scrim"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={trapTab}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) {
          onClose();
        }
      }}
    >
      <div
        className={`vault-modal vd-dialog${className ? ` ${className}` : ""}`}
        data-testid={testId}
      >
        {onSubmit ? (
          <form onSubmit={onSubmit} className="vd-dialog__form">
            {content}
          </form>
        ) : (
          content
        )}
      </div>
    </div>
  );
};
