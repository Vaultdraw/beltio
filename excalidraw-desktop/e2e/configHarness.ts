import { initSettings, type InvokeFn } from "../src/vault/settingsSync";

type Table = Record<string, Record<string, unknown>>;
type HarnessWindow = Window & {
  /** The parsed config.toml (set with addInitScript; change it, then press Reload). */
  __e2eConfig?: Table;
  /** The parsed overrides.toml; update_config writes here. */
  __e2eOverrides?: Table;
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

/**
 * ?config=1: settings in config-folder mode over a fake native side with the
 * two layers (config.toml, overrides.toml). A change in Settings is stored in
 * the overrides layer and wins; `null` removes it. Opt-in: no other spec is
 * affected.
 */
export function startConfigHarness(win: Window) {
  const w = win as HarnessWindow;
  w.__e2eOverrides ??= {};
  const invoke = (async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "load_settings") {
      const base = w.__e2eConfig ?? {};
      const broken = w.__e2eOverridesBroken ?? null;
      const over = broken ? {} : w.__e2eOverrides ?? {};
      const error = broken ? { message: broken, line: 2 } : null;
      return {
        configDir: "/e2e/vaultdraw",
        configPath: "/e2e/vaultdraw/config.toml",
        statePath: "/e2e/state/state.json",
        overridesPath: "/e2e/state/overrides.toml",
        config: merge(base, over),
        configError: null,
        overridesError: error,
        layers: [
          {
            id: 0,
            kind: "config",
            path: "/e2e/vaultdraw/config.toml",
            status: "ok",
            error: null,
            config: base,
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
    if (cmd === "update_config") {
      const overrides = (w.__e2eOverrides ??= {});
      for (const change of (args?.changes ?? []) as {
        key: string;
        value: unknown;
        default?: unknown;
      }[]) {
        const [table, name] = change.key.split(".");
        const below = w.__e2eConfig?.[table]?.[name];
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
    }
    return null;
  }) as InvokeFn;
  return initSettings(win, {
    tauri: true,
    invoke,
    listen: (async () => () => {}) as never,
  });
}
