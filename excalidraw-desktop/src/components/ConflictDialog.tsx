import { useState } from "react";

import { duplicateName, getBaseName } from "../vault/treeStore";

import { userError } from "./userError";

import { Dialog } from "./Dialog";
import { IconAlert } from "./Icons";

interface ConflictDialogProps {
  currentPath: string;
  errorMessage?: string | null;
  onReload: () => void | Promise<void>;
  onSaveCopy: (copyPath: string) => void | Promise<void>;
  onClose: () => void;
}

export const ConflictDialog = ({
  currentPath,
  errorMessage,
  onReload,
  onSaveCopy,
  onClose,
}: ConflictDialogProps) => {
  const suggestedCopy = duplicateName(currentPath);
  const [copyPath, setCopyPath] = useState(suggestedCopy);
  const [showCopyInput, setShowCopyInput] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReload = async () => {
    setProcessing(true);
    setError(null);
    try {
      await onReload();
      onClose();
    } catch (err: unknown) {
      setError(userError(err));
      setProcessing(false);
    }
  };

  const handleSaveCopy = async () => {
    setProcessing(true);
    setError(null);
    try {
      await onSaveCopy(copyPath.trim());
      onClose();
    } catch (err: unknown) {
      setError(userError(err));
      setProcessing(false);
    }
  };

  const fileName = getBaseName(currentPath);

  return (
    <Dialog
      title="File conflict"
      titleId="conflict-dialog-title"
      icon={
        <span style={{ color: "var(--vault-warning)", display: "flex" }}>
          <IconAlert />
        </span>
      }
      onClose={onClose}
      busy={processing}
      footer={
        <button
          type="button"
          className="vault-btn vault-btn--ghost"
          onClick={onClose}
          disabled={processing}
        >
          Keep editing
        </button>
      }
    >
      <p>
        <strong>{fileName}</strong> was changed or deleted on disk outside
        Vaultdraw while you had unsaved edits. Choose which version to keep.
      </p>
      {errorMessage && <div className="vd-notice">{errorMessage}</div>}

      {showCopyInput ? (
        <div className="vault-field">
          <label htmlFor="copy-path-input">
            Save your current edits to a new file:
          </label>
          <input
            id="copy-path-input"
            type="text"
            className="vault-input"
            value={copyPath}
            onChange={(e) => setCopyPath(e.target.value)}
            disabled={processing}
            autoFocus
          />
          <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
            <button
              type="button"
              className="vault-btn vault-btn--primary"
              onClick={() => void handleSaveCopy()}
              disabled={processing || !copyPath.trim()}
            >
              {processing ? "Saving…" : "Save a copy and continue"}
            </button>
            <button
              type="button"
              className="vault-btn"
              onClick={() => setShowCopyInput(false)}
              disabled={processing}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="vd-outcomes">
          <div className="vd-outcome">
            <div className="vd-outcome__text">
              <div className="vd-outcome__title">Keep my version</div>
              <div className="vd-outcome__desc">
                Saves your edits as a separate file (e.g.{" "}
                {getBaseName(suggestedCopy)}); the file on disk stays as it is.
              </div>
            </div>
            <button
              type="button"
              className="vault-btn vault-btn--primary"
              onClick={() => setShowCopyInput(true)}
              disabled={processing}
            >
              Save as copy
            </button>
          </div>
          <div className="vd-outcome">
            <div className="vd-outcome__text">
              <div className="vd-outcome__title">Take the disk version</div>
              <div className="vd-outcome__desc">
                Loads the newer file from disk and discards your unsaved edits.
              </div>
            </div>
            <button
              type="button"
              className="vault-btn vault-btn--danger-soft"
              onClick={() => void handleReload()}
              disabled={processing}
            >
              Reload from disk
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="vault-error-text" style={{ marginTop: "10px" }}>
          {error}
        </div>
      )}
    </Dialog>
  );
};
