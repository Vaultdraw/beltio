import { useCallback, useEffect, useRef, useState } from "react";

import { describeReadOnly } from "../../vault/readOnlyReason";
import { IconLock } from "../Icons";

import "./ReadOnlyBadge.css";

import type { VaultInfo } from "../../vault/types";

interface ReadOnlyBadgeProps {
  vault: VaultInfo;
  /** "Try again": reopen the vault writable (vault.retryWritable). */
  onRetry?: () => void | Promise<void>;
}

/** Header "Read-Only" badge: click for the reason and a way out (toimprove #40). */
export const ReadOnlyBadge = ({ vault, onRetry }: ReadOnlyBadgeProps) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLButtonElement>(null);
  const { summary, detail } = describeReadOnly(vault);
  // Closing with focus inside the panel hands it back to the badge, as the row, sort and tab
  // menus do (toimprove 221, 305); a click elsewhere keeps the focus where the click put it.
  const focusInPanel = () => {
    const root = rootRef.current;
    const active = root?.ownerDocument.activeElement;
    return !!active && active !== badgeRef.current && !!root?.contains(active);
  };
  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) {
      badgeRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    const doc = rootRef.current?.ownerDocument;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close(focusInPanel());
      }
    };
    doc?.addEventListener("pointerdown", onDown, true);
    doc?.addEventListener("keydown", onKey, true);
    return () => {
      doc?.removeEventListener("pointerdown", onDown, true);
      doc?.removeEventListener("keydown", onKey, true);
    };
  }, [open, close]);

  const retry = async () => {
    // Read before "Try again" is disabled: a disabled button drops its focus.
    const returnFocus = focusInPanel();
    setBusy(true);
    try {
      await onRetry?.();
    } finally {
      setBusy(false);
      close(returnFocus);
    }
  };

  return (
    <div className="vault-readonly" ref={rootRef}>
      <button
        ref={badgeRef}
        type="button"
        className="vault-badge vault-badge--readonly"
        title={`Read-only: ${summary}. Click for details.`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
      >
        <IconLock />
        <span>Read-Only</span>
      </button>
      {open && (
        <div
          className="vault-readonly__panel"
          role="dialog"
          aria-label="Why this vault is read-only"
        >
          <strong className="vault-readonly__summary">{summary}</strong>
          <p className="vault-readonly__detail">{detail}</p>
          {onRetry && (
            <button
              type="button"
              className="vault-btn vault-btn--primary"
              disabled={busy}
              onClick={() => void retry()}
            >
              {busy ? "Trying…" : "Try again"}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
