/** Binds the two hang watchdog palette commands; nothing else runs until one is used. */
import { useEffect } from "react";

import { registerCommandHandlers } from "../commands/handlerRegistry";
import { WATCHDOG_COMMAND_IDS } from "../commands/watchdogCommands";

import { showLastHang, toggleWatchdog } from "./watchdog";

export const WatchdogHost = ({ win }: { win: Window | null }) => {
  useEffect(
    () =>
      registerCommandHandlers({
        [WATCHDOG_COMMAND_IDS.toggle]: () => toggleWatchdog(win),
        [WATCHDOG_COMMAND_IDS.showLastHang]: () => {
          void showLastHang();
        },
      }),
    [win],
  );
  return null;
};
