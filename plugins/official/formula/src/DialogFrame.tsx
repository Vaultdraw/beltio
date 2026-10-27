/**
 * The app's dialog frame, for a plugin: the same markup and class names as the core `Dialog`
 * (scrim, header, body, footer), so it looks like every other Vaultdraw dialog and follows the
 * theme. Escape closes it from anywhere (capture phase), Tab stays inside, and focus goes back
 * to the element that had it when the dialog opened.
 */
import { useEffect, useRef, useState } from "react";

import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function DialogFrame({
  title,
  titleId,
  onClose,
  children,
  footer,
  className,
}: {
  title: string;
  titleId: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const backdrop = useRef<HTMLDivElement>(null);
  const [opener] = useState(() => globalThis.document?.activeElement ?? null);
  const live = useRef(onClose);
  live.current = onClose;

  useEffect(() => {
    const doc = backdrop.current?.ownerDocument;
    if (!doc) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      live.current();
    };
    doc.addEventListener("keydown", onKeyDown, true);
    return () => {
      doc.removeEventListener("keydown", onKeyDown, true);
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

  return (
    <div
      ref={backdrop}
      className="vault-modal-backdrop vd-dialog-scrim"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={trapTab}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className={`vault-modal vd-dialog${className ? ` ${className}` : ""}`}>
        <div className="vault-modal__header vd-dialog__header">
          <div className="vd-dialog__heading">
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
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="vault-modal__body vd-dialog__body">{children}</div>
        {footer && (
          <div className="vault-modal__footer vd-dialog__footer">{footer}</div>
        )}
      </div>
    </div>
  );
}
