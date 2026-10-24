/**
 * In-repo `@vaultdraw/api/testing`: boot a plugin module against the real
 * host with a fake backend, a fake scene and the app event bus. Tests import
 * host internals only through here.
 */
import {
  act,
  cleanup,
  render,
  type RenderResult,
} from "@testing-library/react";
import { vi } from "vitest";

import { getRegisteredHandler } from "../../commands/handlerRegistry";
import { appEvents, type AppEventMap } from "../../events/appEvents";
import { toastStore } from "../../toasts/toastStore";
import { notifyAppearanceChanged } from "../../vault/appearance";
import {
  DEFAULT_PLUGIN_STORAGE_KB,
  updatePreferences,
} from "../../vault/preferences";
import { getPluginLog } from "../host/errors";
import { resetThemeCache } from "../host/themeContext";
import { flushAllPluginStorage, resetPluginStore } from "../host/storage";
import { makePluginInfo } from "../host/fakeBackend";
import { pluginTimerCount } from "../host/context";
import { PluginPanels } from "../host/PluginPanels";
import { startPluginHost } from "../host/start";
import { enable, setupHost } from "../host/testUtils";
import { setPluginSetting } from "../settings/pluginSettings";

import { createFakeScene, type FakeScene } from "./fakeScene";

import type { Json, Plugin, ThemeMode, ThemeTokenName } from "../api";
import type { PluginInfo } from "../host/types";
import type { PluginSettingValue } from "../../vault/pluginSettingsTable";

export { makePluginInfo };
export type { FakeScene };

type CommandDecl = PluginInfo["contributes"]["commands"][number];
type PanelDecl = PluginInfo["contributes"]["panels"][number];

/** A full PluginInfo, or just `id` plus whatever the test cares about; declared commands/panels may be bare `{ id }`. */
export type TestManifest = Partial<Omit<PluginInfo, "contributes">> & {
  id: string;
  contributes?: {
    commands?: (Partial<CommandDecl> & { id: string })[];
    panels?: (Partial<PanelDecl> & { id: string })[];
    settings?: PluginInfo["contributes"]["settings"];
  };
};

export interface FakeTheme {
  /**
   * Changes the colours the document shows (`html.dark`, `data-vault-theme`,
   * custom properties) and notifies `ctx.theme.onChange` listeners.
   */
  set(change: {
    mode?: ThemeMode;
    themeId?: string;
    tokens?: Partial<Record<ThemeTokenName, string>>;
  }): void;
}

export interface FakeStorage {
  /** The saved object (what the fake backend holds; `flush()` writes pending changes first). */
  data(): Record<string, Json>;
  /** Replaces the saved object, as if saved in an earlier run. */
  seed(data: Record<string, Json>): void;
  /** Sets `plugins.storage_limit_kb`. */
  setLimitKb(kb: number): void;
}

export interface FakeEvents {
  /** Emits on the real app event bus. */
  emit<K extends keyof AppEventMap>(name: K, payload: AppEventMap[K]): void;
}

export interface TestPlugin {
  info: PluginInfo;
  /** Runs a command by short id (as the palette does); resolves when its handler is done. */
  run(shortId: string): Promise<void>;
  /** Opens a panel by short id and renders the plugin panels host. */
  openPanel(shortId: string): Promise<RenderResult>;
  /** Messages of the visible toasts. */
  toasts(): string[];
  /** Timers the plugin currently has scheduled. */
  timers(): number;
  /** Attributed log lines of this plugin. */
  log(): ReturnType<typeof getPluginLog>;
  setSetting(
    key: string,
    value: PluginSettingValue,
    scope?: "global" | "vault",
  ): Promise<boolean>;
  scene: FakeScene;
  events: FakeEvents;
  theme: FakeTheme;
  storage: FakeStorage;
  /** act + fake-timer advance (when faked) + microtasks + one animation frame + pending storage writes. */
  flush(): Promise<void>;
  /** Disables the plugin (disposes its context). */
  disable(): Promise<void>;
  /** disable + removes everything the kit created. */
  dispose(): Promise<void>;
}

const normalise = (m: TestManifest): PluginInfo => {
  const c = m.contributes ?? {};
  return makePluginInfo(m.id, {
    ...m,
    contributes: {
      commands: (c.commands ?? []).map((x) => ({
        title: x.id,
        keys: [],
        when: [],
        palette: true,
        ...x,
      })),
      panels: (c.panels ?? []).map((x) => ({
        title: x.id,
        icon: null,
        group: "top" as const,
        ...x,
      })),
      settings: c.settings ?? [],
    },
  } as Partial<PluginInfo>);
};

/** One animation frame is 16 ms; the scene bus notifies from rAF. */
const FRAME_MS = 20;

async function flush(): Promise<void> {
  await act(async () => {
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(FRAME_MS);
    } else {
      await new Promise((r) => setTimeout(r, FRAME_MS));
    }
    await Promise.resolve();
  });
}

const fakeTheme: FakeTheme = {
  set({ mode, themeId, tokens }) {
    const root = document.documentElement;
    if (mode) {
      root.classList.toggle("dark", mode === "dark");
    }
    if (themeId) {
      root.dataset.vaultTheme = themeId;
    }
    for (const [name, value] of Object.entries(tokens ?? {})) {
      root.style.setProperty(name, value);
    }
    notifyAppearanceChanged();
  },
};

const resetFakeTheme = () => {
  const root = document.documentElement;
  root.classList.remove("dark");
  delete root.dataset.vaultTheme;
  root.removeAttribute("style");
  resetThemeCache();
};

export async function boot(
  manifest: TestManifest,
  module: Plugin,
): Promise<TestPlugin> {
  const info = normalise(manifest);
  const id = info.id;
  const { backend } = setupHost([info], { [id]: module });
  const host = await startPluginHost(window, (run) => run());
  const scene = createFakeScene("fake.excalidraw");
  enable([id]);
  await host.startupDone;

  const handler = (full: string) => {
    const h = getRegisteredHandler(full);
    if (!h) {
      throw new Error(`no command "${full}" (declared in the manifest?)`);
    }
    return h;
  };
  const flushAll = async () => {
    await flush();
    await act(() => flushAllPluginStorage());
  };
  const disable = async () => {
    enable([]);
    await flushAll();
  };

  return {
    info,
    async run(short) {
      await act(async () => {
        await handler(`${id}.${short}`)();
      });
    },
    async openPanel(short) {
      await act(async () => {
        await handler(`${id}.panel.${short}`)();
      });
      const view = render(<PluginPanels />);
      await flush();
      return view;
    },
    toasts: () => toastStore.getSnapshot().toasts.map((t) => t.message),
    timers: pluginTimerCount,
    log: () => getPluginLog(id),
    setSetting: (key, value, scope = "global") =>
      setPluginSetting(id, key, value, scope),
    scene,
    events: { emit: (name, payload) => appEvents.emit(name, payload) },
    theme: fakeTheme,
    storage: {
      data: () => JSON.parse(backend.data[id] ?? "{}"),
      seed(data) {
        backend.data[id] = JSON.stringify(data);
        resetPluginStore(id);
      },
      setLimitKb: (kb) => updatePreferences({ pluginsStorageLimitKb: kb }),
    },
    flush: flushAll,
    disable,
    async dispose() {
      cleanup();
      await disable();
      host.stop();
      scene.dispose();
      toastStore.clear();
      appEvents.clearCurrent();
      updatePreferences({
        pluginsEnabled: [],
        pluginsStorageLimitKb: DEFAULT_PLUGIN_STORAGE_KB,
      });
      resetFakeTheme();
    },
  };
}
