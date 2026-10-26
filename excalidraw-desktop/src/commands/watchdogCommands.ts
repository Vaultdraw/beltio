/** Hang watchdog commands. Handlers are bound by watchdog/WatchdogHost.tsx. */
import type { CommandDefinition } from "./types";

export const WATCHDOG_COMMAND_IDS = {
  toggle: "watchdog.toggle",
  showLastHang: "watchdog.showLastHang",
} as const;

export const WATCHDOG_COMMANDS: CommandDefinition[] = [
  {
    id: WATCHDOG_COMMAND_IDS.toggle,
    title: "Hang watchdog: Turn on or off",
    category: "Hang watchdog",
    keys: { default: [] },
    when: ["vaultOpen", "!modalOpen"],
  },
  {
    id: WATCHDOG_COMMAND_IDS.showLastHang,
    title: "Hang watchdog: Show the last hang",
    category: "Hang watchdog",
    keys: { default: [] },
    when: ["vaultOpen", "!modalOpen"],
  },
];
