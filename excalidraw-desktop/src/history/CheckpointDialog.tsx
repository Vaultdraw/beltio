import { useEffect, useRef, useState } from "react";

import { Dialog } from "../components/Dialog";
import { errorMessage } from "../vault/types";

import { CHECKPOINT_NAME_MAX, CHECKPOINT_NOTE_MAX } from "./types";

import "./history.css";

interface CheckpointDialogProps {
  /** Resolves when the checkpoint exists; a rejection is shown inline. */
  onSave: (name: string, note: string) => Promise<void>;
  onCancel: () => void;
  /** Display name of the drawing the checkpoint is taken of. */
  drawingName?: string;
}

/** Name (required) and note (optional) for a manual checkpoint. */
export const CheckpointDialog = ({
  onSave,
  onCancel,
  drawingName,
}: CheckpointDialogProps) => {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const trimmed = name.trim();
  const submit = async () => {
    if (!trimmed || savingRef.current) {
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed, note);
    } catch (cause) {
      setError(errorMessage(cause));
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog
      title="Create checkpoint"
      titleId="checkpoint-dialog-title"
      onClose={onCancel}
      busy={saving}
      testId="checkpoint-dialog"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      footer={
        <>
          <button
            type="button"
            className="vault-btn"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="vault-btn vault-btn--primary"
            disabled={saving || !trimmed}
          >
            {saving ? "Saving…" : "Save checkpoint"}
          </button>
        </>
      }
    >
      <p>
        Saves the current state of{" "}
        {drawingName ? `"${drawingName}"` : "this drawing"} as a named version
        you can restore later.
      </p>
      <div className="vault-field">
        <label htmlFor="checkpoint-name">Name</label>
        <input
          id="checkpoint-name"
          ref={nameRef}
          type="text"
          className="vault-input"
          maxLength={CHECKPOINT_NAME_MAX}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={saving}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="vault-field">
        <label htmlFor="checkpoint-note">Note (optional)</label>
        <textarea
          id="checkpoint-note"
          className="vault-input vault-history-note"
          rows={3}
          maxLength={CHECKPOINT_NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          disabled={saving}
        />
      </div>
      {error && <div className="vault-error-text">{error}</div>}
    </Dialog>
  );
};
