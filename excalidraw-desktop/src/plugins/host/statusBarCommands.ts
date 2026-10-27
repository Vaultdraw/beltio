/** The palette command that shows or hides the plugin status bar (`plugins.status_bar`). */
import { registerCommandHandlers } from "../../commands/handlerRegistry";
import { registerCommands } from "../../commands/registry";
import { getPreferences, updatePreferences } from "../../vault/preferences";

export const TOGGLE_STATUS_BAR = "plugins.toggleStatusBar";

export function registerStatusBarCommands(win: Window): () => void {
  const offCommand = registerCommands([
    {
      id: TOGGLE_STATUS_BAR,
      title: "Toggle plugin status bar",
      category: "View",
      keys: { default: [] },
      palette: true,
    },
  ]);
  const offHandler = registerCommandHandlers({
    [TOGGLE_STATUS_BAR]: () => {
      updatePreferences(
        { pluginsStatusBar: !getPreferences(win).pluginsStatusBar },
        win,
      );
    },
  });
  return () => {
    offHandler();
    offCommand();
  };
}
