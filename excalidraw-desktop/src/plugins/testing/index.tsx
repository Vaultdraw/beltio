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
import { FakeNoteFiles } from "../../notes/FakeNoteFiles";
import { setNoteFiles } from "../../notes/noteBackend";
import { tabKindFor } from "../../tabs/tabKinds";
import { TabKindView } from "../../tabs/TabKindView";
import { isPanelOpen } from "../../slots/panelStore";
import { getMenuItems, runMenuItem } from "../menuRegistry";
import { closeOverlay, getOverlay } from "../overlayStore";
import PluginOverlayHost from "../PluginOverlayHost";
import { getToolHandlers, getToolStub } from "../toolRegistry";
import { ensureActive } from "../host/activation";
import { getStatusItems } from "../host/statusBarRegistry";
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
  MenuTarget,
  ToolPoint,
  Plugin,
  StatusBarContribution,
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
    menus?: (Partial<MenuDecl> & {
      surface: MenuDecl["surface"];
      command: string;
    })[];
    shapes?: (Partial<ShapeDecl> & { id: string })[];
    tools?: (Partial<ToolDecl> & { id: string })[];
    toolbar?: (Partial<ToolbarDecl> & { command: string })[];
    views?: (Partial<ViewDecl> & { id: string; extensions: string[] })[];
    status_bar?: (Partial<StatusBarContribution> & { id: string })[];
  };
};

type ShapeDecl = NonNullable<PluginInfo["contributes"]["shapes"]>[number];
type ToolDecl = NonNullable<PluginInfo["contributes"]["tools"]>[number];
type ToolbarDecl = NonNullable<PluginInfo["contributes"]["toolbar"]>[number];
type ImporterDecl = NonNullable<PluginInfo["contributes"]["importers"]>[number];

type Mods = Partial<Omit<ToolPoint, "x" | "y">>;

/** Pointer events for one tool; each resolves when the handler is done. */
export interface ToolDriver {
  down(x: number, y: number, mods?: Mods): Promise<void>;
  move(x: number, y: number, mods?: Mods): Promise<void>;
  up(x: number, y: number, mods?: Mods): Promise<void>;
  /** Cuts the gesture short, as choosing another tool does. */
  cancel(): Promise<void>;
}

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
  /** Paths saved by the shell (a page document's `finish`), in order. */
  saves(): string[];
  /** The saved page setup of a drawing (its `appState.pageSetup`), or undefined. */
  pageSetup(path: string): Record<string, unknown> | undefined;
  /** The open vault; null = no vault is open. Default: a writable "mock-vault". */
  setVault(info: { name: string; readOnly: boolean } | null): void;
}

/** What `ctx.workspace` and the folders' `open()` did. */
export interface FakeWorkspace {
  opened(): { path: string; newTab: boolean }[];
  /** Absolute paths opened as a vault by `TargetFolder.open()` (new vaults). */
  openedVaults(): string[];
  /** Vault folders revealed in the tree by `TargetFolder.open()`. */
  revealed(): string[];
}

/** What `ctx.folders` sees: the fake backend's sources and targets. */
export interface FakeFolders {
  /** What the next `folders.pickSource` returns (null: the user cancels): files by relative path, text or bytes. */
  setSource(
    folder: { name: string; files: Record<string, string | Uint8Array> } | null,
  ): void;
  /** What the next `pickTarget({ kind: "newVault" })` returns: the vault's name (null: cancelled). */
  setNewVault(name: string | null): void;
  /** Every target handed out, with what was written into it. */
  targets(): {
    name: string;
    kind: "newVault" | "vaultFolder";
    path: string | null;
    files: Record<string, object | Uint8Array>;
  }[];
}

export interface FakeEvents {
  /** Emits on the real app event bus. */
  emit<K extends keyof AppEventMap>(name: K, payload: AppEventMap[K]): void;
}

type MenuDecl = NonNullable<PluginInfo["contributes"]["menus"]>[number];
type ViewDecl = NonNullable<PluginInfo["contributes"]["views"]>[number];

/** A status bar item as the user would see it. */
export interface StatusBarShown {
  id: string;
  title: string;
  text: string;
  tooltip: string | null;
  tone: "normal" | "muted" | "warn" | "error";
  /** Short command id a click runs, or null. */
  command: string | null;
}

export interface TestPlugin {
  info: PluginInfo;
  /** Runs a command by short id (as the palette does); resolves when its handler is done. */
  run(shortId: string): Promise<void>;
  /** Opens a panel by short id and renders the plugin panels host. */
  openPanel(shortId: string): Promise<RenderResult>;
  /** The menu items shown on a surface (for tree rows, those that apply to `kind`). */
  menuItems(
    surface: MenuTarget["surface"],
    kind?: "drawing" | "note" | "folder",
  ): { title: string; command: string }[];
  /** Chooses a menu item by its text, as the user would; `target` is what `ctx.menus.target()` returns. */
  chooseMenuItem(
    surface: MenuTarget["surface"],
    title: string,
    target?: Partial<Omit<MenuTarget, "surface">>,
  ): Promise<void>;
  /** Drives a declared tool as a pointer would: loads the plugin, then calls its handlers (scene coordinates). */
  tool(id: string): ToolDriver;
  /** Runs the "Insert shape" command of a declared shape, as the palette or its toolbar button does. */
  insertShape(shapeId: string): Promise<void>;
  /** The notes a view can read, by vault-relative path. */
  notes: {
    seed(path: string, text: string): void;
    text(path: string): string | undefined;
  };
  /** Opens a note in the view declared for its name, as a tab would, and renders it. */
  openView(path: string): Promise<RenderResult>;
  /** Files a view asked to open with `openPath`. */
  openedFromViews(): { path: string; newTab: boolean }[];
  /** Short ids of the panels that are open. */
  openPanelIds(): string[];
  /** The open overlay (`ctx.overlays.open`) of this plugin, or null. `render()` mounts it. */
  overlay(): { close(): void; render(): RenderResult } | null;
  /** The status bar items that currently have text. */
  statusBar(): StatusBarShown[];
  /** Clicks a status bar item: runs its declared command. */
  clickStatusBar(id: string): Promise<void>;
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
  folders: FakeFolders;
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
      menus: (c.menus ?? []).map((x) => ({ title: null, kinds: [], ...x })),
      shapes: (c.shapes ?? []).map((x) => ({
        title: x.id,
        icon: null,
        width: 160,
        height: 100,
        ...x,
      })),
      tools: (c.tools ?? []).map((x) => ({
        title: x.id,
        icon: null,
        cursor: null,
        ...x,
      })),
      toolbar: (c.toolbar ?? []).map((x) => ({
        title: null,
        icon: null,
        priority: 0,
        ...x,
      })),
      views: (c.views ?? []).map((x) => ({ title: x.id, ...x })),
      status_bar: (c.status_bar ?? []).map((x) => ({
        title: x.id,
        align: "right" as const,
        priority: 0,
        command: null,
        ...x,
      })),
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
  const noteFiles = new FakeNoteFiles();
  setNoteFiles(noteFiles);
  const viewOpened: { path: string; newTab: boolean }[] = [];
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
  const openedVaults: string[] = [];
  const revealed: string[] = [];
  const saves: string[] = [];
  let revisionSeq = 0;
  const parse = (json: string) =>
    JSON.parse(json) as {
      elements?: ExcalidrawElement[];
      appState?: Record<string, unknown>;
      files?: Record<string, unknown>;
    };
  const store = (path: string, sceneData: Record<string, unknown>) => {
    const revision = `rev-${++revisionSeq}`;
    backend.drawings[path] = { scene: sceneData, revision };
    return revision;
  };
  /** The open drawing as the app would save it: live elements, app state, files. */
  const snapshot = (): Record<string, unknown> => ({
    type: "excalidraw",
    version: 2,
    elements: scene.live(),
    appState: scene.appState(),
    files: Object.fromEntries(
      Object.entries(scene.files()).map(([id, f]) => [
        id,
        { id, mimeType: f.mime },
      ]),
    ),
  });
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
    newDrawingParent: async () => (vaultInfo ? "" : null),
    createDrawing: async (parent, name, json) => {
      const path = parent ? `${parent}/${name}` : name;
      if (path in backend.drawings) {
        throw new Error(`Already exists: ${path}`);
      }
      const data = parse(json);
      store(path, data as Record<string, unknown>);
      scene.switchTo(path);
      scene.setElements(data.elements ?? []);
      scene.updateAppState(data.appState ?? {});
      appEvents.emit("drawing.opened", { path });
    },
    writeDrawing: async (path, json) => {
      if (path in backend.drawings) {
        throw new Error(`Already exists: ${path}`);
      }
      return store(path, parse(json) as Record<string, unknown>);
    },
    flushDrawing: async (path) => {
      if (getActiveScene()?.path !== path) {
        return null;
      }
      saves.push(path);
      return store(path, snapshot());
    },
    drawingRevision: async (path) => backend.drawings[path]?.revision ?? null,
    focusElement: (_path, elementId) => scene.recordScroll(elementId),
    openVaultFolder: async (handle) => {
      openedVaults.push(await backend.importTargetRoot(handle));
    },
    revealFolder: async (path) => {
      revealed.push(path);
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
    saves: () => [...saves],
    pageSetup: (path) =>
      (
        backend.drawings[path]?.scene.appState as
          | Record<string, unknown>
          | undefined
      )?.pageSetup as Record<string, unknown> | undefined,
  };
  const folders: FakeFolders = {
    setSource(folder) {
      backend.folders.sourcePick = folder;
    },
    setNewVault(name) {
      backend.folders.newVaultPick = name;
    },
    targets: () =>
      Object.values(backend.folders.targets).map((t) => ({
        ...t,
        files: { ...t.files },
      })),
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
    menuItems: (surface, kind) =>
      getMenuItems(surface)
        .filter(
          (m) =>
            m.pluginId === id &&
            (m.kinds.length === 0 || (!!kind && m.kinds.includes(kind))),
        )
        .map((m) => ({
          title: m.title,
          command: m.command.slice(id.length + 1),
        })),
    async chooseMenuItem(surface, title, target = {}) {
      const item = getMenuItems(surface).find(
        (m) => m.pluginId === id && m.title === title,
      );
      if (!item) {
        throw new Error(`no ${surface} menu item "${title}"`);
      }
      await act(async () => {
        runMenuItem(item, { surface, path: null, ...target });
      });
      await flush();
    },
    notes: {
      seed: (path, text) => noteFiles.setOnDisk(path, text),
      text: (path) => noteFiles.textOf(path),
    },
    async insertShape(shapeId) {
      await act(async () => {
        await handler(`${id}.shape.${shapeId}`)();
      });
    },
    tool(toolId) {
      const key = `${id}.${toolId}`;
      const drive =
        (phase: "pointerDown" | "pointerMove" | "pointerUp") =>
        async (x: number, y: number, mods: Mods = {}) => {
          if (!getToolStub(key)) {
            throw new Error(`no tool "${toolId}" is declared`);
          }
          await act(async () => {
            await ensureActive(id);
            await getToolHandlers(key)?.[phase]?.({
              x,
              y,
              shiftKey: false,
              altKey: false,
              modKey: false,
              ...mods,
            });
          });
        };
      return {
        down: drive("pointerDown"),
        move: drive("pointerMove"),
        up: drive("pointerUp"),
        async cancel() {
          getToolHandlers(key)?.cancel?.();
        },
      };
    },
    async openView(path) {
      const kind = tabKindFor(path);
      if (!kind) {
        throw new Error(`no view is declared for ${path}`);
      }
      let shown: RenderResult | undefined;
      await act(async () => {
        shown = render(
          <TabKindView
            kind={kind}
            path={path}
            openPath={(p, o) =>
              viewOpened.push({ path: p, newTab: o?.target === "new" })
            }
            vault={{ handle: "mock-handle", paths: () => [] }}
          />,
        );
      });
      await flush();
      return shown!;
    },
    openedFromViews: () => viewOpened.map((o) => ({ ...o })),
    overlay() {
      const open = getOverlay();
      if (!open || open.pluginId !== id) {
        return null;
      }
      return {
        close: () => closeOverlay(open),
        render: () => render(<PluginOverlayHost onClosed={() => {}} />),
      };
    },
    openPanelIds: () =>
      info.contributes.panels
        .map((p) => p.id)
        .filter((short) => isPanelOpen(`${id}.${short}`)),
    statusBar: () =>
      getStatusItems()
        .filter((i) => i.pluginId === id)
        .map((i) => {
          const short = i.key.slice(id.length + 1);
          return {
            id: short,
            title: i.title,
            text: i.text,
            tooltip: i.tooltip ?? i.title,
            tone: i.tone,
            command: i.command ? i.command.slice(id.length + 1) : null,
          };
        }),
    async clickStatusBar(short) {
      const item = getStatusItems().find((i) => i.key === `${id}.${short}`);
      if (!item) {
        throw new Error(`status bar item "${short}" is not shown`);
      }
      if (item.command) {
        const command = item.command;
        await act(async () => {
          await handler(command)();
        });
      }
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
    workspace: {
      opened: () => opened.map((o) => ({ ...o })),
      openedVaults: () => [...openedVaults],
      revealed: () => [...revealed],
    },
    folders,
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
      setNoteFiles(null);
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
