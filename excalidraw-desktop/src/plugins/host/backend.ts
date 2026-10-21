/** The Rust side of the plugin host (src-tauri/src/plugins), behind an interface so tests inject a fake. */
import { detectPlatform } from "../../commands/keys";

import type { PluginInfo, PluginsList } from "./types";

export interface PluginsBackend {
  list(rescan?: boolean): Promise<PluginsList>;
  installFolder(path: string): Promise<PluginInfo>;
  uninstall(id: string): Promise<void>;
  setHostDisabled(id: string, reason: string | null): Promise<void>;
  /** URL the module of `path` inside plugin `id` is imported from. */
  moduleUrl(id: string, path: string): string;
}

const call = async <T>(cmd: string, args: Record<string, unknown>) =>
  (await import("@tauri-apps/api/core")).invoke<T>(cmd, args);

export function createTauriBackend(win?: Window | null): PluginsBackend {
  const windows = detectPlatform(win) === "win";
  return {
    list: (rescan = false) => call<PluginsList>("plugins_list", { rescan }),
    installFolder: (path) =>
      call<PluginInfo>("plugins_install_folder", { path }),
    uninstall: async (id) => {
      await call("plugins_uninstall", { id });
    },
    setHostDisabled: async (id, reason) => {
      await call("plugins_set_host_disabled", { id, reason });
    },
    moduleUrl: (id, path) =>
      `${
        windows ? "http://vdplugin.localhost" : "vdplugin://localhost"
      }/${id}/${path.split("/").map(encodeURIComponent).join("/")}`,
  };
}

let backend: PluginsBackend | null = null;

export const setPluginsBackend = (next: PluginsBackend | null): void => {
  backend = next;
};

export const getPluginsBackend = (): PluginsBackend =>
  (backend ??= createTauriBackend());
