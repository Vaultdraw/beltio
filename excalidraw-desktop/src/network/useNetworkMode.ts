import { useEffect } from "react";

import { NETWORK_COMMAND_IDS } from "../commands/networkCommands";
import { registerCommandHandlers } from "../commands/handlerRegistry";

import { setOfflineMode } from "./offlineMode";
import { scheduleStartupUpdateCheck } from "./startupUpdateCheck";

/** Binds the Offline mode command and schedules the quiet update check (once per launch). */
export function useNetworkMode(win: Window = window): void {
  useEffect(
    () =>
      registerCommandHandlers({
        [NETWORK_COMMAND_IDS.toggleOffline]: () => {
          setOfflineMode(undefined, win);
        },
      }),
    [win],
  );
  useEffect(() => scheduleStartupUpdateCheck(win), [win]);
}
