import { useEffect, useRef, useState } from "react";

import { registerCommandHandlers } from "../commands/handlerRegistry";

import { GIT_NOTICE_TEXT } from "./historyConfirms";
import { dismissGitNotice, isGitNoticeDismissed } from "./gitNoticeState";
import { HISTORY_COMMAND_IDS } from "./historyCommands";

import type { HistoryStatus } from "./types";

export interface GitNoticeProps {
  status: HistoryStatus | null;
  /** Key of "Not now" (the vault path; the handle when unknown). */
  vaultKey: string;
  disabled?: boolean;
  onExclude: () => void | Promise<void>;
  ownerWindow?: Window | null;
}

/** One-time note at the top of the panel in git vaults whose history is not excluded. */
export const GitNotice = ({
  status,
  vaultKey,
  disabled = false,
  onExclude,
  ownerWindow,
}: GitNoticeProps) => {
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const shown =
    !!status?.gitRepo &&
    !status.gitExcluded &&
    dismissedKey !== vaultKey &&
    !isGitNoticeDismissed(vaultKey, ownerWindow);
  const dismiss = () => {
    dismissGitNotice(vaultKey, ownerWindow);
    setDismissedKey(vaultKey);
  };
  const liveDismiss = useRef(dismiss);
  liveDismiss.current = dismiss;
  // command audit (S8): "Dismiss the git notice" is offered only while the notice shows.
  useEffect(
    () =>
      shown
        ? registerCommandHandlers({
            [HISTORY_COMMAND_IDS.dismissGitNotice]: () => liveDismiss.current(),
          })
        : undefined,
    [shown],
  );
  if (!shown) {
    return null;
  }
  return (
    <div
      className="vault-history-panel__notice"
      role="note"
      data-testid="history-git-notice"
    >
      <p>{GIT_NOTICE_TEXT}</p>
      <div className="vault-history-panel__notice-actions">
        <button
          type="button"
          className="vault-btn vault-btn--sm"
          disabled={disabled}
          onClick={() => void onExclude()}
        >
          Exclude history from git
        </button>
        <button
          type="button"
          className="vault-btn vault-btn--ghost vault-btn--sm"
          onClick={dismiss}
        >
          Not now
        </button>
      </div>
    </div>
  );
};
