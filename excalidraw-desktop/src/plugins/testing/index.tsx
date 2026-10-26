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

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getRegisteredHandler } from "../../commands/handlerRegistry";
import { buildElements } from "../../sceneOps";
import { getActiveScene } from "../../sceneOps/sceneBus";
import { viewportCenter } from "../../sceneOps/viewport";
import { appEvents, type AppEventMap } from "../../events/appEvents";
import { toastStore } from "../../toasts/toastStore";
import { notifyAppearanceChanged } from "../../vault/appearance";
import {
  DEFAULT_PLUGIN_STORAGE_KB,
  DEFAULT_SCENE_MAX_OPS,
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
import { findImporter, runImports } from "../importerMap";
import { cancelImports } from "../importerMap";
import { setWorkspaceBridge } from "../workspaceBridge";
import { setPluginSetting } from "../settings/pluginSettings";

import { createFakeScene, type FakeScene } from "./fakeScene";

import type {
  Json,
  NewElement,
  Plugin,
  ThemeMode,
  ThemeTokenName,
} from "../api";
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
    importers?: (Partial<ImporterDecl> & {
      id: string;
      extensions: string[];
    })[];
  };
};

type ImporterDecl = NonNullable<PluginInfo["contributes"]["importers"]>[number];

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

/** The vault `ctx.vault` sees: the fake backend's drawings, seedable. */
export interface FakeVault {
  /** Replaces every drawing: path to elements. */
  seed(
    drawings: Record<string, readonly (NewElement & { id?: string })[]>,
  ): void;
  /** The drawings now (seeded or created by the plugin), by path. */
  drawings(): Record<string, readonly ExcalidrawElement[]>;
  /** The open vault; null = no vault is open. Default: a writable "mock-vault". */
  setVault(info: { name: string; readOnly: boolean } | null): void;
}

/** What `ctx.workspace` did. */
export interface FakeWorkspace {
  opened(): { path: string; newTab: boolean }[];
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
  vault: FakeVault;
  workspace: FakeWorkspace;
  /**
   * Drops a file on the drawing as the app does: finds the importer by
   * extension, runs the real import runner and resolves to the scene write
   * it made, or null when nothing was applied. `at` defaults to the viewport
   * centre.
   */
  import(
    fileName: string,
    content: string | Uint8Array,
    at?: { x: number; y: number },
  ): Promise<FakeScene["batches"][number] | null>;
  /** "Import: Cancel": true when an import was running. */
  cancelImport(): boolean;
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
      importers: (c.importers ?? []).map((x) => ({ title: x.id, ...x })),
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
  /** App settings of the test, as in the mock host: `sceneMaxOps` is `plugins.scene_max_ops`. */
  options: { sceneMaxOps?: number } = {},
): Promise<TestPlugin> {
  if (options.sceneMaxOps !== undefined) {
    updatePreferences({ pluginsSceneMaxOps: options.sceneMaxOps });
  }
  const info = normalise(manifest);
  const id = info.id;
  const { backend } = setupHost([info], { [id]: module });
  const host = await startPluginHost(window, (run) => run());
  const scene = createFakeScene("fake.excalidraw");
  enable([id]);
  await host.startupDone;

  // The shell's bridge: the fake vault plus the fake scene stand in for the window.
  let vaultInfo: { name: string; readOnly: boolean } | null = {
    name: "mock-vault",
    readOnly: false,
  };
  const opened: { path: string; newTab: boolean }[] = [];
  setWorkspaceBridge({
    vault: () => vaultInfo,
    activePath: () => getActiveScene()?.path ?? null,
    drawingExists: async (path) => path in backend.drawings,
    openDrawing: async (path, newTab) => {
      opened.push({ path, newTab });
      scene.switchTo(path);
      appEvents.emit("drawing.opened", { path });
      return true;
    },
  });
  const sceneOf = (els: readonly (NewElement & { id?: string })[]) => ({
    type: "excalidraw",
    version: 2,
    elements: buildElements(els, { x: 0, y: 0 }),
    appState: {},
    files: {},
  });
  const vault: FakeVault = {
    seed(drawings) {
      backend.drawings = Object.fromEntries(
        Object.entries(drawings).map(([path, els]) => [
          path,
          { scene: sceneOf(els), revision: "seed" },
        ]),
      );
    },
    drawings: () =>
      Object.fromEntries(
        Object.entries(backend.drawings).map(([path, d]) => [
          path,
          ((d.scene.elements ?? []) as ExcalidrawElement[]).filter(
            (e) => !e.isDeleted,
          ),
        ]),
      ),
    setVault(next) {
      vaultInfo = next ? { ...next } : null;
      backend.vaultOpen = next !== null;
      backend.vaultReadOnly = next?.readOnly === true;
    },
  };

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
    vault,
    workspace: { opened: () => opened.map((o) => ({ ...o })) },
    async import(fileName, content, at) {
      const match = findImporter(fileName);
      const active = getActiveScene();
      if (!match) {
        throw new Error(`no importer declared for ${fileName}`);
      }
      if (!active?.path) {
        throw new Error("no drawing is open");
      }
      const before = scene.batches.length;
      const ok = await act(() =>
        runImports(
          [{ file: new File([content as BlobPart], fileName), match }],
          {
            path: active.path!,
            at: at ?? viewportCenter(active.api.getAppState()),
          },
        ),
      );
      if (!ok) {
        throw new Error("the import runner is not running");
      }
      return scene.batches.length > before
        ? scene.batches[scene.batches.length - 1]
        : null;
    },
    cancelImport: cancelImports,
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
      setWorkspaceBridge(null);
      scene.dispose();
      toastStore.clear();
      appEvents.clearCurrent();
      updatePreferences({
        pluginsEnabled: [],
        pluginsStorageLimitKb: DEFAULT_PLUGIN_STORAGE_KB,
        pluginsSceneMaxOps: DEFAULT_SCENE_MAX_OPS,
      });
      resetFakeTheme();
    },
  };
}
