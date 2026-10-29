import { useEffect, useRef, useState } from "react";

import { useEscapeLayer } from "./escapeLayers";
import { IconClose } from "./Icons";

import "./dialogs.css";

import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ReactNode, Ref } from "react";

interface DialogProps {
  /** Omit for a headerless picker (palette style); then pass `ariaLabel`. */
  title?: ReactNode;
  titleId?: string;
  ariaLabel?: string;
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
  /** Extra keydown handler on the frame (pickers: arrows, Enter). */
  onFrameKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  /** Ref to the frame element. */
  frameRef?: Ref<HTMLDivElement>;
}

const FOCUSABLE = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "[tabindex]",
  '[contenteditable="true"]',
]
  .map((s) => `${s}:not([tabindex="-1"])`)
  .join(", ");

/** Tab stops in order; a radio group is one stop (its checked radio). */
const tabStops = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (!(el instanceof HTMLInputElement) || el.type !== "radio" || !el.name) {
      return true;
    }
    const group = Array.from(
      root.querySelectorAll<HTMLInputElement>(
        `input[type="radio"][name="${el.name.replace(
          /["\\]/g,
          "\\$&",
        )}"]:not(:disabled)`,
      ),
    );
    const checked = group.find((r) => r.checked);
    return checked ? el === checked : el === group[0];
  });

/**
 * Keeps Tab inside `event.currentTarget` (a modal surface). Shared by Dialog and the frames the
 * guard allows (Settings): focus moves ourselves, since WebKit skips buttons on Tab by default
 * and Chromium lets it walk to the page behind (test-net TN-7).
 */
export const trapTab = (event: ReactKeyboardEvent<HTMLElement>) => {
  if (event.key !== "Tab" || event.defaultPrevented) {
    return;
  }
  const nodes = tabStops(event.currentTarget);
  if (nodes.length === 0) {
    return;
  }
  const active = event.currentTarget.ownerDocument.activeElement;
  const at = nodes.indexOf(active as HTMLElement);
  const step = event.shiftKey ? -1 : 1;
  const next =
    at < 0
      ? event.shiftKey
        ? nodes.length - 1
        : 0
      : (at + step + nodes.length) % nodes.length;
  event.preventDefault();
  nodes[next].focus();
};

/**
 * The element that had focus when a modal opened, focused again when it closes (never the body;
 * skipped if that element is gone). Call during the first render, before any autofocus.
 */
export const useFocusReturn = () => {
  const [opener] = useState(() => globalThis.document?.activeElement ?? null);
  useEffect(
    () => () => {
      if (
        opener instanceof HTMLElement &&
        opener !== opener.ownerDocument.body &&
        opener.isConnected
      ) {
        opener.focus();
      }
    },
    [opener],
  );
};

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
  ariaLabel,
  onClose,
  children,
  footer,
  onSubmit,
  className,
  icon,
  busy = false,
  testId,
  onFrameKeyDown,
  frameRef,
}: DialogProps) => {
  const backdropRef = useRef<HTMLDivElement>(null);
  // Read during the first render, before the dialog's own autofocus runs.
  const [opener] = useState(() => globalThis.document?.activeElement ?? null);
  const live = useRef({ onClose, busy });
  live.current = { onClose, busy };
  const [doc, setDoc] = useState<Document | null>(null);
  useEffect(() => setDoc(backdropRef.current?.ownerDocument ?? null), []);
  // Escape closes only the top layer (escapeLayers: dialogs, Settings, modal
  // pages), wherever focus sits.
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
    const token = backdropRef.current!;
    // Focus starts inside the dialog unless the dialog already placed it:
    // the first control in the body or footer, else the Close button.
    if (!token.contains(doc.activeElement)) {
      const stops = tabStops(token);
      (
        stops.find((el) => !el.closest(".vd-dialog__header")) ?? stops[0]
      )?.focus();
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

  const content =
    title === undefined ? (
      children
    ) : (
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
      aria-labelledby={title === undefined ? undefined : titleId}
      aria-label={title === undefined ? ariaLabel : undefined}
      onKeyDown={trapTab}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) {
          onClose();
        }
      }}
    >
      <div
        className={`vault-modal vd-dialog${
          title === undefined ? " vd-dialog--bare" : ""
        }${className ? ` ${className}` : ""}`}
        data-testid={testId}
        ref={frameRef}
        onKeyDown={onFrameKeyDown}
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
