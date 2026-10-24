import { useEffect, useRef } from "react";

import { Dialog } from "./Dialog";

/** How long a guarded dialog ignores Confirm after it appears. */
export const CONFIRM_GUARD_MS = 600;

interface ConfirmModalProps {
  title: string;
  /** Names the item and says what will happen to it. */
  message: string;
  /** Optional list under the message (e.g. affected links). */
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive: the confirm button is the one filled danger button. */
  isDanger?: boolean;
  /**
   * Asked by something other than the user's own action (a link from outside):
   * focus starts on Cancel, and Confirm ignores clicks and Enter/Space for
   * `GUARD_MS` after the dialog appears, so a key still held cannot confirm it.
   */
  guarded?: boolean;
  /** Further choices between Cancel and Confirm; guarded like Confirm. */
  alternatives?: { label: string; onChoose: () => void }[];
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal = ({
  title,
  message,
  details,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  isDanger = false,
  guarded = false,
  alternatives,
  onConfirm,
  onCancel,
}: ConfirmModalProps) => {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  // Destructive confirmations start on Cancel so a stray Enter is safe.
  useEffect(() => {
    (isDanger || guarded ? cancelBtnRef : confirmBtnRef).current?.focus();
  }, [isDanger, guarded]);

  const shownAt = useRef(Date.now());
  const settled = () =>
    !guarded || Date.now() - shownAt.current >= CONFIRM_GUARD_MS;
  const confirm = () => {
    if (settled()) {
      onConfirm();
    }
  };

  return (
    <Dialog
      title={title}
      titleId="confirm-dialog-title"
      onClose={onCancel}
      footer={
        <>
          <button
            ref={cancelBtnRef}
            type="button"
            className="vault-btn"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          {alternatives?.map((alt) => (
            <button
              key={alt.label}
              type="button"
              className="vault-btn"
              onClick={() => settled() && alt.onChoose()}
            >
              {alt.label}
            </button>
          ))}
          <button
            ref={confirmBtnRef}
            type="button"
            className={`vault-btn ${
              isDanger ? "vault-btn--danger" : "vault-btn--primary"
            }`}
            onClick={confirm}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p>{message}</p>
      {details && details.length > 0 && (
        <ul className="vault-modal__details vd-dialog__details">
          {details.slice(0, 50).map((line, i) => (
            <li key={i}>{line}</li>
          ))}
          {details.length > 50 && <li>…and {details.length - 50} more</li>}
        </ul>
      )}
    </Dialog>
  );
};
