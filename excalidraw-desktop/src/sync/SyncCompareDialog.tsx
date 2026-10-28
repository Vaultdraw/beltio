/**
 * Two versions of one drawing side by side, read-only: the original and its conflict copy.
 * The editor is a lazy chunk and nothing here loads until the dialog opens.
 */
import { lazy, Suspense, useEffect, useState } from "react";

import { restoreAppState, restoreElements } from "@excalidraw/excalidraw";

import { Dialog } from "../components/Dialog";
import { fileLevelAppState } from "../history/restore";
import { errorMessage } from "../vault/types";

import "./sync.css";

import type { LoadedVersion } from "../history/preview/versionCache";
import type { VaultRepository } from "../vault/types";
import type { Keep } from "./resolveConflict";

const VersionPreview = lazy(() => import("../history/preview/VersionPreview"));

const parse = (id: string, revision: string, json: string): LoadedVersion => {
  const data = JSON.parse(json);
  const elements = restoreElements(data?.elements, null);
  return {
    id,
    fileRevision: revision,
    elements,
    appState: fileLevelAppState(restoreAppState(data?.appState, null)),
    files: data?.files ?? {},
    imagesLoaded: true,
    elementCount: elements.filter((e) => !e.isDeleted).length,
  };
};

interface Props {
  repository: Pick<VaultRepository, "readDrawing">;
  handle: string;
  original: string;
  copy: string;
  theme: "light" | "dark";
  readOnly: boolean;
  /** Resolves the conflict; the dialog stays open and shows the error if it fails. */
  onKeep: (keep: Keep) => Promise<void>;
  onClose: () => void;
}

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export const SyncCompareDialog = ({
  repository,
  handle,
  original,
  copy,
  theme,
  readOnly,
  onKeep,
  onClose,
}: Props) => {
  const [versions, setVersions] = useState<{
    original: LoadedVersion;
    copy: LoadedVersion;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      repository.readDrawing(handle, original),
      repository.readDrawing(handle, copy),
    ])
      .then(([o, c]) => {
        if (!cancelled) {
          setVersions({
            original: parse("original", o.revision, o.json),
            copy: parse("copy", c.revision, c.json),
          });
        }
      })
      .catch((e: unknown) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [repository, handle, original, copy]);

  const keep = async (which: Keep) => {
    setBusy(true);
    setError(null);
    try {
      await onKeep(which);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const pane = (
    label: string,
    path: string,
    v: LoadedVersion | undefined,
    testId: string,
  ) => (
    <section className="vault-sync-compare__pane" data-testid={testId}>
      <header>
        <strong>{label}</strong> <span title={path}>{baseName(path)}</span>
        {v && (
          <span className="vault-sync-compare__count">
            {v.elementCount} element{v.elementCount === 1 ? "" : "s"}
          </span>
        )}
      </header>
      <div className="vault-sync-compare__canvas">
        {v && (
          <Suspense fallback={null}>
            <VersionPreview
              version={v}
              initialViewport={null}
              theme={theme}
              name={baseName(path)}
            />
          </Suspense>
        )}
      </div>
    </section>
  );

  return (
    <Dialog
      title="Compare with conflict copy"
      titleId="sync-compare-title"
      testId="sync-compare-dialog"
      className="vd-dialog--wide vault-sync-compare"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button
            type="button"
            className="vault-btn vault-btn--ghost"
            onClick={onClose}
            disabled={busy}
          >
            Close
          </button>
          <button
            type="button"
            className="vault-btn"
            data-testid="sync-keep-copy"
            disabled={busy || readOnly || !versions}
            onClick={() => void keep("copy")}
          >
            Keep the conflict copy
          </button>
          <button
            type="button"
            className="vault-btn vault-btn--primary"
            data-testid="sync-keep-original"
            disabled={busy || readOnly || !versions}
            onClick={() => void keep("original")}
          >
            Keep the original
          </button>
        </>
      }
    >
      <p>
        The version you do not keep is saved in the original&apos;s history; the
        conflict copy then goes to the Trash.
      </p>
      {error && <div className="vd-notice">{error}</div>}
      <div className="vault-sync-compare__grid">
        {pane("Original", original, versions?.original, "sync-pane-original")}
        {pane("Conflict copy", copy, versions?.copy, "sync-pane-copy")}
      </div>
    </Dialog>
  );
};
