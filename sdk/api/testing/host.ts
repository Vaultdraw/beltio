import {
  allowsScope,
  declProblem,
  effectiveSetting,
  MAX_PLUGIN_ERRORS,
  STORAGE_DEFAULT_LIMIT_KB,
  checkStorageKey,
  checkStorageQuota,
  composeStorage,
  encodeStorageValue,
  pushToast,
  toastMessage,
  undeclaredMessage,
  type UndeclaredKind,
  validateSettingValue,
  type MockToast,
} from "../shared/rules";
import { API_REVISION, FEATURES } from "../shared/features";
import {
  baseName,
  importBusyMessage,
  importCancelledMessage,
  importChangedMessage,
  importFailedMessage,
  importMissingMessage,
  importReadOnlyMessage,
  importTooBigMessage,
  makeImportInput,
  MAX_IMPORT_BYTES,
  resultOps,
} from "../shared/importers";

import { dataKeyFor, MAX_OPS_LIMIT } from "../shared/sceneRules";
import { cleanStatus, type CleanStatus } from "../shared/statusBar";
import { createViewNotes } from "../shared/viewFiles";
import { PluginApiError } from "../shared/rules";
import { createShapesApi } from "../shared/shapes";
import { claimsPath } from "../shared/viewNames";
import { checkVaultPath, permissionError } from "../shared/vaultPaths";

import { fakeParseMarkdown, markdownParams } from "../shared/markdown";

import { flowPages, pageGeometry } from "../shared/pages";

import {
  LINE_HEIGHTS,
  checkFamilies,
  checkFamily,
  checkFont,
  checkStrings,
  fakeMeasure,
} from "../shared/text";

import { createFoldersModel } from "./folders";
import { createPagesMock } from "./pages";
import { createClipboardModel, type FakeClipboard } from "./clipboard";
import { createPdfModel } from "./pdf";
import { createSceneModel } from "./scene";
import { loadPanelDeps, panelsRoot, type PanelDeps } from "./panels";
import { createVaultModel } from "./vault";

import type {
  AppEventMap,
  Disposable,
  FontFamilyName,
  Importer,
  ImportersApi,
  Json,
  MathRequest,
  MathResult,
  MarkdownParseOptions,
  MenuTarget,
  ToolHandlers,
  Plugin,
  OverlayProps,
  PresentOptions,
  ViewProps,
  PluginContext,
  StorageApi,
  SettingDecl,
  SettingValue,
  TextFont,
  ThemeApi,
  ThemeChange,
  ThemeMode,
  ThemeTokenName,
} from "@vaultdraw/api";
import type { ComponentType, ReactNode } from "react";
import type { RenderResult } from "@testing-library/react";
import type {
  BootOptions,
  FakeBatch,
  FakeFolders,
  FakePdf,
  FakeScene,
  FakeStorage,
  FakeTheme,
  FakeVault,
  FakeWorkspace,
  PluginLogLine,
  StatusBarShown,
  TestPluginInfo,
  ToolDriver,
} from "./types";

const NOOP: Disposable = { dispose() {} };
const LOG_RING = 100;
export const DEACTIVATE_TIMEOUT_MS = 2000;

/** Compile-time complete list of the app event names. */
const EVENT_NAMES: Record<keyof AppEventMap, true> = {
  "vault.opened": true,
  "drawing.opened": true,
  "drawing.saved": true,
  "drawing.renamed": true,
  "drawing.deleted": true,
  "vault.changed": true,
};

type State = "idle" | "loading" | "active" | "failed" | "disabled";

const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  !!v && typeof (v as PromiseLike<unknown>).then === "function";

/** The not-set-up error: names what the test has to provide. */
export const notSetUp = (what: string): Error =>
  new Error(`not set up in this test: ${what}`);

export interface MockHost {
  info: TestPluginInfo;
  scene: FakeScene;
  theme: FakeTheme;
  storage: FakeStorage;
  vault: FakeVault;
  workspace: FakeWorkspace;
  folders: FakeFolders;
  /** What `ctx.pdf` serves (needs the permission `pdf`). */
  pdf: FakePdf;
  /** What `ctx.clipboard` serves (needs the permission `clipboard`). */
  clipboard: FakeClipboard;
  /** Drops a file on the active drawing; resolves to the scene write it made, or null. */
  importFile(
    fileName: string,
    content: string | Uint8Array,
    at?: { x: number; y: number },
  ): Promise<FakeBatch | null>;
  cancelImport(): boolean;
  log(): readonly PluginLogLine[];
  statusBar(): StatusBarShown[];
  toasts(): string[];
  timers(): number;
  /** Runs onStartupFinished activation, as the app does after launch. */
  startup(): Promise<void>;
  run(short: string): Promise<void>;
  /** Calls a method the plugin declares, as the control socket does: JSON in, JSON out. */
  callMethod(name: string, params?: Json): Promise<Json>;
  openPanel(short: string): Promise<RenderResult>;
  /** The menu items shown on a surface (for tree rows, those that apply to `kind`). */
  menuItems(
    surface: MenuTarget["surface"],
    kind?: "drawing" | "note" | "folder",
  ): { title: string; command: string }[];
  /** Drives a declared tool as a pointer would: loads the plugin, then calls its handlers (scene coordinates). */
  tool(id: string): ToolDriver;
  /** Runs the "Insert shape" command of a declared shape, as the palette or its toolbar button does. */
  insertShape(shapeId: string): Promise<void>;
  /** Chooses a menu item by its text, as the user would; `target` is what `ctx.menus.target()` returns. */
  chooseMenuItem(
    surface: MenuTarget["surface"],
    title: string,
    target?: Partial<Omit<MenuTarget, "surface">>,
  ): Promise<void>;
  /** The notes a view can read, by vault-relative path. */
  notes: {
    seed(path: string, text: string): void;
    text(path: string): string | undefined;
  };
  /** Opens a note in the view declared for its name, as a tab would, and renders it. */
  openView(path: string): Promise<RenderResult>;
  /** Files the view asked to open with `openPath`. */
  openedFromViews(): { path: string; newTab: boolean }[];
  /** Short ids of the panels that are open. */
  openPanelIds(): string[];
  /** Renders TeX through `ctx.math` (the provider the plugin set, else null). */
  renderMath(request: MathRequest): Promise<MathResult | null>;
  /** The running presentation (`ctx.present.start`), or null; `end()` ends it as Escape would. */
  present(): {
    laser: boolean;
    background: string | null;
    end(): void;
  } | null;
  /** The open overlay (`ctx.overlays.open`), or null. */
  overlay(): { close(): void; render(): RenderResult } | null;
  setSetting(
    key: string,
    value: SettingValue,
    scope: "global" | "vault",
  ): Promise<boolean>;
  emit<K extends keyof AppEventMap>(name: K, payload: AppEventMap[K]): void;
  /** Unmounts every panel, runs `deactivate`, disposes the context. */
  stop(): Promise<void>;
  /** Clears everything the test could leak into the next one. */
  reset(): void;
  /** Wraps `act` for panels (identity without them). */
  act<T>(fn: () => Promise<T>): Promise<T>;
}

/** One plugin in a mock host: the same rules as the app's host, in memory. */
export function createMockHost(
  info: TestPluginInfo & {
    dev?: boolean;
    dir: string;
    activation: string[];
  },
  plugin: Plugin,
  deps: PanelDeps | null,
  options: BootOptions = {},
): MockHost {
  const id = info.id;
  const dataKey = dataKeyFor(id, info.dataKey);
  // The same limit as the app's host: `plugins.scene_max_ops`, where a value that is not
  // a whole number from 1 to MAX_OPS_LIMIT is refused by the config and the default applies.
  const requested = options.sceneMaxOps;
  const sceneMaxOps =
    Number.isInteger(requested) &&
    requested! >= 1 &&
    requested! <= MAX_OPS_LIMIT
      ? requested
      : undefined;
  const maxOps = () => sceneMaxOps;
  const scene = createSceneModel("fake.excalidraw", maxOps);
  const vault = createVaultModel(maxOps);
  const pdfModel = createPdfModel();
  const clipboardModel = createClipboardModel();
  const folders = createFoldersModel(vault, {
    open: () => vault.fake.setVault !== undefined && vaultIsOpen(),
    readOnly: () => vaultReadOnly(),
    hasDrawing: (path) => vault.has(path),
    putDrawing: (path, sceneData) => {
      const d = sceneData as { elements?: unknown[]; appState?: unknown };
      vault.put(
        path,
        (d.elements ?? []) as never,
        (d.appState ?? {}) as Record<string, unknown>,
      );
    },
  });
  const vaultIsOpen = () => {
    try {
      vault.needVault();
      return true;
    } catch {
      return false;
    }
  };
  const vaultReadOnly = () => vaultIsOpen() && vault.needVault().readOnly;
  // The scene model keeps its path private; the host needs it for imports and ctx.workspace.
  let activePath: string | null = "fake.excalidraw";
  let sceneReadOnly = false;
  /** The import running now: aborted on a drawing switch, stop or cancel. */
  let importing: AbortController | null = null;
  const fakeScene: FakeScene = {
    ...scene.fake,
    switchTo(next) {
      activePath = next;
      importing?.abort("switch");
      scene.fake.switchTo(next);
    },
    readOnly(flag) {
      sceneReadOnly = flag;
      scene.fake.readOnly(flag);
    },
  };

  // --- state ---
  let state: State = "idle";
  let promise: Promise<boolean> | null = null;
  let gen = 0;
  /** The stubs: while true the declared commands and panels exist. */
  let enabled = true;
  let disposeContext: (() => void) | null = null;
  const handlers = new Map<string, () => void | Promise<void>>();
  const components = new Map<string, ComponentType>();
  let overlay: {
    component: ComponentType<OverlayProps>;
    onClose?: () => void;
  } | null = null;
  let overlayClose: (() => void) | null = null;
  /** The running presentation (`ctx.present.start`), one at a time. */
  let presenting: {
    options: PresentOptions;
    laser: boolean;
    end: () => void;
  } | null = null;
  /** Overlays are not declared in the manifest: react loads when one opens (best effort). */
  let overlayDeps: PanelDeps | null = null;
  let overlayLoading: Promise<void> | null = null;
  let mathProvider: ((request: MathRequest) => Promise<MathResult>) | null =
    null;
  let lines: PluginLogLine[] = [];
  let errors = 0;
  let toastQueue: MockToast[] = [];
  let activeTimers = 0;
  const globalValues = new Map<string, SettingValue>();
  let decls: readonly SettingDecl[] = [];
  const eventSubs = new Map<string, Set<(payload: unknown) => void>>();
  const settingSubs = new Set<() => void>();
  const openPanels = new Set<string>();
  let panelVersion = 0;
  const panelSubs = new Set<() => void>();
  let view: RenderResult | null = null;

  const declaredCommands = new Set(info.contributes.commands.map((c) => c.id));
  const declaredPanels = new Map(
    info.contributes.panels.map((p) => [p.id, p.title] as const),
  );
  const decl = (key: string) => decls.find((d) => d.key === key);
  const declaredImporters = new Map(
    (info.contributes.importers ?? []).map((i) => [i.id, i] as const),
  );
  /** extension -> importer id, for the longest-suffix lookup of a dropped file */
  const importerByExt = new Map(
    (info.contributes.importers ?? []).flatMap((i) =>
      i.extensions.map((e) => [e.toLowerCase(), i.id] as const),
    ),
  );
  const importerImpls = new Map<string, Importer>();
  const declaredStatus = new Map(
    (info.contributes.status_bar ?? []).map((i) => [i.id, i] as const),
  );
  const statusItems = new Map<string, CleanStatus>();
  const declaredViews = new Map(
    (info.contributes.views ?? []).map((v) => [v.id, v] as const),
  );
  const viewNotes = createViewNotes();
  const opened_views: { path: string; newTab: boolean }[] = [];
  const declaredTools = new Set(
    (info.contributes.tools ?? []).map((t) => t.id),
  );
  const toolHandlers = new Map<string, ToolHandlers>();
  const shapeInserters = new Map<string, () => Promise<unknown>>();
  const menuItems = (info.contributes.menus ?? []).map((m) => ({
    ...m,
    title:
      m.title ??
      info.contributes.commands.find((c) => c.id === m.command)?.title ??
      m.command,
  }));
  let menuTarget: MenuTarget | null = null;

  // --- log, errors, toasts ---
  const logLine = (level: PluginLogLine["level"], text: string) => {
    if (lines.length >= LOG_RING) {
      lines.shift();
    }
    lines.push({ level, text });
  };
  const toast = (message: string, kind: MockToast["kind"] = "info") => {
    toastQueue = pushToast(toastQueue, { message, kind });
  };
  const reportError = (err: unknown, where: string) => {
    const text = `${where}: ${errorText(err)}`;
    logLine("error", text);
    errors++;
    if (errors === MAX_PLUGIN_ERRORS) {
      disablePlugin(`${MAX_PLUGIN_ERRORS} errors (last: ${text})`);
    }
  };

  /** Wraps an entry point so its errors are attributed, sync or async. */
  const guard =
    <A extends unknown[], R>(fn: (...args: A) => R, where: string) =>
    (...args: A): R | undefined => {
      try {
        const result: unknown = fn(...args);
        if (isThenable(result)) {
          return result.then(undefined, (err) => {
            reportError(err, where);
          }) as R;
        }
        return result as R;
      } catch (err) {
        reportError(err, where);
        return undefined;
      }
    };

  // --- panels ---
  const panelsChanged = () => {
    panelVersion++;
    panelSubs.forEach((cb) => cb());
  };
  const closeAllPanels = () => {
    view?.unmount();
    view = null;
    openPanels.clear();
    panelVersion++;
  };

  // --- settings ---
  const settingValue = (key: string): SettingValue | undefined => {
    const d = decl(key);
    return d
      ? effectiveSetting(d, globalValues.get(key))
      : globalValues.get(key);
  };
  const writeSetting = async (
    key: string,
    value: SettingValue,
    scope: "global" | "vault",
  ): Promise<boolean> => {
    const d = decl(key);
    if (
      d &&
      (!allowsScope(d, scope) ||
        (value !== undefined && !validateSettingValue(d, value).ok))
    ) {
      return false;
    }
    if (scope === "vault") {
      // No vault is open in a test: the app refuses this write too.
      return false;
    }
    globalValues.set(key, value);
    [...settingSubs].forEach((cb) => cb());
    return true;
  };

  // --- storage: ctx.storage.global in memory, JSON text per key as in the app ---
  let stored = new Map<string, string>();
  let storageLimitKb = STORAGE_DEFAULT_LIMIT_KB;
  const storage: FakeStorage = {
    data: () => JSON.parse(composeStorage(stored)),
    seed(data) {
      stored = new Map(
        Object.entries(data).map(([k, v]) => [k, JSON.stringify(v)]),
      );
    },
    setLimitKb(kb) {
      storageLimitKb = kb;
    },
  };
  const storageApi: StorageApi = Object.freeze({
    global: Object.freeze({
      async get<T extends Json = Json>(key: string) {
        const text = stored.get(checkStorageKey(key));
        return text === undefined ? undefined : (JSON.parse(text) as T);
      },
      async set(key: string, value: Json) {
        const text = encodeStorageValue(checkStorageKey(key), value);
        const next = new Map(stored).set(key, text);
        checkStorageQuota(
          new TextEncoder().encode(composeStorage(next)).length,
          storageLimitKb,
        );
        stored = next;
      },
      async delete(key: string) {
        stored.delete(checkStorageKey(key));
      },
      keys: async () => [...stored.keys()],
    }),
  });

  // --- theme: what ctx.theme reports; the test sets it ---
  let themeMode: ThemeMode = "light";
  let themeId = "default";
  let themeTokens: Readonly<Record<ThemeTokenName, string>> | null = null;
  const themeSubs = new Set<(e: ThemeChange) => void>();
  const theme: FakeTheme = {
    set(change) {
      themeMode = change.mode ?? themeMode;
      themeId = change.themeId ?? themeId;
      if (change.tokens) {
        themeTokens = Object.freeze({
          ...themeTokens,
          ...change.tokens,
        }) as Readonly<Record<ThemeTokenName, string>>;
      }
      [...themeSubs].forEach((cb) => cb({ mode: themeMode, themeId }));
    },
  };

  // --- the context ---
  const createContext = () => {
    const subscriptions: Disposable[] = [];
    let ctxStopped = false;
    subscriptions.push({
      dispose() {
        ctxStopped = true;
      },
    });
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
    const refuse = (what: UndeclaredKind, short: string): Disposable => {
      reportError(new Error(undeclaredMessage(what, short)), "register");
      return NOOP;
    };
    const timer =
      (
        set: (fn: () => void, ms: number) => unknown,
        clear: (h: never) => void,
        repeat: boolean,
      ) =>
      (fn: () => void, ms: number): Disposable => {
        const safe = guard(fn, "timer");
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
          clear(handle as never);
          stop();
        });
      };
    const logger =
      (level: PluginLogLine["level"]) =>
      (...a: unknown[]) => {
        // eslint-disable-next-line no-console
        console[level](`[plugin ${id}]`, ...a);
        logLine(level, a.map((x) => errorText(x)).join(" "));
      };

    // Events: one microtask queue per plugin keeps the emission order and
    // never runs a handler inside the emitter.
    let queue: (() => void)[] = [];
    let scheduled = false;
    const drain = () => {
      scheduled = false;
      const run = queue;
      queue = [];
      run.forEach((job) => job());
    };

    let hostApi: PluginContext["host"] | undefined;
    let themeApi: ThemeApi | undefined;
    let vaultApi: PluginContext["vault"] | undefined;
    let workspaceApi: PluginContext["workspace"] | undefined;
    let importersApi: ImportersApi | undefined;
    let statusBarApi: PluginContext["statusBar"] | undefined;
    let viewsApi: PluginContext["views"] | undefined;
    let toolsApi: PluginContext["tools"] | undefined;
    let shapesApi: PluginContext["shapes"] | undefined;
    let overlaysApi: PluginContext["overlays"] | undefined;
    let presentApi: PluginContext["present"] | undefined;
    let thumbnailsApi: PluginContext["thumbnails"] | undefined;
    let diagramsApi: PluginContext["diagrams"] | undefined;
    let pdfApi: PluginContext["pdf"] | undefined;
    let clipboardApi: PluginContext["clipboard"] | undefined;
    let menusApi: PluginContext["menus"] | undefined;
    let pagesApi: PluginContext["pages"] | undefined;
    let foldersApi: PluginContext["folders"] | undefined;
    const ctx: PluginContext = {
      manifest: {
        id,
        version: info.version,
        dir: info.dir,
        permissions: info.permissions,
        dataKey,
      },
      commands: {
        register(short, run) {
          if (!declaredCommands.has(short)) {
            return refuse("command", short);
          }
          handlers.set(short, run);
          return track(() => {
            if (handlers.get(short) === run) {
              handlers.delete(short);
            }
          });
        },
        async execute(fullId) {
          if (fullId.startsWith(`${id}.`) && enabled) {
            return runCommand(fullId.slice(id.length + 1));
          }
          throw notSetUp(
            `command "${fullId}" (the mock host runs only this plugin's own commands)`,
          );
        },
      },
      math: {
        render: async (request) =>
          mathProvider ? mathProvider(request) : null,
        provide(renderer) {
          mathProvider = renderer;
          return track(() => {
            if (mathProvider === renderer) {
              mathProvider = null;
            }
          });
        },
      },
      methods: {
        register(name, handler) {
          if (!declaredMethods.has(name)) {
            return refuse("method", name);
          }
          methodHandlers.set(name, handler);
          return track(() => {
            if (methodHandlers.get(name) === handler) {
              methodHandlers.delete(name);
            }
          });
        },
      },
      panels: {
        register(short, component) {
          if (!declaredPanels.has(short)) {
            return refuse("panel", short);
          }
          components.set(short, component);
          panelsChanged();
          return track(() => {
            if (components.get(short) === component) {
              components.delete(short);
              panelsChanged();
            }
          });
        },
        open(short) {
          if (declaredPanels.has(short)) {
            openPanels.add(short);
            panelsChanged();
          }
        },
        close(short) {
          if (declaredPanels.has(short)) {
            openPanels.delete(short);
            panelsChanged();
          }
        },
      },
      settings: {
        get: <T = unknown>(key: string) => settingValue(key) as T,
        async set(key, value) {
          const d = decl(key);
          const scope = !d || allowsScope(d, "global") ? "global" : "vault";
          if (!(await writeSetting(key, value as SettingValue, scope))) {
            throw new Error(`Setting "${key}" refused: invalid value or scope`);
          }
        },
        onChange(key, cb) {
          const safe = guard(cb, "settings.onChange");
          let last = settingValue(key);
          const check = () => {
            const next = settingValue(key);
            if (next !== last) {
              last = next;
              safe(next);
            }
          };
          settingSubs.add(check);
          return track(() => {
            settingSubs.delete(check);
          });
        },
      },
      ui: {
        toast: (message, options) => {
          const text = toastMessage(info.name, message);
          toast(text);
          if (options?.action) {
            clipboardModel.addToastButton(
              text,
              options.action.label,
              options.action.run,
            );
          }
        },
      },
      log: {
        debug: logger("debug"),
        info: logger("info"),
        warn: logger("warn"),
        error: logger("error"),
      },
      scene: scene.api(
        {
          track,
          guard,
          logError: (text) => logLine("error", text),
          dataKey,
        },
        () => {
          if (!deps) {
            throw notSetUp(
              "scene.useScene needs React: declare a panel in plugin.toml and install react and @testing-library/react",
            );
          }
          return deps.react;
        },
      ),
      events: {
        on(name, cb) {
          if (!Object.hasOwn(EVENT_NAMES, name)) {
            reportError(
              new Error(`unknown event "${String(name)}"`),
              "events.on",
            );
            return NOOP;
          }
          if (
            name === "vault.changed" &&
            !info.permissions.includes("vault.read")
          ) {
            reportError(
              permissionError(id, "vault.changed", "vault.read"),
              "events.on",
            );
            return NOOP;
          }
          const safe = guard(cb, `events.${name}`);
          let live = true;
          const listener = (payload: unknown) => {
            queue.push(() => live && safe(payload as never));
            if (!scheduled) {
              scheduled = true;
              queueMicrotask(drain);
            }
          };
          const set = eventSubs.get(name) ?? new Set();
          eventSubs.set(name, set);
          set.add(listener);
          return track(() => {
            live = false;
            set.delete(listener);
          });
        },
      },
      // Built on first read, as in the app.
      get host() {
        return (hostApi ??= Object.freeze({
          app: "0.0.0-mock",
          api: Object.freeze({ level: 0 as const, revision: API_REVISION }),
          has: (name: string) =>
            typeof name === "string" && Object.hasOwn(FEATURES, name),
        }));
      },
      storage: storageApi,
      get vault() {
        return (vaultApi ??= vault.vaultApi(id, info.permissions, dataKey));
      },
      get workspace() {
        return (workspaceApi ??= vault.workspaceApi({
          activePath: () => activePath,
          opened: (path) => {
            fakeScene.switchTo(path);
            [...(eventSubs.get("drawing.opened") ?? [])].forEach((cb) =>
              cb({ path }),
            );
          },
        }));
      },
      get importers() {
        return (importersApi ??= {
          register(importerId, importer) {
            if (!declaredImporters.has(importerId)) {
              return refuse("importer", importerId);
            }
            importerImpls.set(importerId, importer);
            return track(() => {
              if (importerImpls.get(importerId) === importer) {
                importerImpls.delete(importerId);
              }
            });
          },
        });
      },
      get shapes() {
        return (shapesApi ??= createShapesApi(
          info.contributes.shapes ?? [],
          ctx.scene,
          track,
          refuse,
          (shapeId, insert) => {
            shapeInserters.set(shapeId, insert);
            return () => shapeInserters.delete(shapeId);
          },
        ));
      },
      get tools() {
        return (toolsApi ??= {
          register(toolId, handlers) {
            if (!declaredTools.has(toolId)) {
              return refuse("tool", toolId);
            }
            toolHandlers.set(toolId, handlers);
            return track(() => {
              if (toolHandlers.get(toolId) === handlers) {
                toolHandlers.delete(toolId);
              }
            });
          },
        });
      },
      get thumbnails() {
        // No thumbnail service in tests: previews are off.
        return (thumbnailsApi ??= {
          use: () => ({ status: "none", url: null }),
          useEnabled: () => false,
          useDarkClass: () => "",
        });
      },
      get diagrams() {
        // The real converter runs in the app: tests give the plugin their own result.
        return (diagramsApi ??= {
          mermaidToElements: async () => {
            throw new Error("ctx.diagrams is not available in the test host");
          },
        });
      },
      get clipboard() {
        return (clipboardApi ??= clipboardModel.api(id, info.permissions));
      },
      get pdf() {
        // No native renderer in tests: set one up with `pdf` on the mock host.
        return (pdfApi ??= pdfModel.api(id, info.permissions));
      },
      get present() {
        return (presentApi ??= {
          get active() {
            return presenting !== null;
          },
          async start(options) {
            if (activePath === null) {
              throw new PluginApiError("NOT_FOUND", "No drawing is open");
            }
            presenting?.end();
            const opts = options ?? {};
            const entry: NonNullable<typeof presenting> = {
              options: opts,
              laser: false,
              end: () => {
                if (presenting === entry) {
                  presenting = null;
                  opts.onEnd?.();
                }
              },
            };
            presenting = entry;
            track(entry.end);
            return {
              end: entry.end,
              dispose: entry.end,
              get isActive() {
                return presenting === entry;
              },
              setLaser(on) {
                if (presenting === entry) {
                  entry.laser = on === true;
                }
              },
              get laser() {
                return presenting === entry && entry.laser;
              },
            };
          },
        });
      },
      get overlays() {
        return (overlaysApi ??= {
          open(component, options) {
            overlayClose?.();
            if (!deps && !overlayDeps) {
              overlayLoading = loadPanelDeps().then(
                (d) => void (overlayDeps = d),
                () => undefined,
              );
            }
            const entry = { component, onClose: options?.onClose };
            overlay = entry;
            const close = () => {
              if (overlay === entry) {
                overlay = null;
                entry.onClose?.();
              }
            };
            overlayClose = close;
            track(close);
            return {
              close,
              get isOpen() {
                return overlay === entry;
              },
              dispose: close,
            };
          },
        });
      },
      get menus() {
        return (menusApi ??= { target: () => menuTarget });
      },
      get views() {
        return (viewsApi ??= {
          register(viewId, component) {
            if (!declaredViews.has(viewId)) {
              return refuse("view", viewId);
            }
            components.set(`view:${viewId}`, component as ComponentType);
            return track(() => {
              if (components.get(`view:${viewId}`) === component) {
                components.delete(`view:${viewId}`);
              }
            });
          },
          async open(viewId, options) {
            if (declaredPanels.has(viewId)) {
              openPanels.add(viewId);
              panelsChanged();
              return;
            }
            const view = declaredViews.get(viewId);
            if (!view) {
              throw new PluginApiError(
                "INVALID_ARGUMENT",
                `"${viewId}" is not a panel or view declared in plugin.toml`,
              );
            }
            const path = options?.path;
            if (
              typeof path !== "string" ||
              !claimsPath(view.extensions, path)
            ) {
              throw new PluginApiError(
                "INVALID_ARGUMENT",
                `view "${viewId}" shows notes named *.${view.extensions.join(
                  ", *.",
                )}; open() needs a path like that`,
              );
            }
            checkVaultPath(path, "folder"); // the path rules; the claimed name is checked above
            if (!vault.isOpen()) {
              throw new PluginApiError("NO_VAULT", "No vault is open");
            }
            vault.recordOpened(path, options?.newTab === true);
          },
        });
      },
      get statusBar() {
        return (statusBarApi ??= {
          set(itemId, state) {
            if (!declaredStatus.has(itemId)) {
              refuse("status bar item", itemId);
              return;
            }
            if (ctxStopped) {
              return;
            }
            const clean = cleanStatus(state);
            if (clean) {
              statusItems.set(itemId, clean);
            } else {
              statusItems.delete(itemId);
            }
          },
          clear(itemId) {
            statusItems.delete(itemId);
          },
          show(itemId, state) {
            this.set(itemId, state);
            return track(() => statusItems.delete(itemId));
          },
        });
      },
      // markdown, text, fonts, pages: stateless, built per read (cheap objects).
      get markdown() {
        return {
          async parse(text: string, options?: MarkdownParseOptions) {
            const p = markdownParams(text, options);
            return fakeParseMarkdown(p.text, p);
          },
        };
      },
      get text() {
        return {
          measure: (font: TextFont, strings: readonly string[]) =>
            fakeMeasure(checkFont(font), checkStrings(strings)),
          lineHeight: (family: FontFamilyName) =>
            LINE_HEIGHTS[checkFamily(family)],
        };
      },
      get fonts() {
        return {
          async ensure(families: readonly FontFamilyName[], text?: string) {
            checkFamilies(families, text);
          },
        };
      },
      get pages() {
        return (pagesApi ??= Object.freeze({
          geometry: pageGeometry,
          flow: flowPages,
          ...createPagesMock({
            vault,
            scene,
            dataKey,
            track,
            activePath: () => activePath,
            activate: (path) => {
              fakeScene.switchTo(path);
              [...(eventSubs.get("drawing.opened") ?? [])].forEach((cb) =>
                cb({ path }),
              );
            },
          }),
        }));
      },
      get folders() {
        return (foldersApi ??= folders.api(id, info.permissions));
      },
      get theme() {
        return (themeApi ??= {
          mode: () => themeMode,
          tokens() {
            if (!themeTokens) {
              throw notSetUp(
                "theme.tokens (call plugin.theme.set({ tokens }) first)",
              );
            }
            return themeTokens;
          },
          onChange(cb) {
            const safe = guard(cb, "theme.onChange");
            let live = true;
            const listener = (e: ThemeChange) => live && safe(e);
            themeSubs.add(listener);
            return track(() => {
              live = false;
              themeSubs.delete(listener);
            });
          },
        });
      },
      subscriptions,
      setTimeout: timer(
        (fn, ms) => globalThis.setTimeout(fn, ms),
        (h) => globalThis.clearTimeout(h),
        false,
      ),
      setInterval: timer(
        (fn, ms) => globalThis.setInterval(fn, ms),
        (h) => globalThis.clearInterval(h),
        true,
      ),
    };
    return {
      ctx,
      /** Disposes every subscription in reverse order; errors are attributed, never thrown. */
      dispose() {
        while (subscriptions.length > 0) {
          const d = subscriptions.pop()!;
          try {
            d.dispose();
          } catch (err) {
            reportError(err, "dispose");
          }
        }
      },
    };
  };

  // --- activation ---
  const activate = async (): Promise<boolean> => {
    const mine = gen;
    try {
      await Promise.resolve(); // the app imports the module here
      if (gen !== mine) {
        return false;
      }
      const handle = createContext();
      disposeContext = handle.dispose;
      await plugin.activate(handle.ctx);
      if (gen !== mine) {
        return false;
      }
      state = "active";
      return true;
    } catch (err) {
      if (gen !== mine) {
        return false;
      }
      state = "failed";
      reportError(err, "activate");
      disablePlugin(`failed to activate: ${errorText(err)}`);
      return false;
    }
  };
  /** Resolves true once the plugin is active; false if it cannot be (never rejects). */
  const ensureActive = (): Promise<boolean> => {
    if (state === "disabled" || state === "failed") {
      return Promise.resolve(false);
    }
    if (!promise) {
      state = "loading";
      promise = activate();
    }
    return promise;
  };

  const withTimeout = (p: Promise<unknown> | undefined, ms: number) =>
    new Promise<void>((resolve) => {
      const t = globalThis.setTimeout(resolve, ms);
      void Promise.resolve(p).finally(() => {
        globalThis.clearTimeout(t);
        resolve();
      });
    });

  /** Calls deactivate() (2 s limit) and disposes the context. */
  const deactivate = async () => {
    const wasActive = state === "active";
    const had = disposeContext;
    gen++;
    promise = null;
    disposeContext = null;
    importing?.abort("stop");
    if (wasActive && plugin.deactivate) {
      const call = guard(plugin.deactivate.bind(plugin), "deactivate");
      await withTimeout(
        call() as Promise<unknown> | undefined,
        DEACTIVATE_TIMEOUT_MS,
      );
    }
    had?.();
    handlers.clear();
    components.clear();
    importerImpls.clear();
    statusItems.clear();
  };

  const stop = (): Promise<void> => {
    enabled = false;
    closeAllPanels();
    const done = deactivate();
    state = "idle";
    return done;
  };

  /** Host-side disable after a crash or failed activation. */
  function disablePlugin(reason: string) {
    if (state === "disabled") {
      return;
    }
    void stop();
    state = "disabled";
    if (info.dev === true) {
      logLine("error", `stopped: ${reason}`);
      toast(
        `Plugin ${info.name} stopped: ${reason}. Save a file to reload it.`,
        "error",
      );
    } else {
      toast(`Plugin ${info.name} was disabled: ${reason}`, "error");
    }
  }

  // --- commands ---
  const runReal = (short: string) => {
    const handler = handlers.get(short);
    if (!handler) {
      const message = `command ${id}.${short} declared but not registered`;
      reportError(new Error(message), "command");
      toast(`${info.name}: ${message}`, "error");
      return undefined;
    }
    // Each failure is toasted, then rethrown so the guard attributes it.
    const failed = (err: unknown): never => {
      toast(
        `${info.name}: command ${short} failed: ${errorText(err)}`,
        "error",
      );
      throw err;
    };
    const run = () => {
      try {
        const result = handler();
        return result instanceof Promise ? result.catch(failed) : result;
      } catch (err) {
        return failed(err);
      }
    };
    return guard(run, `command ${short}`)();
  };
  const declaredMethods = new Set(
    (info.contributes.methods ?? []).map((m) => m.id),
  );
  const methodHandlers = new Map<
    string,
    (params: Json) => Json | Promise<Json>
  >();
  /** What the app does for `plugin.call`: loads the plugin, runs the handler, keeps JSON only. */
  async function callMethod(name: string, params: Json = {}): Promise<Json> {
    if (!enabled || !declaredMethods.has(name)) {
      throw new Error(`no method "${id}.${name}" (declared in the manifest?)`);
    }
    if (state !== "active" && !(await ensureActive())) {
      throw new Error(`plugin ${id} is not active`);
    }
    const handler = methodHandlers.get(name);
    if (!handler) {
      throw new Error(`method ${id}.${name} declared but not registered`);
    }
    const result = await handler(params);
    if (result === undefined) {
      throw new Error(`method ${id}.${name} returned nothing (return JSON)`);
    }
    return JSON.parse(JSON.stringify(result)) as Json;
  }
  async function runCommand(short: string): Promise<void> {
    if (!enabled || !declaredCommands.has(short)) {
      throw new Error(
        `no command "${id}.${short}" (declared in the manifest?)`,
      );
    }
    await (state === "active"
      ? runReal(short)
      : ensureActive().then((ok) => (ok ? runReal(short) : undefined)));
  }

  // --- imports: the app's runner (host/importers.ts), in memory ---
  const sceneApi = scene.api(
    {
      track: (fn) => ({ dispose: fn }),
      guard,
      logError: (text) => logLine("error", text),
      dataKey,
    },
    () => {
      throw notSetUp("React hooks in an import");
    },
  );
  const findImporter = (fileName: string): string | null => {
    const lower = baseName(fileName).toLowerCase();
    for (let i = lower.indexOf("."); i >= 0; i = lower.indexOf(".", i + 1)) {
      const hit = importerByExt.get(lower.slice(i + 1));
      if (hit) {
        return hit;
      }
    }
    return null;
  };
  const importFile = async (
    fileName: string,
    content: string | Uint8Array,
    at?: { x: number; y: number },
  ): Promise<FakeBatch | null> => {
    if (importing) {
      toast(importBusyMessage, "info");
      return null;
    }
    const importerId = findImporter(fileName);
    if (importerId === null) {
      throw new Error(`no importer declared for ${fileName}`);
    }
    if (activePath === null) {
      throw new Error("no drawing is open");
    }
    const bytes =
      typeof content === "string" ? new TextEncoder().encode(content) : content;
    if (bytes.length > MAX_IMPORT_BYTES) {
      toast(importTooBigMessage(baseName(fileName)), "info");
      return null;
    }
    const target = activePath;
    const ctl = new AbortController();
    importing = ctl;
    try {
      if (!(await ensureActive())) {
        toast(`${info.name}: could not be loaded`, "error");
        return null;
      }
      const importer = importerImpls.get(importerId);
      if (!importer) {
        const message = importMissingMessage(info.name, importerId);
        reportError(new Error(message), "import");
        toast(message, "error");
        return null;
      }
      const input = makeImportInput(fileName, bytes.length, async () => bytes);
      const run = guard(async () => {
        try {
          return await importer.import(input, {
            signal: ctl.signal,
            at: at ?? sceneApi.viewportCenter(),
            path: target,
          });
        } catch (err) {
          toast(
            importFailedMessage(info.name, baseName(fileName), errorText(err)),
            "error",
          );
          throw err;
        }
      }, `importer ${importerId}`);
      const ops = resultOps(await run());
      if (ctl.signal.aborted) {
        if (ctl.signal.reason === "cancel") {
          toast(importCancelledMessage(info.name), "info");
        } else if (ctl.signal.reason === "switch" && ops) {
          toast(importChangedMessage(info.name), "error");
        }
        return null;
      }
      if (!ops) {
        return null;
      }
      if (activePath !== target) {
        toast(importChangedMessage(info.name), "error");
        return null;
      }
      if (sceneReadOnly) {
        toast(importReadOnlyMessage, "info");
        return null;
      }
      try {
        await sceneApi.batch(ops);
      } catch (err) {
        reportError(err, "import");
        toast(
          importFailedMessage(info.name, baseName(fileName), errorText(err)),
          "error",
        );
        return null;
      }
      return scene.fake.batches[scene.fake.batches.length - 1] ?? null;
    } finally {
      if (importing === ctl) {
        importing = null;
      }
    }
  };

  const rtl = deps?.rtl;
  /** Renders the panels root once; unmounting it forgets the view. */
  const mount = (d: PanelDeps): RenderResult => {
    const shown = d.rtl.render(
      panelsRoot(d, {
        pluginId: id,
        open: () => [...openPanels],
        version: () => panelVersion,
        subscribe: (cb) => {
          panelSubs.add(cb);
          return () => panelSubs.delete(cb);
        },
        component: (s) => components.get(s),
        title: (s) => declaredPanels.get(s) ?? s,
        report: (err) => reportError(err, "panel render"),
      }),
    );
    const unmount = shown.unmount;
    shown.unmount = () => {
      unmount();
      if (view === shown) {
        view = null;
      }
    };
    return shown;
  };
  const act = async <T>(fn: () => Promise<T>): Promise<T> => {
    const result = await (rtl ? (rtl.act(fn) as unknown as Promise<T>) : fn());
    await overlayLoading;
    return result;
  };

  const startupIds = info.activation.includes("onStartupFinished");
  clipboardModel.setActivator(
    info.activation.includes("onPaste") ? ensureActive : null,
  );
  decls = declaredSettings(id, info.contributes.settings, (text) =>
    logLine("warn", text),
  );

  return {
    info,
    scene: fakeScene,
    theme,
    storage,
    vault: vault.fake,
    workspace: vault.workspace,
    folders: folders.fake,
    pdf: pdfModel.fake,
    clipboard: clipboardModel.fake,
    importFile,
    cancelImport() {
      if (!importing) {
        return false;
      }
      importing.abort("cancel");
      return true;
    },
    log: () => lines,
    statusBar: () =>
      [...statusItems].map(([itemId, v]) => ({
        id: itemId,
        title: declaredStatus.get(itemId)?.title ?? itemId,
        ...v,
        tooltip: v.tooltip ?? declaredStatus.get(itemId)?.title ?? null,
        command: declaredStatus.get(itemId)?.command ?? null,
      })),
    toasts: () => toastQueue.map((t) => t.message),
    timers: () => activeTimers,
    act,
    async startup() {
      if (startupIds) {
        await ensureActive();
      }
    },
    run: (short) => act(() => runCommand(short)),
    callMethod: (name, params) => act(() => callMethod(name, params)),
    async openPanel(short) {
      if (!enabled || !declaredPanels.has(short)) {
        throw new Error(
          `no command "${id}.panel.${short}" (declared in the manifest?)`,
        );
      }
      if (!deps) {
        throw notSetUp("panels need react and @testing-library/react");
      }
      await act(async () => {
        const ok = await ensureActive();
        if (!ok || !components.has(short)) {
          throw new Error(`panel ${id}.${short} declared but not registered`);
        }
        openPanels.add(short);
        panelsChanged();
        view ??= mount(deps);
      });
      return view!;
    },
    async insertShape(shapeId) {
      if (!(info.contributes.shapes ?? []).some((s) => s.id === shapeId)) {
        throw new Error(`no shape "${shapeId}" is declared`);
      }
      if (!(await ensureActive())) {
        return;
      }
      const insert = shapeInserters.get(shapeId);
      if (!insert) {
        throw new Error(`shape ${shapeId} declared but not registered`);
      }
      await act(() => insert());
    },
    tool(toolId) {
      const drive =
        (phase: "pointerDown" | "pointerMove" | "pointerUp") =>
        async (x: number, y: number, mods = {}) => {
          if (!declaredTools.has(toolId)) {
            throw new Error(`no tool "${toolId}" is declared`);
          }
          if (!(await ensureActive())) {
            return;
          }
          const point = {
            x,
            y,
            shiftKey: false,
            altKey: false,
            modKey: false,
            ...mods,
          };
          await act(async () => {
            await toolHandlers.get(toolId)?.[phase]?.(point);
          });
        };
      return {
        down: drive("pointerDown"),
        move: drive("pointerMove"),
        up: drive("pointerUp"),
        async cancel() {
          toolHandlers.get(toolId)?.cancel?.();
        },
      };
    },
    menuItems: (surface, kind) =>
      menuItems
        .filter(
          (m) =>
            m.surface === surface &&
            (m.kinds.length === 0 || (!!kind && m.kinds.includes(kind))),
        )
        .map((m) => ({ title: m.title, command: m.command })),
    async chooseMenuItem(surface, title, target = {}) {
      const item = menuItems.find(
        (m) => m.surface === surface && m.title === title,
      );
      if (!item) {
        throw new Error(`no ${surface} menu item "${title}"`);
      }
      menuTarget = { surface, path: null, ...target };
      try {
        await act(() => runCommand(item.command));
      } finally {
        menuTarget = null;
      }
    },
    notes: { seed: viewNotes.seed, text: viewNotes.text },
    async openView(path) {
      const base = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
      const found = [...declaredViews.values()].find((v) =>
        v.extensions.some((e) => base === e || base.endsWith(`.${e}`)),
      );
      if (!enabled || !found) {
        throw new Error(`no view is declared for ${path}`);
      }
      if (!deps) {
        throw notSetUp("views need react and @testing-library/react");
      }
      const d = deps;
      let shown: RenderResult | undefined;
      await act(async () => {
        const ok = await ensureActive();
        const C = ok
          ? (components.get(`view:${found.id}`) as
              | ComponentType<ViewProps>
              | undefined)
          : undefined;
        if (!C) {
          throw new Error(`view ${id}.${found.id} declared but not registered`);
        }
        const { createElement: h, Component } = d.react;
        class Boundary extends Component<
          { children?: ReactNode },
          { failed: boolean }
        > {
          state = { failed: false };
          static getDerivedStateFromError() {
            return { failed: true };
          }
          componentDidCatch(error: Error) {
            reportError(error, "view render");
          }
          render() {
            return this.state.failed
              ? h("div", { role: "alert" }, "This plugin view crashed.")
              : this.props.children;
          }
        }
        shown = d.rtl.render(
          h(
            Boundary,
            null,
            h(C, {
              path,
              file: viewNotes.file(id, info.permissions, path),
              openPath: (p, o) =>
                opened_views.push({ path: p, newTab: o?.target === "new" }),
            }),
          ),
        );
      });
      return shown!;
    },
    openedFromViews: () => opened_views.map((o) => ({ ...o })),
    openPanelIds: () => [...openPanels],
    renderMath: async (request) =>
      mathProvider ? mathProvider(request) : null,
    present() {
      const cur = presenting;
      return cur
        ? {
            laser: cur.laser,
            background: cur.options.background ?? null,
            end: cur.end,
          }
        : null;
    },
    overlay() {
      const open = overlay;
      if (!open) {
        return null;
      }
      return {
        close: () => overlayClose?.(),
        render() {
          const d = deps ?? overlayDeps;
          if (!d) {
            throw notSetUp("overlays need react and @testing-library/react");
          }
          return d.rtl.render(
            d.react.createElement(open.component, {
              close: () => overlayClose?.(),
            }),
          );
        },
      };
    },
    setSetting: writeSetting,
    emit(name, payload) {
      [...(eventSubs.get(name) ?? [])].forEach((cb) => cb(payload));
    },
    stop,
    reset() {
      closeAllPanels();
      rtl?.cleanup();
      toastQueue = [];
      globalValues.clear();
      settingSubs.clear();
      eventSubs.clear();
      themeSubs.clear();
      themeMode = "light";
      themeId = "default";
      themeTokens = null;
      vault.reset();
      folders.reset();
      pdfModel.reset();
      clipboardModel.reset();
      presenting?.end();
      activePath = "fake.excalidraw";
      sceneReadOnly = false;
      importerImpls.clear();
      statusItems.clear();
      stored = new Map();
      storageLimitKb = STORAGE_DEFAULT_LIMIT_KB;
      lines = [];
      errors = 0;
      scene.dispose();
    },
  };
}

/** Registers the manifest's declared settings; an invalid list registers nothing, as in the app. */
export function declaredSettings(
  pluginId: string,
  decls: readonly SettingDecl[],
  warn: (text: string) => void,
): readonly SettingDecl[] {
  const keys = new Set<string>();
  for (const d of decls) {
    const problem = declProblem(d);
    if (keys.has(d.key) || problem) {
      warn(
        `Invalid setting "${d.key}" of ${pluginId}: ${
          problem ?? "duplicate key"
        }`,
      );
      return [];
    }
    keys.add(d.key);
  }
  return decls;
}
