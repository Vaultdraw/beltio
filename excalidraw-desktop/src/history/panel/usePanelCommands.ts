/**
 * Binds the panel-scoped History commands while the panel is mounted, so a
 * closed panel offers none of them. Commands that need a selected version are
 * bound only while one is selected; copySelection also needs a preview
 * selection. A command without a handler is simply not offered.
 */
import { useEffect, useRef } from "react";

import { registerCommandHandlers } from "../../commands/handlerRegistry";
import { HISTORY_COMMAND_IDS as I } from "../historyCommands";

export interface PanelActions {
  previous(): void;
  next(): void;
  restore(): void;
  restoreReplace(): void | Promise<void>;
  restoreCopy(): void | Promise<void>;
  copySelection(): void;
  exportExcalidraw(): void | Promise<void>;
  exportImage(): void;
  backToCurrent(): void;
}

export function usePanelCommands(
  actions: PanelActions,
  state: { hasVersion: boolean; hasSelection: boolean },
): void {
  const live = useRef(actions);
  live.current = actions;
  const { hasVersion, hasSelection } = state;
  useEffect(() => {
    const run = (name: keyof PanelActions) => () => live.current[name]();
    return registerCommandHandlers({
      [I.previous]: run("previous"),
      [I.next]: run("next"),
      ...(hasVersion && {
        [I.restore]: run("restore"),
        [I.restoreReplace]: run("restoreReplace"),
        [I.restoreCopy]: run("restoreCopy"),
        [I.exportExcalidraw]: run("exportExcalidraw"),
        [I.exportImage]: run("exportImage"),
        // command audit (S8)
        [I.backToCurrent]: run("backToCurrent"),
      }),
      ...(hasVersion &&
        hasSelection && { [I.copySelection]: run("copySelection") }),
    });
  }, [hasVersion, hasSelection]);
}
