import { initSettings, type InvokeFn } from "../src/vault/settingsSync";

type Table = Record<string, Record<string, unknown>>;
type HarnessWindow = Window & {
  /** The parsed config.toml (set with addInitScript; change it, then press Reload). */
  __e2eConfig?: Table;
  /** The parsed overrides.toml; update_config writes here. */
  __e2eOverrides?: Table;
  /** Included files, lowest first (`[include]`): `config` is null for a missing file. */
  __e2eIncludes?: { name: string; path: string; config: Table | null }[];
  /** When set, overrides.toml "fails to parse" with this message (line 2). */
  __e2eOverridesBroken?: string | null;
};

const merge = (base: Table, higher: Table): Table => {
  const out: Table = JSON.parse(JSON.stringify(base));
  for (const [table, keys] of Object.entries(higher)) {
    out[table] = { ...(out[table] ?? {}), ...keys };
  }
  return out;
};

/** Everything below overrides.toml: the included files, then config.toml. */
const lowerLayers = (w: HarnessWindow): Table =>
  [
    ...(w.__e2eIncludes ?? []).map((i) => i.config ?? {}),
    w.__e2eConfig ?? {},
  ].reduce((acc, layer) => merge(acc, layer), {} as Table);

/**
 * ?config=1: settings in config-folder mode over a fake native side with the
 * two layers (config.toml, overrides.toml). A change in Settings is stored in
 * the overrides layer and wins; `null` removes it. Opt-in: no other spec is
 * affected.
 */
export function startConfigHarness(win: Window) {
  const w = win as HarnessWindow;
  w.__e2eOverrides ??= {};
  // The native watcher reports every write to overrides.toml, ours included.
  const watchers: (() => void)[] = [];
  const echo = () => setTimeout(() => watchers.forEach((cb) => cb()), 50);
  const invoke = (async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "load_settings") {
      const own = w.__e2eConfig ?? {};
      const includes = w.__e2eIncludes ?? [];
      const base = lowerLayers(w);
      const broken = w.__e2eOverridesBroken ?? null;
      const over = broken ? {} : w.__e2eOverrides ?? {};
      const error = broken ? { message: broken, line: 2 } : null;
      return {
        configDir: "/e2e/vaultdraw",
        configPath: "/e2e/vaultdraw/config.toml",
        statePath: "/e2e/state/state.json",
        overridesPath: "/e2e/state/overrides.toml",
        config: merge(base, over),
        includeWarnings: [],
        configError: null,
        overridesError: error,
        layers: [
          ...includes.map((inc, i) => ({
            id: 2 + i,
            kind: "include",
            name: inc.name,
            path: inc.path,
            from: "/e2e/vaultdraw/config.toml",
            status: inc.config ? "ok" : "missing",
            error: inc.config
              ? null
              : { message: `include not found: ${inc.path}`, line: null },
            config: inc.config,
          })),
          {
            id: 0,
            kind: "config",
            path: "/e2e/vaultdraw/config.toml",
            status: "ok",
            error: null,
            config: own,
          },
          {
            id: 1,
            kind: "overrides",
            path: "/e2e/state/overrides.toml",
            status: error ? "error" : "ok",
            error,
            config: error ? null : over,
          },
        ],
        state: {},
      };
    }
    if (cmd === "reset_overrides") {
      const existed = Object.keys(w.__e2eOverrides ?? {}).length > 0;
      w.__e2eOverrides = {};
      echo();
      return existed;
    }
    if (cmd === "update_config") {
      const overrides = (w.__e2eOverrides ??= {});
      for (const change of (args?.changes ?? []) as {
        key: string;
        value: unknown;
        default?: unknown;
      }[]) {
        const [table, name] = change.key.split(".");
        const below = lowerLayers(w)[table]?.[name];
        const kept =
          change.value === null
            ? below !== undefined
              ? change.default
              : undefined
            : change.value === below
            ? undefined
            : change.value;
        overrides[table] ??= {};
        if (kept === undefined) {
          delete overrides[table][name];
        } else {
          overrides[table][name] = kept;
        }
      }
      echo();
    }
    return null;
  }) as InvokeFn;
  return initSettings(win, {
    tauri: true,
    invoke,
    listen: (async (_event: string, cb: () => void) => {
      watchers.push(cb);
      return () => {
        watchers.splice(watchers.indexOf(cb), 1);
      };
    }) as never,
  });
}
