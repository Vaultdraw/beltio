import { useEffect, useRef, useState } from "react";

import { getCleanDrawingName, validateEntryName } from "../vault/treeStore";

import { userError } from "./userError";

import { Dialog } from "./Dialog";

interface RenameModalProps {
  initialName: string;
  kind: "drawing" | "folder";
  onRename: (newName: string) => void | Promise<void>;
  onCancel: () => void;
}

export const RenameModal = ({
  initialName,
  kind,
  onRename,
  onCancel,
}: RenameModalProps) => {
  const cleanInitial =
    kind === "drawing" ? getCleanDrawingName(initialName) : initialName;
  const [name, setName] = useState(cleanInitial);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetName =
      kind === "drawing" ? `${name.trim()}.excalidraw` : name.trim();
    const validation = validateEntryName(targetName, kind);
    if (!validation.valid) {
      setError(validation.error ?? "Invalid name");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onRename(targetName);
    } catch (err: unknown) {
      setError(userError(err));
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      title={`Rename ${kind === "drawing" ? "Drawing" : "Folder"}`}
      titleId="rename-modal-title"
      onClose={onCancel}
      onSubmit={handleSubmit}
      footer={
        <>
          <button
            type="button"
            className="vault-btn"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="vault-btn vault-btn--primary"
            disabled={submitting || !name.trim()}
          >
            {submitting ? "Renaming..." : "Rename"}
          </button>
        </>
      }
    >
      <div className="vault-field">
        <label htmlFor="rename-input">New name</label>
        <input
          id="rename-input"
          ref={inputRef}
          type="text"
          className="vault-input"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) {
              setError(null);
            }
          }}
          disabled={submitting}
        />
        <span className="vd-dialog__hint">
          {kind === "drawing"
            ? "Links to this drawing are updated. The .excalidraw extension is kept automatically."
            : "Drawings inside keep their names."}
        </span>
        {error && <div className="vault-error-text">{error}</div>}
      </div>
    </Dialog>
  );
};
