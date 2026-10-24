import { panelsRoot, type PanelDeps } from "./panels";
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
  validateSettingValue,
  type MockToast,
} from "./rules";
import { API_REVISION, FEATURES } from "./features";
import { createSceneModel } from "./scene";

import type {
  AppEventMap,
  Disposable,
  Json,
  Plugin,
  PluginContext,
  StorageApi,
  SettingDecl,
  SettingValue,
  ThemeApi,
  ThemeChange,
  ThemeMode,
  ThemeTokenName,
} from "@vaultdraw/api";
import type { ComponentType } from "react";
import type { RenderResult } from "@testing-library/react";
import type {
  FakeStorage,
  FakeTheme,
  PluginLogLine,
  TestPluginInfo,
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
  scene: ReturnType<typeof createSceneModel>["fake"];
  theme: FakeTheme;
  storage: FakeStorage;
  log(): readonly PluginLogLine[];
  toasts(): string[];
  timers(): number;
  /** Runs onStartupFinished activation, as the app does after launch. */
  startup(): Promise<void>;
  run(short: string): Promise<void>;
  openPanel(short: string): Promise<RenderResult>;
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
): MockHost {
  const id = info.id;
  const scene = createSceneModel("fake.excalidraw");

  // --- state ---
  let state: State = "idle";
  let promise: Promise<boolean> | null = null;
  let gen = 0;
  /** The stubs: while true the declared commands and panels exist. */
  let enabled = true;
  let disposeContext: (() => void) | null = null;
  const handlers = new Map<string, () => void | Promise<void>>();
  const components = new Map<string, ComponentType>();
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
        checkStorageQuota(new TextEncoder().encode(composeStorage(next)).length, storageLimitKb);
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
    const refuse = (what: "command" | "panel", short: string): Disposable => {
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
    const ctx: PluginContext = {
      manifest: {
        id,
        version: info.version,
        dir: info.dir,
        permissions: info.permissions,
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
        toast: (message) => toast(toastMessage(info.name, message)),
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
  const act = <T>(fn: () => Promise<T>): Promise<T> =>
    rtl ? (rtl.act(fn) as unknown as Promise<T>) : fn();

  const startupIds = info.activation.includes("onStartupFinished");
  decls = declaredSettings(id, info.contributes.settings, (text) =>
    logLine("warn", text),
  );

  return {
    info,
    scene: scene.fake,
    theme,
    storage,
    log: () => lines,
    toasts: () => toastQueue.map((t) => t.message),
    timers: () => activeTimers,
    act,
    async startup() {
      if (startupIds) {
        await ensureActive();
      }
    },
    run: (short) => act(() => runCommand(short)),
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
