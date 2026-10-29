import { useCallback, useEffect, useState } from "react";

import { duplicateName, getBaseName } from "../vault/treeStore";

import { userError } from "./userError";

import { Dialog } from "./Dialog";
import { ConfirmModal } from "./ConfirmModal";
import { IconTrash } from "./Icons";
import { Path } from "./Path";

import type { RecoveryEntry, VaultRepository } from "../vault/types";

interface RecoveryDialogProps {
  handle: string;
  repository: VaultRepository;
  onOpenRecovered: (path: string, json: string) => void | Promise<void>;
  onClose: () => void;
}

export const RecoveryDialog = ({
  handle,
  repository,
  onOpenRecovered,
  onClose,
}: RecoveryDialogProps) => {
  const [entries, setEntries] = useState<RecoveryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const list = await repository.listRecovery(handle);
      setEntries(list);
    } catch (err: unknown) {
      setError(userError(err));
    } finally {
      setLoading(false);
    }
  }, [handle, repository]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  const handleDiscard = async (id: string) => {
    setProcessingId(id);
    setError(null);
    try {
      await repository.discardRecovery(handle, id);
      setEntries((prev) => prev.filter((item) => item.id !== id));
    } catch (err: unknown) {
      setError(userError(err));
    } finally {
      setProcessingId(null);
    }
  };

  const handleRestore = async (entry: RecoveryEntry) => {
    setProcessingId(entry.id);
    setError(null);
    try {
      const recoveredPath = duplicateName(entry.path);
      await onOpenRecovered(recoveredPath, entry.json);
      onClose();
    } catch (err: unknown) {
      setError(userError(err));
      setProcessingId(null);
    }
  };

  const [confirmDiscard, setConfirmDiscard] = useState<RecoveryEntry | null>(
    null,
  );
  return (
    <>
      <Dialog
        title="Recoverable snapshots"
        titleId="recovery-dialog-title"
        className="vd-dialog--wide"
        onClose={onClose}
        footer={
          <button type="button" className="vault-btn" onClick={onClose}>
            Close
          </button>
        }
      >
        <p className="vd-dialog__lede">
          These snapshots were saved locally before a crash or external
          conflict. Open one as a new copy (your current files are not touched)
          or discard it for good.
        </p>

        {loading ? (
          <div
            style={{
              textAlign: "center",
              padding: "24px 0",
              color: "var(--vault-text-muted)",
            }}
          >
            Loading snapshots…
          </div>
        ) : entries.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "24px 0",
              color: "var(--vault-text-muted)",
            }}
          >
            No recoverable snapshots found for this vault.
          </div>
        ) : (
          <div className="vault-recovery-list">
            {entries.map((entry) => {
              const dateStr = new Date(entry.modifiedAt).toLocaleString();
              const isWorking = processingId === entry.id;

              return (
                <div key={entry.id} className="vault-recovery-item">
                  <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                    <Path
                      path={entry.path}
                      className="vault-recovery-item__path"
                    />
                    <div className="vault-recovery-item__time">
                      {dateStr} • {getBaseName(entry.path)}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: "6px",
                      alignItems: "center",
                    }}
                  >
                    <button
                      type="button"
                      className="vault-btn vault-btn--sm"
                      onClick={() => void handleRestore(entry)}
                      disabled={isWorking}
                    >
                      Open as Copy
                    </button>
                    <button
                      type="button"
                      className="vault-btn vault-btn--ghost vault-btn--sm"
                      onClick={() => setConfirmDiscard(entry)}
                      disabled={isWorking}
                      aria-label="Discard snapshot"
                      title="Discard snapshot"
                    >
                      <IconTrash />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {error && (
          <div className="vault-error-text" style={{ marginTop: "12px" }}>
            {error}
          </div>
        )}
      </Dialog>
      {confirmDiscard && (
        <ConfirmModal
          title="Discard snapshot?"
          message={`The snapshot of ${getBaseName(
            confirmDiscard.path,
          )} is deleted for good. This can't be undone.`}
          confirmLabel="Discard"
          isDanger
          onCancel={() => setConfirmDiscard(null)}
          onConfirm={() => {
            const id = confirmDiscard.id;
            setConfirmDiscard(null);
            void handleDiscard(id);
          }}
        />
      )}
    </>
  );
};
