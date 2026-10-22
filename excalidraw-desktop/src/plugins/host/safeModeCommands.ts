/** Palette commands for restarting the app in or out of plugin safe mode. */
import { registerCommandHandlers } from "../../commands/handlerRegistry";
import { registerCommands } from "../../commands/registry";

import { getPluginsBackend } from "./backend";
import { restartInSafeMode } from "./manage";

import type { CommandDefinition } from "../../commands/types";

const def = (id: string, title: string): CommandDefinition => ({
  id,
  title,
  category: "Plugins",
  keys: { default: [] },
  palette: true,
});

/** Normal launch offers "Restart in safe mode"; safe mode offers "Restart normally". */
export function registerSafeModeCommands(inSafeMode: boolean): () => void {
  const [command, run] = inSafeMode
    ? ([
        def("plugins.restartNormally", "Restart normally"),
        () => void getPluginsBackend().restart(),
      ] as const)
    : ([
        def("plugins.restartSafeMode", "Restart in safe mode"),
        () => void restartInSafeMode(),
      ] as const);
  const offCommand = registerCommands([command]);
  const offHandler = registerCommandHandlers({ [command.id]: run });
  return () => {
    offHandler();
    offCommand();
  };
}
