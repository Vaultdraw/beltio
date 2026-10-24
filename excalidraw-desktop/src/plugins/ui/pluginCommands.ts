/**
 * Palette commands for managing plugins (category "Plugins"). The host adds
 * the safe-mode commands itself.
 */
import {
  installPluginFromFolder,
  openPluginsFolder,
  reloadPluginList,
} from "./pluginActions";

import type { CommandDefinition, CommandHandlers } from "../../commands/types";

export const PLUGIN_UI_COMMAND_IDS = {
  openSettings: "plugins.openSettings",
  installFolder: "plugins.installFolder",
  reloadList: "plugins.reloadList",
  openFolder: "plugins.openFolder",
  deleteData: "plugins.deleteData",
} as const;

const I = PLUGIN_UI_COMMAND_IDS;

const command = (id: string, title: string): CommandDefinition => ({
  id,
  title: `Plugins: ${title}`,
  category: "Plugins",
  keys: { default: [] },
  when: ["vaultOpen", "!modalOpen"],
});

export const PLUGIN_UI_COMMANDS: CommandDefinition[] = [
  command(I.openSettings, "Open plugin settings"),
  command(I.installFolder, "Install from folder…"),
  command(I.reloadList, "Reload plugin list"),
  command(I.openFolder, "Open plugins folder"),
  command(I.deleteData, "Delete data of a plugin…"),
];

let deleteDataRequested = false;

/** The Plugins page asks once whether it was opened by "Delete data of a plugin…". */
export const takeDeleteDataRequest = (): boolean => {
  const was = deleteDataRequested;
  deleteDataRequested = false;
  return was;
};

/** `openSettings` is bound by the shell (it owns the Settings modal). */
export const pluginUiHandlers = (
  openSettings: () => void,
): CommandHandlers => ({
  [I.openSettings]: openSettings,
  [I.installFolder]: () => void installPluginFromFolder(),
  [I.reloadList]: () => void reloadPluginList(),
  [I.openFolder]: () => void openPluginsFolder(),
  // Opens Settings → Plugins with the first "Delete data" button focused.
  [I.deleteData]: () => {
    deleteDataRequested = true;
    openSettings();
  },
});
