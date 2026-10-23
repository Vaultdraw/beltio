/**
 * Per-vault settings (`<vault>/.excalidraw-vault/settings.toml`) and the
 * merge layer: per-vault value > global config.toml value > default.
 *
 * A setting is per-vault-capable by being listed in PER_VAULT_FIELDS; its key
 * and validator come from the same CONFIG_MAPPING row the global config uses.
 *
 * The runtime is a module-level singleton (like settingsSync): one vault is
 * attached at a time. All native calls are serialised in one queue.
 */
import { HISTORY_FIELDS } from "../history/historySettings";
import { TABS_VAULT_FIELDS } from "../tabs/tabsSettings";
import { TOOL_FIELDS } from "../toolDefaults/toolStyles";

import { buildKnownIndex, type KnownIndex } from "./configKeys";
import { isTauriAvailable } from "./DesktopVaultRepository";
import {
  parsePluginTable,
  pluginSettingsChanges,
  withPluginValue,
  type PluginSettingsMap,
  type PluginSettingValue,
} from "./pluginSettingsTable";

import {
  CONFIG_MAPPING,
  readDotted,
  show,
  TOOL_NESTED_KEYS,
  unknownKeyProblemsIn,
  type InvokeFn,
  type ListenFn,
  type SettingsProblem,
} from "./settingsSync";

import type { VaultPreferences } from "./preferences";

export const PER_VAULT_FIELDS = [
  "navigatorSort",
  "activityBar",
  "activityBarOrder",
  "activityBarHidden",
  "newDrawingFolder",
  "templatesFolder",
  "paperStyle",
  ...HISTORY_FIELDS,
  ...TABS_VAULT_FIELDS,
  ...TOOL_FIELDS,
] as const;
export type VaultField = typeof PER_VAULT_FIELDS[number];
export type VaultOverrides = Partial<Pick<VaultPreferences, VaultField>>;
export type EffectiveVaultSettings = Pick<VaultPreferences, VaultField>;

/** `[plugin.<id>]` overrides of this vault: plugin id -> key -> value. */
export type PluginOverrides = PluginSettingsMap;

export const VAULT_SETTINGS_CHANGE_EVENT = "vault-settings-change";

const describe = (
  expected: string | ((value: unknown) => string),
  value: unknown,
) => (typeof expected === "function" ? expected(value) : expected);

const mappingOf = (field: VaultField) => {
  const mapping = CONFIG_MAPPING.find((m) => m.field === field);
  if (!mapping) {
    throw new Error(`No config mapping for per-vault field ${field}`);
  }
  return mapping;
};

/**
 * settings.toml tables never checked: `[plugin.<id>]` (plugin ids) and
 * `[graph]` (validated by the lazily loaded graph view's own store).
 */
const VAULT_OPEN_TABLES: ReadonlySet<string> = new Set(["plugin", "graph"]);

let vaultKnownKeys: KnownIndex | null = null;
const vaultKnown = () =>
  (vaultKnownKeys ??= buildKnownIndex(
    PER_VAULT_FIELDS.map((field) => mappingOf(field).key),
    TOOL_NESTED_KEYS,
    VAULT_OPEN_TABLES,
  ));

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/** settings.toml (as JSON) -> valid overrides; invalid values are ignored. */
export function parseVaultSettings(json: unknown): {
  overrides: VaultOverrides;
  pluginOverrides: PluginOverrides;
  problems: SettingsProblem[];
} {
  const overrides: Record<string, unknown> = {};
  const problems: SettingsProblem[] = [];
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { overrides, pluginOverrides: {}, problems };
  }
  const plugins = parsePluginTable(
    (json as Record<string, unknown>).plugin,
    "settings.toml",
  );
  problems.push(...plugins.problems);
  for (const field of PER_VAULT_FIELDS) {
    const { key, valid, expected, normalize } = mappingOf(field);
    const { present, value: raw } = readDotted(
      json as Record<string, unknown>,
      key,
    );
    if (!present) {
      continue;
    }
    const value = normalize ? normalize(raw) : raw;
    if (valid(value)) {
      overrides[field] = value;
    } else {
      problems.push({
        kind: "invalid",
        key,
        message: `settings.toml: ${key} = ${show(
          value,
        )} is not valid (expected ${describe(expected, value)}); ignored`,
      });
    }
  }
  problems.push(
    ...unknownKeyProblemsIn(
      json as Record<string, unknown>,
      vaultKnown(),
      "settings.toml",
    ),
  );
  return {
    overrides: overrides as VaultOverrides,
    pluginOverrides: plugins.settings,
    problems,
  };
}

export const resolveSetting = <F extends VaultField>(
  field: F,
  overrides: VaultOverrides,
  prefs: Pick<VaultPreferences, F>,
): VaultPreferences[F] => (overrides[field] ?? prefs[field]) as never;

export const resolveSettings = (
  overrides: VaultOverrides,
  prefs: EffectiveVaultSettings,
): EffectiveVaultSettings =>
  Object.fromEntries(
    PER_VAULT_FIELDS.map((field) => [
      field,
      resolveSetting(field, overrides, prefs),
    ]),
  ) as EffectiveVaultSettings;

// ---------------------------------------------------------------------------
// Runtime store
// ---------------------------------------------------------------------------

export interface VaultSettingsSnapshot {
  handle: string | null;
  overrides: VaultOverrides;
  pluginOverrides: PluginOverrides;
  problems: SettingsProblem[];
  loaded: boolean;
}

export interface VaultSettingsDeps {
  invoke?: InvokeFn;
  listen?: ListenFn;
  /** Force native mode (tests). Defaults to isTauriAvailable(win). */
  tauri?: boolean;
}

interface LoadedPayload {
  settings: unknown;
  settingsError: { message: string; line: number | null } | null;
}

interface Session {
  handle: string;
  invoke: InvokeFn | null; // null = in-memory (plain browser)
  unlisten: (() => void) | null;
  queue: Promise<unknown>;
  generation: number;
  loadProblems: SettingsProblem[];
  writeProblems: SettingsProblem[];
  overrides: VaultOverrides;
  pluginOverrides: PluginOverrides;
}

const EMPTY: VaultSettingsSnapshot = {
  handle: null,
  overrides: {},
  pluginOverrides: {},
  problems: [],
  loaded: true,
};

let snapshot: VaultSettingsSnapshot = EMPTY;
let session: Session | null = null;
const listeners = new Set<() => void>();

export const getVaultSettingsSnapshot = (): VaultSettingsSnapshot => snapshot;

export function subscribeVaultSettings(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const ordered = (overrides: VaultOverrides): VaultOverrides => {
  const out: Record<string, unknown> = {};
  for (const field of PER_VAULT_FIELDS) {
    if (overrides[field] !== undefined) {
      out[field] = overrides[field];
    }
  }
  return out as VaultOverrides;
};

/** Replace the snapshot from the session; a no-op when nothing changed. */
function publish(s: Session, loaded: boolean): void {
  const next: VaultSettingsSnapshot = {
    handle: s.handle,
    overrides: ordered(s.overrides),
    pluginOverrides: s.pluginOverrides,
    problems: [...s.loadProblems, ...s.writeProblems],
    loaded,
  };
  if (JSON.stringify(next) === JSON.stringify(snapshot)) {
    return;
  }
  snapshot = next;
  for (const cb of [...listeners]) {
    cb();
  }
}

const setSnapshot = (next: VaultSettingsSnapshot) => {
  snapshot = next;
  for (const cb of [...listeners]) {
    cb();
  }
};

const messageOf = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
    ? String((error as { message: unknown }).message)
    : String(error);

const enqueue = <T>(s: Session, task: () => Promise<T>): Promise<T> => {
  const run = s.queue.then(task, task);
  s.queue = run.catch(() => {});
  return run;
};

async function reload(s: Session): Promise<void> {
  const generation = ++s.generation;
  let result: LoadedPayload;
  try {
    result = await s.invoke!<LoadedPayload>("load_vault_settings", {
      handle: s.handle,
    });
  } catch (error) {
    if (session === s && generation === s.generation) {
      s.loadProblems = [
        {
          kind: "io",
          message: `settings.toml: ${messageOf(error)}`,
        },
      ];
      publish(s, true);
    }
    return;
  }
  if (session !== s || generation !== s.generation) {
    return; // detached, or a newer load/write superseded this response
  }
  if (result.settingsError) {
    // Keep the last good overrides.
    const { message, line } = result.settingsError;
    s.loadProblems = [
      {
        kind: "parse",
        line,
        message: line
          ? `settings.toml line ${line}: ${message}`
          : `settings.toml: ${message}`,
      },
    ];
  } else {
    const parsed = parseVaultSettings(result.settings);
    s.overrides = parsed.overrides;
    s.pluginOverrides = parsed.pluginOverrides;
    s.loadProblems = parsed.problems;
  }
  publish(s, true);
}

/**
 * Attach the store to a vault. Resolves once the first load finished (or
 * immediately for a null handle / plain browser). Never throws.
 */
export async function attachVaultSettings(
  win: Window | null | undefined,
  handle: string | null,
  deps: VaultSettingsDeps = {},
): Promise<void> {
  detachVaultSettings();
  if (!handle) {
    return;
  }
  const s: Session = {
    handle,
    invoke: null,
    unlisten: null,
    queue: Promise.resolve(),
    generation: 0,
    loadProblems: [],
    writeProblems: [],
    overrides: {},
    pluginOverrides: {},
  };
  session = s;
  const native = deps.tauri ?? isTauriAvailable(win);
  if (!native) {
    publish(s, true);
    return;
  }
  setSnapshot({
    handle,
    overrides: {},
    pluginOverrides: {},
    problems: [],
    loaded: false,
  });
  try {
    s.invoke =
      deps.invoke ??
      ((await import("@tauri-apps/api/core")).invoke as InvokeFn);
    const listen =
      deps.listen ??
      ((await import("@tauri-apps/api/event")).listen as unknown as ListenFn);
    const unlisten = await listen<{ handle: string }>(
      VAULT_SETTINGS_CHANGE_EVENT,
      (event) => {
        if (session === s && event.payload?.handle === s.handle) {
          void enqueue(s, () => reload(s));
        }
      },
    );
    if (session !== s) {
      unlisten();
      return;
    }
    s.unlisten = unlisten;
    await enqueue(s, () => reload(s));
  } catch (error) {
    if (session === s) {
      s.loadProblems = [
        { kind: "io", message: `settings.toml: ${messageOf(error)}` },
      ];
      publish(s, true);
    }
  }
}

export function detachVaultSettings(): void {
  const s = session;
  session = null;
  if (s) {
    s.generation++;
    s.unlisten?.();
  }
  if (snapshot !== EMPTY) {
    setSnapshot(EMPTY);
  }
}

/**
 * Set (or with null remove) a per-vault override. The local snapshot updates
 * immediately; the file write is queued and the reloaded file wins. Resolves
 * true when the write succeeded, false when it was refused (the problem is
 * recorded in the snapshot).
 */
export async function setVaultOverride<F extends VaultField>(
  field: F,
  value: VaultPreferences[F] | null,
): Promise<boolean> {
  const s = session;
  if (!s) {
    return false;
  }
  const { key, valid, expected } = mappingOf(field);
  if (value !== null && !valid(value)) {
    s.writeProblems = [
      {
        kind: "invalid",
        key,
        message: `settings.toml: ${key} = ${show(
          value,
        )} is not valid (expected ${describe(expected, value)})`,
      },
    ];
    publish(s, snapshot.loaded);
    return false;
  }
  s.generation++; // any in-flight load predates this edit
  const overrides = { ...s.overrides };
  if (value === null) {
    delete overrides[field];
  } else {
    overrides[field] = value;
  }
  s.overrides = overrides;
  if (!s.invoke) {
    publish(s, true);
    return true;
  }
  s.writeProblems = [];
  publish(s, snapshot.loaded);
  return enqueue(s, async () => {
    let ok = true;
    try {
      await s.invoke!("update_vault_settings", {
        handle: s.handle,
        changes: [{ key, value }],
      });
    } catch (error) {
      ok = false;
      if (session === s) {
        s.writeProblems = [
          {
            kind: "io",
            key,
            message: `settings.toml: could not save ${key}: ${messageOf(
              error,
            )}`,
          },
        ];
      }
    }
    // Reload result wins (also reverts a refused optimistic edit).
    await reload(s);
    if (session === s) {
      publish(s, true);
    }
    return ok;
  });
}

/**
 * Set (or with undefined remove) one plugin setting override. The plugin's
 * whole `[plugin.<id>]` table is written, like a tool's style table. Resolves
 * false when there is no writable vault or the write failed.
 */
export async function setPluginOverride(
  pluginId: string,
  key: string,
  value: PluginSettingValue | undefined,
): Promise<boolean> {
  const s = session;
  if (!s) {
    return false;
  }
  s.generation++; // any in-flight load predates this edit
  const before = s.pluginOverrides;
  s.pluginOverrides = withPluginValue(before, pluginId, key, value);
  const [change] = pluginSettingsChanges(before, s.pluginOverrides);
  if (!s.invoke || !change) {
    publish(s, snapshot.loaded || !s.invoke);
    return true;
  }
  s.writeProblems = [];
  publish(s, snapshot.loaded);
  return enqueue(s, async () => {
    let ok = true;
    try {
      await s.invoke!("update_vault_settings", {
        handle: s.handle,
        changes: [change],
      });
    } catch (error) {
      ok = false;
      if (session === s) {
        s.writeProblems = [
          {
            kind: "io",
            key: change.key,
            message: `settings.toml: could not save ${change.key}: ${messageOf(
              error,
            )}`,
          },
        ];
      }
    }
    await reload(s); // the file wins; also reverts a refused edit
    if (session === s) {
      publish(s, true);
    }
    return ok;
  });
}
