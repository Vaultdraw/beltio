/** Builds the PluginContext of one plugin. Everything registered goes into `subscriptions`. */
import { closePanel, openPanel } from "../../slots/panelStore";
import { toastStore } from "../../toasts/toastStore";
import { dataKeyFor } from "../../sceneOps/validate";
import { getPreferences, subscribePreferences } from "../../vault/preferences";
import { subscribeVaultSettings } from "../../vault/vaultSettings";
import { allowsScope } from "../settings/declaredSettings";
import { getPluginSetting, setPluginSetting } from "../settings/pluginSettings";
import { pluginSettingDecl } from "../settings/registry";

import { cleanStatus } from "../../../../sdk/api/shared/statusBar";

import { getMenuTarget } from "../menuRegistry";
import { closeOverlay, getOverlay, showOverlay } from "../overlayStore";
import { setToolHandlers } from "../toolRegistry";
import { setShapeInserter } from "../shapeRegistry";
import { renderMath, setMathProvider } from "../mathService";
import { PluginApiError } from "../../../../sdk/api/shared/rules";
import { claimsPath } from "../../../../sdk/api/shared/viewNames";
import { checkVaultPath } from "../../../../sdk/api/shared/vaultPaths";
import { getWorkspaceBridge } from "../workspaceBridge";

import { createShapesApi } from "../../../../sdk/api/shared/shapes";

import { errorText, logLine, reportPluginError } from "./errors";
import { guard } from "./guard";
import { createHostApi } from "./hostContext";
import { runCommandById } from "./runner";
import { createGatedEventsApi } from "./eventGate";
import { clearPluginStatus, setStatusItem } from "./statusBarRegistry";
import {
  abortPluginImport,
  clearImporters,
  removeImporter,
  setImporter,
} from "./importerRegistry";

import { createFoldersApi } from "./foldersContext";
import { createMarkdownApi } from "./markdownContext";
import { createPagesApi } from "./pagesContext";
import { createSceneApi } from "./sceneContext";
import { createFontsApi, createTextApi } from "./textContext";
import { createThemeApi } from "./themeContext";
import { createStorageApi } from "./storageContext";
import { createVaultApi } from "./vaultContext";
import { createDiagramsApi } from "./diagramsContext";
import { createThumbnailsApi } from "./thumbnailsContext";
import { createWorkspaceApi } from "./workspaceContext";

import type {
  Disposable,
  FoldersApi,
  FontsApi,
  HostApi,
  ImportersApi,
  MarkdownApi,
  PagesApi,
  PluginContext,
  PluginPermission,
  StatusBarApi,
  StorageApi,
  TextApi,
  ThemeApi,
  MenusApi,
  OverlaysApi,
  ThumbnailsApi,
  DiagramsApi,
  ToolsApi,
  ShapesApi,
  MethodsApi,
  MathApi,
  VaultApi,
  ViewsApi,
  WorkspaceApi,
} from "../api";
import type { PluginRuntime } from "./types";
import type { ComponentType } from "react";
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
  const dataKey = dataKeyFor(id, info.dataKey);
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
  const declaredViews = new Set(
    (info.contributes.views ?? []).map((v) => v.id),
  );
  const declaredStatus = new Map(
    (info.contributes.status_bar ?? []).map((s) => [s.id, s] as const),
  );
  const declaredMethods = new Set(
    (info.contributes.methods ?? []).map((m) => m.id),
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
  let markdownApi: MarkdownApi | undefined;
  let textApi: TextApi | undefined;
  let fontsApi: FontsApi | undefined;
  let pagesApi: PagesApi | undefined;
  let foldersApi: FoldersApi | undefined;
  let workspaceApi: WorkspaceApi | undefined;
  let importersApi: ImportersApi | undefined;
  let statusBarApi: StatusBarApi | undefined;
  let viewsApi: ViewsApi | undefined;
  let menusApi: MenusApi | undefined;
  let toolsApi: ToolsApi | undefined;
  let shapesApi: ShapesApi | undefined;
  let methodsApi: MethodsApi | undefined;
  let mathApi: MathApi | undefined;
  let overlaysApi: OverlaysApi | undefined;
  let thumbnailsApi: ThumbnailsApi | undefined;
  let diagramsApi: DiagramsApi | undefined;

  const settingValue = (key: string) => getPluginSetting(id, key);

  const ctx: PluginContext = {
    manifest: {
      id,
      version: info.version,
      dir: info.dir,
      permissions: Object.freeze([...info.permissions]) as PluginPermission[],
      dataKey,
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
    scene: createSceneApi(id, track, isLive, {
      dataKey,
      maxOps: () => getPreferences(win).pluginsSceneMaxOps,
    }),
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
    get statusBar() {
      if (!statusBarApi) {
        const set: StatusBarApi["set"] = (itemId, state) => {
          const decl = declaredStatus.get(itemId);
          if (!decl) {
            refuse("status bar item", itemId);
            return;
          }
          if (isLive()) {
            setStatusItem(id, info.name, decl, cleanStatus(state));
          }
        };
        const clear: StatusBarApi["clear"] = (itemId) => {
          const decl = declaredStatus.get(itemId);
          if (decl) {
            setStatusItem(id, info.name, decl, null);
          }
        };
        statusBarApi = {
          set,
          clear,
          show(itemId, state) {
            set(itemId, state);
            return track(() => clear(itemId));
          },
        };
      }
      return statusBarApi;
    },
    get math() {
      return (mathApi ??= {
        render: (request) => renderMath(request),
        provide(renderer) {
          if (!isLive()) {
            return { dispose() {} };
          }
          return track(setMathProvider(renderer));
        },
      });
    },
    get methods() {
      return (methodsApi ??= {
        register(name, handler) {
          if (!declaredMethods.has(name)) {
            return refuse("method", name);
          }
          rt.methods.set(name, handler);
          return track(() => {
            if (rt.methods.get(name) === handler) {
              rt.methods.delete(name);
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
        (shapeId, insert) => setShapeInserter(`${id}.${shapeId}`, insert),
      ));
    },
    get tools() {
      return (toolsApi ??= {
        register(toolId, h) {
          if (!(info.contributes.tools ?? []).some((t) => t.id === toolId)) {
            return refuse("tool", toolId);
          }
          return track(setToolHandlers(`${id}.${toolId}`, h));
        },
      });
    },
    get thumbnails() {
      return (thumbnailsApi ??= createThumbnailsApi());
    },
    get diagrams() {
      return (diagramsApi ??= createDiagramsApi());
    },
    get overlays() {
      return (overlaysApi ??= {
        open(component, options) {
          const entry = {
            pluginId: id,
            Component: component,
            onClose: options?.onClose,
            modal: options?.modal === true,
          };
          if (isLive()) {
            showOverlay(entry);
          }
          const close = () => closeOverlay(entry);
          track(close); // the plugin stopping closes its overlay
          return {
            close,
            get isOpen() {
              return getOverlay() === entry;
            },
            dispose: close,
          };
        },
      });
    },
    get menus() {
      return (menusApi ??= { target: () => getMenuTarget(id) });
    },
    get views() {
      return (viewsApi ??= {
        register(short, component) {
          if (!declaredViews.has(short)) {
            return refuse("view", short);
          }
          const key = `view:${short}`;
          rt.components.set(key, component as ComponentType);
          return track(() => {
            if (rt.components.get(key) === component) {
              rt.components.delete(key);
            }
          });
        },
        async open(short, options) {
          if (declaredPanels.has(short)) {
            openPanel(panelId(short));
            return;
          }
          const view = (info.contributes.views ?? []).find(
            (v) => v.id === short,
          );
          if (!view) {
            throw new PluginApiError(
              "INVALID_ARGUMENT",
              `"${short}" is not a panel or view declared in plugin.toml`,
            );
          }
          const path = options?.path;
          if (typeof path !== "string" || !claimsPath(view.extensions, path)) {
            throw new PluginApiError(
              "INVALID_ARGUMENT",
              `view "${short}" shows notes named *.${view.extensions.join(
                ", *.",
              )}; open() needs a path like that`,
            );
          }
          checkVaultPath(path, "folder"); // the path rules; the claimed name is checked above
          const bridge = getWorkspaceBridge();
          if (!bridge?.vault()) {
            throw new PluginApiError("NO_VAULT", "No vault is open");
          }
          if (!(await bridge.openDrawing(path, options?.newTab === true))) {
            throw new PluginApiError("IO_ERROR", `Could not open ${path}`);
          }
        },
      });
    },
    get markdown() {
      return (markdownApi ??= createMarkdownApi(id));
    },
    get text() {
      return (textApi ??= createTextApi());
    },
    get fonts() {
      return (fontsApi ??= createFontsApi(win.document));
    },
    get pages() {
      return (pagesApi ??= createPagesApi(track, isLive, {
        dataKey,
        frame: (cb) => win.requestAnimationFrame(cb),
      }));
    },
    get folders() {
      return (foldersApi ??= createFoldersApi(rt));
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
      clearPluginStatus(id);
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
