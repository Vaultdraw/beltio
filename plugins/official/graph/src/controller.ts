/**
 * The graph's state outside the view: mode, per-vault settings (read on the first open of a vault,
 * saved debounced) and the counters the commands bump. A tiny store the overlay subscribes to.
 */
import {
  createGraphSettingsSaver,
  loadGraphSettings,
  type GraphSettingsSaver,
} from "./graphSettingsStore";
import { pluginGraphSource } from "./PluginGraphSource";

import type { PluginContext } from "@vaultdraw/api";
import type { GraphMode, GraphSettings } from "./settings";

export interface ControllerView {
  vault: string;
  currentPath: string | null;
  mode: GraphMode;
  settings: GraphSettings | null;
  fitNonce: number;
  themeKey: string;
}

export function createController(ctx: PluginContext) {
  const listeners = new Set<() => void>();
  let view: ControllerView = {
    vault: "",
    currentPath: null,
    mode: "global",
    settings: null,
    fitNonce: 0,
    themeKey: `${ctx.theme.mode()}`,
  };
  let saver: GraphSettingsSaver | null = null;
  let loading: Promise<void> | null = null;
  let loadedFor: string | null = null;

  const set = (next: Partial<ControllerView>) => {
    view = { ...view, ...next };
    listeners.forEach((l) => l());
  };

  const reset = () => {
    void saver?.flush();
    saver = null;
    loading = null;
    loadedFor = null;
    set({ settings: null, mode: "global" });
  };

  const themeOff = ctx.theme.onChange((e) =>
    set({ themeKey: `${e.themeId}:${e.mode}` }),
  );
  // A different vault: flush the old settings and forget everything.
  const vaultOff = ctx.events.on("vault.opened", reset);

  const ensureLoaded = (): Promise<void> => {
    const name = ctx.vault.info()?.name ?? "";
    if (loadedFor !== name) {
      reset();
      loadedFor = name;
    }
    loading ??= loadGraphSettings(ctx.vault.table).then((loaded) => {
      saver = createGraphSettingsSaver(ctx.vault.table, loaded);
      set({ settings: loaded, vault: name });
    });
    return loading;
  };

  return {
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    snapshot: () => view,
    source: pluginGraphSource(ctx),
    /** Loads the settings and sets the mode and active drawing before the overlay opens. */
    async prepare(mode?: GraphMode) {
      await ensureLoaded();
      set({
        currentPath: ctx.workspace.activePath(),
        ...(mode ? { mode } : {}),
      });
    },
    setMode: (mode: GraphMode) => set({ mode }),
    commit(next: GraphSettings) {
      set({ settings: next });
      saver?.save(next);
    },
    toggleFlag(flag: "showOrphans" | "showTags" | "showUnresolved") {
      if (view.settings) {
        this.commit({ ...view.settings, [flag]: !view.settings[flag] });
      }
    },
    fit: () => set({ fitNonce: view.fitNonce + 1 }),
    /** The overlay closed: write pending settings now. */
    closed() {
      void saver?.flush();
    },
    dispose() {
      themeOff.dispose();
      vaultOff.dispose();
      void saver?.flush();
    },
  };
}
