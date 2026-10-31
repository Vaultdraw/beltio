/**
 * Binds the two hang watchdog palette commands; nothing else runs until one is used. macOS only,
 * where the watchdog runs: elsewhere the commands stay unbound, so the palette does not offer them.
 */
import { useEffect } from "react";

import { registerCommandHandlers } from "../commands/handlerRegistry";
import { detectPlatform } from "../commands/keys";
import { WATCHDOG_COMMAND_IDS } from "../commands/watchdogCommands";

import { showLastHang, toggleWatchdog } from "./watchdog";

export const WatchdogHost = ({ win }: { win: Window | null }) => {
  useEffect(
    () =>
      detectPlatform(win) !== "mac"
        ? undefined
        : registerCommandHandlers({
            [WATCHDOG_COMMAND_IDS.toggle]: () => toggleWatchdog(win),
            [WATCHDOG_COMMAND_IDS.showLastHang]: () => {
              void showLastHang();
            },
          }),
    [win],
  );
  return null;
};
