/** `ctx.storage`: built on the first read of `ctx.storage`; the store loads on its first call. */
import { toastStore } from "../../toasts/toastStore";
import { getPreferences } from "../../vault/preferences";

import { utf8Length } from "../../../../sdk/api/shared/rules";

import { errorText, logLine } from "./errors";
import { createGateway } from "./gateway";

import { createPluginStore, getPluginStore, limitKbOr } from "./storage";

import type { Disposable, Json, StorageApi } from "../api";
import type { PluginRuntime } from "./types";

export function createStorageApi(
  rt: PluginRuntime,
  win: Window,
  track: (fn: () => void) => Disposable,
): StorageApi {
  const { id, name } = rt.info;
  const store = getPluginStore(id, () => {
    const call = createGateway(id);
    return createPluginStore({
      io: {
        read: () =>
          call<{ data: Record<string, Json> | null; corrupt: boolean }>(
            "storage.read",
          ),
        write: (text) => call("storage.write", { text }, utf8Length(text)),
      },
      limitKb: () => limitKbOr(getPreferences(win).pluginsStorageLimitKb),
      onCorrupt: () => {
        logLine(
          id,
          "warn",
          "Saved data was unreadable; renamed it data.json.bad and started empty",
        );
        toastStore.push({
          message: `${name}: its saved data was unreadable, so it starts empty (kept as a data.json.bad file).`,
          kind: "error",
        });
      },
      // A failed write is not the plugin's fault: logged, not counted towards switching it off.
      onWriteError: (err) => {
        // eslint-disable-next-line no-console
        console.error(`[plugin ${id}] storage write failed`, err);
        logLine(id, "error", `storage: write failed: ${errorText(err)}`);
      },
      setTimer: (fn, ms) => win.setTimeout(fn, ms),
      clearTimer: (h) => win.clearTimeout(h as number),
      now: () => performance.now(),
    });
  });
  // Pending writes reach the disk when the plugin is disabled or reloaded.
  track(() => void store.flush());
  const global = {
    get: store.get,
    set: store.set,
    delete: store.delete,
    keys: store.keys,
  };
  return Object.freeze({ global: Object.freeze(global) });
}
