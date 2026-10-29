import { stripDrawingExt } from "../vault/fileKind";
import { useCommandShortcut } from "../commands/useCommandShortcut";

import { isCustomChrome } from "../vault/windowChrome";

import { HistoryButton } from "./HistoryButton";
import { OfflineBadge } from "./OfflineBadge";
import { IconAlert, IconHistory, IconSidebar } from "./Icons";
import { ReadOnlyBadge } from "./readonly/ReadOnlyBadge";
import { WindowControls } from "./WindowControls";

import type { SaveStatus, VaultInfo } from "../vault/types";

interface VaultHeaderProps {
  vault: VaultInfo | null;
  activePath: string | null;
  saveStatus: SaveStatus;
  saveError?: string | null;
  recoveryCount?: number;
  navigatorCollapsed: boolean;
  onToggleNavigator: () => void;
  onOpenConflict: () => void;
  onOpenRecovery: () => void;
  onSave?: () => void;
  /** Header "History" button (shown while a drawing is open): history.toggle. */
  onToggleHistory?: () => void;
  /** Read-only badge "Try again" (vault.retryWritable). */
  onRetryWritable?: () => void | Promise<void>;
}

export const VaultHeader = ({
  vault,
  activePath,
  saveStatus,
  saveError,
  recoveryCount = 0,
  navigatorCollapsed,
  onToggleNavigator,
  onOpenConflict,
  onOpenRecovery,
  onSave,
  onToggleHistory,
  onRetryWritable,
}: VaultHeaderProps) => {
  const toggleKeys = useCommandShortcut("view.toggleNavigator");
  const saveKeys = useCommandShortcut("file.save");
  if (!vault) {
    return null;
  }

  const pathParts = activePath ? activePath.split("/") : [];
  const fileName = pathParts.pop();

  return (
    // `data-tauri-drag-region` makes the bar drag the window (it doubles as the
    // macOS title bar). Tauri only honours it on the element that is clicked,
    // so non-interactive children carry it too.
    <header className="vault-header" role="banner" data-tauri-drag-region>
      <div className="vault-header__left" data-tauri-drag-region>
        <nav
          className="vault-breadcrumbs"
          aria-label="Breadcrumb"
          data-tauri-drag-region
        >
          <span
            className="vault-breadcrumbs__item"
            title={vault.name}
            data-tauri-drag-region
          >
            {vault.name}
          </span>
          {pathParts.map((part, index) => (
            <span
              key={index}
              className="vault-breadcrumbs__segment"
              data-tauri-drag-region
            >
              <span className="vault-breadcrumbs__sep" data-tauri-drag-region>
                /
              </span>
              <span
                className="vault-breadcrumbs__item"
                title={part}
                data-tauri-drag-region
              >
                {part}
              </span>
            </span>
          ))}
          {fileName && (
            <span className="vault-breadcrumbs__segment" data-tauri-drag-region>
              <span className="vault-breadcrumbs__sep" data-tauri-drag-region>
                /
              </span>
              <span
                className="vault-breadcrumbs__item vault-breadcrumbs__item--active"
                title={fileName}
                data-tauri-drag-region
              >
                {stripDrawingExt(fileName)}
              </span>
            </span>
          )}
        </nav>
      </div>

      <div className="vault-header__center" data-tauri-drag-region>
        {vault.readOnly && (
          <ReadOnlyBadge vault={vault} onRetry={onRetryWritable} />
        )}

        <OfflineBadge />

        {recoveryCount > 0 && (
          <button
            type="button"
            className="vault-badge vault-badge--recovery"
            onClick={onOpenRecovery}
            title={`${recoveryCount} recoverable ${
              recoveryCount === 1 ? "snapshot" : "snapshots"
            }. Click to review.`}
          >
            <IconHistory />
            <span>
              {recoveryCount} Recovery Snapshot{recoveryCount > 1 ? "s" : ""}
            </span>
          </button>
        )}

        {activePath && (
          <>
            {saveStatus === "saved" && (
              <span
                className="vault-status vault-status--saved"
                title="All edits saved to disk"
                role="status"
              >
                <i className="vault-status__dot" />
                <span>Saved</span>
              </span>
            )}
            {saveStatus === "dirty" && (
              <button
                type="button"
                className="vault-status vault-status--dirty"
                onClick={onSave}
                disabled={!onSave || vault.readOnly}
                title={saveKeys ? `Save now (${saveKeys})` : "Save now"}
                aria-label="Save drawing"
              >
                <span className="vault-status__dot" />
                <span>Unsaved</span>
              </button>
            )}
            {saveStatus === "saving" && (
              <span
                className="vault-status vault-status--saving"
                title="Saving…"
                role="status"
              >
                <span className="vault-spinner" />
                <span>Saving…</span>
              </span>
            )}
            {saveStatus === "conflict" && (
              <button
                type="button"
                className="vault-badge vault-badge--conflict"
                onClick={onOpenConflict}
                title={
                  saveError ??
                  "File changed externally. Click to resolve conflict."
                }
              >
                <IconAlert />
                <span>Conflict</span>
              </button>
            )}
            {saveStatus === "error" && (
              <button
                type="button"
                className="vault-badge vault-badge--error"
                onClick={onOpenConflict}
                title={saveError ?? "Error saving file. Click for details."}
              >
                <IconAlert />
                <span>Not saved</span>
              </button>
            )}
          </>
        )}
      </div>

      <div className="vault-header__right">
        {activePath && onToggleHistory && (
          <HistoryButton onClick={onToggleHistory} />
        )}
        <button
          type="button"
          className="vault-ibtn"
          onClick={onToggleNavigator}
          title={`${navigatorCollapsed ? "Show navigator" : "Hide navigator"}${
            toggleKeys ? ` (${toggleKeys})` : ""
          }`}
          aria-label={navigatorCollapsed ? "Show navigator" : "Hide navigator"}
          aria-expanded={!navigatorCollapsed}
        >
          <IconSidebar />
        </button>
        {isCustomChrome(window) && <WindowControls />}
      </div>
    </header>
  );
};
