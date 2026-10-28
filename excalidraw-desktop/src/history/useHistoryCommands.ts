/**
 * Binds the app-level History command handlers (the ones that exist whenever a
 * vault is open). Handlers that only make sense while the panel is mounted bind
 * themselves with registerCommandHandlers in the panel.
 */
import { useEffect, useRef } from "react";

import { registerCommandHandlers } from "../commands/handlerRegistry";

import { HISTORY_COMMAND_IDS } from "./historyCommands";

export interface HistoryActions {
  checkpoint(): void;
  toggle(): void;
  timeTravel(): void;
  /** Bound (offered in the palette) only while a handler is given. */
  deleteAll?: () => void;
  excludeFromGit?: () => void;
}

export function useHistoryCommands(actions: HistoryActions, on = true): void {
  const live = useRef(actions);
  live.current = actions;
  const canDeleteAll = !!actions.deleteAll;
  const canExclude = !!actions.excludeFromGit;
  useEffect(
    () =>
      !on
        ? undefined
        : registerCommandHandlers({
            [HISTORY_COMMAND_IDS.checkpoint]: () => live.current.checkpoint(),
            [HISTORY_COMMAND_IDS.toggle]: () => live.current.toggle(),
            [HISTORY_COMMAND_IDS.timeTravel]: () => live.current.timeTravel(),
            ...(canDeleteAll && {
              [HISTORY_COMMAND_IDS.deleteAll]: () => live.current.deleteAll?.(),
            }),
            ...(canExclude && {
              [HISTORY_COMMAND_IDS.excludeFromGit]: () =>
                live.current.excludeFromGit?.(),
            }),
          }),
    [canDeleteAll, canExclude, on],
  );
}
