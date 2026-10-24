/** The Rust side of the plugin host (src-tauri/src/plugins), behind an interface so tests inject a fake. */
import { detectPlatform } from "../../commands/keys";

import type { PluginInfo, PluginsList } from "./types";

export interface PluginsBackend {
  list(rescan?: boolean): Promise<PluginsList>;
  installFolder(path: string): Promise<PluginInfo>;
  uninstall(id: string): Promise<void>;
  setHostDisabled(id: string, reason: string | null): Promise<void>;
  /** The user confirmed `seen`; refused (CONFLICT) when the manifest declares something else now. */
  consentConfirm(id: string, seen: string[]): Promise<void>;
  /** Records that this launch started fine (clears the crash counter). */
  launchOk(): Promise<void>;
  /** Arms safe mode for the next launch, then quits and relaunches. */
  restartSafeMode(): Promise<void>;
  /** Quits and relaunches the app. */
  restart(): Promise<void>;
  /** Opens a plugin's folder (or the user plugins folder for null) in the file manager. */
  openDir(id: string | null): Promise<void>;
  /** Native folder picker; null when cancelled. */
  pickFolder(): Promise<string | null>;
  /** Dev plugin files changed on disk; resolves to an unsubscribe. */
  onChanged(cb: (id: string) => void): Promise<() => void>;
  /** URL the module of `path` inside plugin `id` is imported from. */
  moduleUrl(id: string, path: string): string;
  /** The plugin API gateway (`plugin_call`): allowlist, permission and consent checked in Rust. */
  pluginCall(
    pluginId: string,
    method: string,
    params: Record<string, unknown> | null,
  ): Promise<unknown>;
  /** Plugins with saved data (`storage.global`) and its size in bytes. */
  dataList(): Promise<{ id: string; bytes: number }[]>;
  /** Deletes a plugin's saved data; resolves to whether there was any. */
  dataDelete(id: string): Promise<boolean>;
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
    consentConfirm: async (id, seen) => {
      await call("plugins_consent_confirm", { id, seen });
    },
    launchOk: async () => {
      await call("plugins_launch_ok", {});
    },
    restartSafeMode: async () => {
      await call("plugins_restart_safe_mode", {});
    },
    restart: async () => {
      await call("plugins_restart", {});
    },
    openDir: async (id) => {
      await call("plugins_open_dir", { id });
    },
    pickFolder: () => call<string | null>("plugins_pick_folder", {}),
    pluginCall: (pluginId, method, params) =>
      call<unknown>("plugin_call", { pluginId, method, params }),
    dataList: () =>
      call<{ id: string; bytes: number }[]>("plugins_data_list", {}),
    dataDelete: (id) => call<boolean>("plugins_data_delete", { id }),
    onChanged: async (cb) =>
      (await import("@tauri-apps/api/event")).listen<{ id: string }>(
        "plugins://changed",
        (e) => cb(e.payload.id),
      ),
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
