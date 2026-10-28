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
  browse: "plugins.browse",
  browseRefresh: "plugins.browseRefresh",
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
  command(I.browse, "Browse community plugins…"),
  command(I.browseRefresh, "Refresh the community plugins list…"),
];

// "Delete data of a plugin…" requests: a counter the Plugins page watches, so a
// request reaches a page that is already open and never fires twice.
let deleteDataRequests = 0;
let deleteDataHandled = 0;
const deleteDataListeners = new Set<() => void>();

export const deleteDataRequest = {
  get: (): number => deleteDataRequests,
  subscribe: (fn: () => void): (() => void) => {
    deleteDataListeners.add(fn);
    return () => void deleteDataListeners.delete(fn);
  },
  /** True once per request: the caller acts on it. */
  take: (): boolean => {
    if (deleteDataHandled >= deleteDataRequests) {
      return false;
    }
    deleteDataHandled = deleteDataRequests;
    return true;
  },
};

// "Browse community plugins…" requests, handled like the one above; `force` fetches the list again.
let browseRequests = 0;
let browseHandled = 0;
let browseForce = false;
const browseListeners = new Set<() => void>();

export const browseRequest = {
  get: (): number => browseRequests,
  subscribe: (fn: () => void): (() => void) => {
    browseListeners.add(fn);
    return () => void browseListeners.delete(fn);
  },
  /** `{ force }` once per request, then null. */
  take: (): { force: boolean } | null => {
    if (browseHandled >= browseRequests) {
      return null;
    }
    browseHandled = browseRequests;
    const force = browseForce;
    browseForce = false;
    return { force };
  },
};

const requestBrowse = (force: boolean, openSettings: () => void) => {
  browseRequests++;
  browseForce = force;
  browseListeners.forEach((fn) => fn());
  openSettings();
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
  [I.browse]: () => requestBrowse(false, openSettings),
  [I.browseRefresh]: () => requestBrowse(true, openSettings),
  [I.deleteData]: () => {
    deleteDataRequests++;
    deleteDataListeners.forEach((fn) => fn());
    openSettings();
  },
});
