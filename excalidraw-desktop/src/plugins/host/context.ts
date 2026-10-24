/** Builds the PluginContext of one plugin. Everything registered goes into `subscriptions`. */
import { closePanel, openPanel } from "../../slots/panelStore";
import { toastStore } from "../../toasts/toastStore";
import { subscribePreferences } from "../../vault/preferences";
import { subscribeVaultSettings } from "../../vault/vaultSettings";
import { allowsScope } from "../settings/declaredSettings";
import { getPluginSetting, setPluginSetting } from "../settings/pluginSettings";
import { pluginSettingDecl } from "../settings/registry";

import { errorText, logLine, reportPluginError } from "./errors";
import { guard } from "./guard";
import { createHostApi } from "./hostContext";
import { runCommandById } from "./runner";
import { createGatedEventsApi } from "./eventGate";
import {
  abortPluginImport,
  clearImporters,
  removeImporter,
  setImporter,
} from "./importerRegistry";
import { createSceneApi } from "./sceneContext";
import { createThemeApi } from "./themeContext";
import { createStorageApi } from "./storageContext";
import { createVaultApi } from "./vaultContext";
import { createWorkspaceApi } from "./workspaceContext";

import type {
  Disposable,
  HostApi,
  ImportersApi,
  PluginContext,
  PluginPermission,
  StorageApi,
  ThemeApi,
  VaultApi,
  WorkspaceApi,
} from "../api";
import type { PluginRuntime } from "./types";
import type { PluginSettingValue } from "../../vault/pluginSettingsTable";

const NOOP: Disposable = { dispose() {} };

let activeTimers = 0;
/** Timers currently scheduled by plugins (leak check for tests and the cost panel). */
export const pluginTimerCount = (): number => activeTimers;

export interface ContextHandle {
  ctx: PluginContext;
  /** Disposes every subscription in reverse order; errors are attributed, never thrown. */
  dispose(): void;
}

export function createPluginContext(
  rt: PluginRuntime,
  win: Window,
): ContextHandle {
  const { info } = rt;
  const id = info.id;
  const subscriptions: Disposable[] = [];
  let stopped = false;
  const isLive = () => !stopped;
  const track = (fn: () => void): Disposable => {
    let done = false;
    const d = {
      dispose() {
        if (!done) {
          done = true;
          fn();
        }
      },
    };
    subscriptions.push(d);
    return d;
  };
  const refuse = (what: string, short: string): Disposable => {
    reportPluginError(
      id,
      new Error(`${what} "${short}" is not declared in plugin.toml`),
      "register",
    );
    return NOOP;
  };
  const declaredCommands = new Set(info.contributes.commands.map((c) => c.id));
  const declaredPanels = new Set(info.contributes.panels.map((p) => p.id));
  const declaredImporters = new Set(
    (info.contributes.importers ?? []).map((i) => i.id),
  );
  const panelId = (short: string) => `${id}.${short}`;

  const timer =
    (
      set: (fn: () => void, ms: number) => number,
      clear: (n: number) => void,
      repeat: boolean,
    ) =>
    (fn: () => void, ms: number): Disposable => {
      const safe = guard(id, fn, "timer");
      activeTimers++;
      let live = true;
      const stop = () => {
        if (live) {
          live = false;
          activeTimers--;
        }
      };
      const handle = set(() => {
        if (!repeat) {
          stop();
        }
        safe();
      }, ms);
      return track(() => {
        clear(handle);
        stop();
      });
    };

  const logger =
    (level: "debug" | "info" | "warn" | "error") =>
    (...a: unknown[]) => {
      // eslint-disable-next-line no-console
      console[level](`[plugin ${id}]`, ...a);
      logLine(id, level, a.map((x) => errorText(x)).join(" "));
    };

  let hostApi: HostApi | undefined;
  let themeApi: ThemeApi | undefined;
  let storageApi: StorageApi | undefined;
  let vaultApi: VaultApi | undefined;
  let workspaceApi: WorkspaceApi | undefined;
  let importersApi: ImportersApi | undefined;

  const settingValue = (key: string) => getPluginSetting(id, key);

  const ctx: PluginContext = {
    manifest: {
      id,
      version: info.version,
      dir: info.dir,
      permissions: Object.freeze([...info.permissions]) as PluginPermission[],
    },
    commands: {
      register(short, run) {
        if (!declaredCommands.has(short)) {
          return refuse("command", short);
        }
        rt.handlers.set(short, run);
        return track(() => {
          if (rt.handlers.get(short) === run) {
            rt.handlers.delete(short);
          }
        });
      },
      execute: (fullId) => runCommandById(fullId),
    },
    panels: {
      register(short, component) {
        if (!declaredPanels.has(short)) {
          return refuse("panel", short);
        }
        rt.components.set(short, component);
        return track(() => {
          if (rt.components.get(short) === component) {
            rt.components.delete(short);
          }
        });
      },
      open(short) {
        if (declaredPanels.has(short)) {
          openPanel(panelId(short));
        }
      },
      close(short) {
        if (declaredPanels.has(short)) {
          closePanel(panelId(short));
        }
      },
    },
    settings: {
      get: <T = unknown>(key: string) => settingValue(key) as T,
      async set(key, value) {
        const decl = pluginSettingDecl(id, key);
        const scope = !decl || allowsScope(decl, "global") ? "global" : "vault";
        const ok = await setPluginSetting(
          id,
          key,
          value as PluginSettingValue,
          scope,
        );
        if (!ok) {
          throw new Error(`Setting "${key}" refused: invalid value or scope`);
        }
      },
      onChange(key, cb) {
        const safe = guard(id, cb, "settings.onChange");
        let last = settingValue(key);
        const check = () => {
          const next = settingValue(key);
          if (next !== last) {
            last = next;
            safe(next);
          }
        };
        const offs = [
          subscribePreferences(check),
          subscribeVaultSettings(check),
        ];
        return track(() => offs.forEach((off) => off()));
      },
    },
    ui: {
      toast: (message) =>
        toastStore.push({ message: `${info.name}: ${String(message)}` }),
    },
    log: {
      debug: logger("debug"),
      info: logger("info"),
      warn: logger("warn"),
      error: logger("error"),
    },
    scene: createSceneApi(id, track, isLive),
    events: createGatedEventsApi(rt, track, isLive),
    // Built on first read: a plugin that never touches them costs nothing.
    get host() {
      return (hostApi ??= createHostApi());
    },
    get theme() {
      return (themeApi ??= createThemeApi(id, win.document, track, isLive));
    },
    get storage() {
      return (storageApi ??= createStorageApi(rt, win, track));
    },
    get vault() {
      return (vaultApi ??= createVaultApi(rt));
    },
    get workspace() {
      return (workspaceApi ??= createWorkspaceApi());
    },
    get importers() {
      return (importersApi ??= {
        register(importerId, importer) {
          if (!declaredImporters.has(importerId)) {
            return refuse("importer", importerId);
          }
          if (!isLive()) {
            return NOOP; // registered after the plugin stopped
          }
          setImporter(rt, importerId, importer);
          return track(() => removeImporter(rt, importerId, importer));
        },
      });
    },
    subscriptions,
    setTimeout: timer(
      (fn, ms) => win.setTimeout(fn, ms),
      (n) => win.clearTimeout(n),
      false,
    ),
    setInterval: timer(
      (fn, ms) => win.setInterval(fn, ms),
      (n) => win.clearInterval(n),
      true,
    ),
  };

  return {
    ctx,
    dispose() {
      stopped = true;
      abortPluginImport(id);
      clearImporters(rt);
      while (subscriptions.length > 0) {
        const d = subscriptions.pop()!;
        try {
          d.dispose();
        } catch (err) {
          reportPluginError(id, err, "dispose");
        }
      }
    },
  };
}
