/** The palette command that shows or hides the plugin status bar (`plugins.status_bar`). */
import { registerCommandHandlers } from "../../commands/handlerRegistry";
import { registerCommands } from "../../commands/registry";
import { getPreferences, updatePreferences } from "../../vault/preferences";

export const TOGGLE_STATUS_BAR = "plugins.toggleStatusBar";
export const TOGGLE_TOOLBAR = "plugins.toggleToolbar";

export function registerStatusBarCommands(win: Window): () => void {
  const offCommand = registerCommands([
    {
      id: TOGGLE_STATUS_BAR,
      title: "Toggle plugin status bar",
      category: "View",
      keys: { default: [] },
      palette: true,
    },
    {
      id: TOGGLE_TOOLBAR,
      title: "Toggle plugin toolbar",
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
    [TOGGLE_TOOLBAR]: () => {
      updatePreferences(
        { pluginsToolbar: !getPreferences(win).pluginsToolbar },
        win,
      );
    },
  });
  return () => {
    offHandler();
    offCommand();
  };
}
