/**
 * The app's dialog frame, for official plugins (they use the public API only, so they cannot
 * import the app's `Dialog`; this is the one copy both plugin dialogs share). Same markup and
 * class names as `excalidraw-desktop/src/components/Dialog.tsx`, same keyboard contract:
 * - Escape closes only the top dialog: the layer stack lives on `globalThis` under the same
 *   key as the app's `escapeLayers.ts`, so a confirm opened over a plugin dialog closes alone
 *   (pinned by `dialogFrame.guard.test.ts`).
 * - Tab cycles inside (a radio group is one stop, `tabindex="-1"` is skipped), focus starts
 *   inside, and goes back to the opener when the dialog closes.
 */
import { useEffect, useRef, useState } from "react";

import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ReactNode } from "react";

const STACK_KEY = Symbol.for("vaultdraw.escapeLayers");

const stackOf = (): object[] => {
  const holder = globalThis as unknown as Record<symbol, object[] | undefined>;
  return (holder[STACK_KEY] ??= []);
};

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

export function DialogFrame({
  title,
  titleId,
  onClose,
  children,
  footer,
  className,
  onSubmit,
  testId,
}: {
  title: string;
  titleId: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** Wraps header, body and footer in a form (Enter submits). */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  testId?: string;
}) {
  const backdrop = useRef<HTMLDivElement>(null);
  const [opener] = useState(() => globalThis.document?.activeElement ?? null);
  const live = useRef(onClose);
  live.current = onClose;

  useEffect(() => {
    const node = backdrop.current;
    const doc = node?.ownerDocument;
    if (!node || !doc) {
      return undefined;
    }
    if (!node.contains(doc.activeElement)) {
      const stops = tabStops(node);
      (
        stops.find((el) => !el.closest(".vd-dialog__header")) ?? stops[0]
      )?.focus();
    }
    const layer = {};
    const stack = stackOf();
    stack.push(layer);
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.isComposing ||
        stack[stack.length - 1] !== layer
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      live.current();
    };
    doc.addEventListener("keydown", onKeyDown, true);
    return () => {
      const at = stack.indexOf(layer);
      if (at >= 0) {
        stack.splice(at, 1);
      }
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
    if (event.key !== "Tab" || event.defaultPrevented) {
      return;
    }
    const nodes = tabStops(event.currentTarget);
    if (nodes.length === 0) {
      return;
    }
    // Move focus ourselves: WebKit skips buttons on Tab by default.
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

  const content = (
    <>
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
    </>
  );

  return (
    <div
      ref={backdrop}
      className="vault-modal-backdrop vd-dialog-scrim"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid={testId}
      onKeyDown={trapTab}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className={`vault-modal vd-dialog${className ? ` ${className}` : ""}`}
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
}
