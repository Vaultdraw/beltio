import { useEffect, useRef } from "react";

import { Dialog } from "../components/Dialog";

import { REFUSAL_TEXT } from "./restore";

import "./history.css";

import type { ReplaceRefusal } from "./restore";

export interface RestoreDialogProps {
  versionLabel: string;
  /** Display name of the drawing being restored. */
  drawingName?: string;
  replaceRefusal: ReplaceRefusal;
  onReplace(): void;
  onCopy(): void;
  onCancel(): void;
}

/** Replace the drawing (undoable) or restore the version as a new file. */
export const RestoreDialog = ({
  versionLabel,
  drawingName,
  replaceRefusal,
  onReplace,
  onCopy,
  onCancel,
}: RestoreDialogProps) => {
  // Focus the first enabled action; Enter activates it natively.
  const replaceRef = useRef<HTMLButtonElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const refused = replaceRefusal !== null;
  useEffect(() => {
    (refused ? copyRef : replaceRef).current?.focus();
  }, [refused]);

  return (
    <Dialog
      title={`Restore ${versionLabel}?`}
      titleId="restore-dialog-title"
      onClose={onCancel}
      testId="restore-dialog"
      footer={
        <>
          <button type="button" className="vault-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            ref={copyRef}
            type="button"
            className="vault-btn"
            onClick={onCopy}
          >
            Restore as a copy
          </button>
          <button
            ref={replaceRef}
            type="button"
            className="vault-btn vault-btn--primary"
            disabled={refused}
            title={refused ? REFUSAL_TEXT[replaceRefusal] : undefined}
            onClick={onReplace}
          >
            Replace current drawing
          </button>
        </>
      }
    >
      <p>
        Replacing {drawingName ? `"${drawingName}"` : "the drawing"} with this
        version keeps your current drawing recoverable: a version is saved first
        and you can undo the restore. Restoring as a copy leaves it untouched.
      </p>
      {refused && (
        <div className="vault-error-text" role="status">
          {REFUSAL_TEXT[replaceRefusal]}
        </div>
      )}
    </Dialog>
  );
};

export default RestoreDialog;
