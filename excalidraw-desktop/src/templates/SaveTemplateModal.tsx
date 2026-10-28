import { useEffect, useRef, useState } from "react";

import { IconClose } from "../components/Icons";
import { getCleanDrawingName, validateEntryName } from "../vault/treeStore";

import "./SaveTemplateModal.css";

export type TemplateScope = "vault" | "global";

interface SaveTemplateModalProps {
  defaultName: string;
  ownerDocument?: Document | null;
  onSave: (name: string, scope: TemplateScope) => Promise<void>;
  onCancel: () => void;
  readOnlyVault: boolean;
}

export const SaveTemplateModal = ({
  defaultName,
  ownerDocument,
  onSave,
  onCancel,
  readOnlyVault,
}: SaveTemplateModalProps) => {
  const [name, setName] = useState(getCleanDrawingName(defaultName));
  const [scope, setScope] = useState<TemplateScope>(
    readOnlyVault ? "global" : "vault",
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    if (!ownerDocument) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    ownerDocument.addEventListener("keydown", onKeyDown);
    return () => ownerDocument.removeEventListener("keydown", onKeyDown);
  }, [onCancel, ownerDocument]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) {
      return;
    }
    const clean = getCleanDrawingName(name);
    const validation = validateEntryName(`${clean}.excalidraw`, "drawing");
    if (!validation.valid) {
      setError(validation.error ?? "Invalid name");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSave(clean, scope);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <div
      className="vault-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-template-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <div className="vault-modal">
        <form onSubmit={handleSubmit}>
          <div className="vault-modal__header">
            <h3 id="save-template-title" className="vault-modal__title">
              Save as template
            </h3>
            <button
              type="button"
              className="vault-btn vault-btn--ghost vault-btn--icon"
              onClick={onCancel}
              aria-label="Close"
            >
              <IconClose />
            </button>
          </div>
          <div className="vault-modal__body">
            <div className="vault-field">
              <label htmlFor="save-template-name">Template name</label>
              <input
                id="save-template-name"
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
            </div>
            <fieldset className="save-template__scope" disabled={submitting}>
              <legend>Available in</legend>
              <label>
                <input
                  type="radio"
                  name="save-template-scope"
                  checked={scope === "vault"}
                  disabled={readOnlyVault}
                  onChange={() => setScope("vault")}
                />
                This vault
                {readOnlyVault && " (read-only)"}
              </label>
              <label>
                <input
                  type="radio"
                  name="save-template-scope"
                  checked={scope === "global"}
                  onChange={() => setScope("global")}
                />
                All vaults (global)
              </label>
            </fieldset>
            {error && <div className="vault-error-text">{error}</div>}
          </div>
          <div className="vault-modal__footer">
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
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
