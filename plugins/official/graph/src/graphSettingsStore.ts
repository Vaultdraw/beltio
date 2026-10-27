/**
 * Per-vault graph settings in `<vault>/.excalidraw-vault/settings.toml`
 * under `[graph]` (D15/D17), through the plugin API's own-table calls
 * (`ctx.vault.table`: comment-preserving TOML, unknown keys kept). Keys are
 * flat (`force_repel`), values equal to the default are removed so the file
 * only holds what the user changed.
 */
import { DEFAULT_FORCE_SETTINGS } from "./barnesHut";
import {
  DEFAULT_GRAPH_SETTINGS,
  type GraphColourGroup,
  type GraphSettings,
} from "./settings";

export const GRAPH_SAVE_DELAY_MS = 500;
const MAX_GROUPS = 32;
const MAX_TEXT = 256;

type Json = Record<string, unknown>;
type Change = { key: string; value: unknown };

/** The plugin's own vault settings table (`ctx.vault.table`). */
export interface SettingsTable {
  read(): Promise<Record<string, unknown>>;
  update(changes: readonly Change[]): Promise<void>;
}

const num =
  (min: number, max: number) =>
  (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.min(max, Math.max(min, v))
      : undefined;
const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);
const text = (v: unknown) =>
  typeof v === "string" ? v.slice(0, MAX_TEXT) : undefined;

const groupsOf = (v: unknown): GraphColourGroup[] | undefined => {
  if (!Array.isArray(v)) {
    return undefined;
  }
  const out: GraphColourGroup[] = [];
  for (const g of v.slice(0, MAX_GROUPS)) {
    const query = text((g as Json | null)?.query);
    const colour = text((g as Json | null)?.colour);
    if (query !== undefined && colour !== undefined) {
      out.push({ query, colour });
    }
  }
  return out;
};

const D = DEFAULT_GRAPH_SETTINGS;
const F = DEFAULT_FORCE_SETTINGS;

/** One row per persisted setting: TOML key, reader (undefined = invalid), accessors. */
type Field = {
  key: string;
  read: (v: unknown) => unknown;
  get: (s: GraphSettings) => unknown;
  set: (s: GraphSettings, v: never) => void;
  def: unknown;
};
const field = <T>(
  key: string,
  read: (v: unknown) => T | undefined,
  get: (s: GraphSettings) => T,
  set: (s: GraphSettings, v: T) => void,
  def: T,
): Field => ({ key, read, get, set: set as Field["set"], def });

const FIELDS: Field[] = [
  field(
    "search",
    text,
    (s) => s.search,
    (s, v) => (s.search = v),
    D.search,
  ),
  field(
    "show_tags",
    bool,
    (s) => s.showTags,
    (s, v) => (s.showTags = v),
    D.showTags,
  ),
  field(
    "show_unresolved",
    bool,
    (s) => s.showUnresolved,
    (s, v) => (s.showUnresolved = v),
    D.showUnresolved,
  ),
  field(
    "show_orphans",
    bool,
    (s) => s.showOrphans,
    (s, v) => (s.showOrphans = v),
    D.showOrphans,
  ),
  field(
    "colour_by",
    (v) => (v === "folder" || v === "mono" ? v : undefined),
    (s) => s.colourBy,
    (s, v) => (s.colourBy = v),
    D.colourBy,
  ),
  field(
    "groups",
    groupsOf,
    (s) => s.groups,
    (s, v) => (s.groups = v),
    D.groups,
  ),
  field(
    "arrows",
    bool,
    (s) => s.arrows,
    (s, v) => (s.arrows = v),
    D.arrows,
  ),
  field(
    "text_fade",
    num(0, 4),
    (s) => s.textFade,
    (s, v) => (s.textFade = v),
    D.textFade,
  ),
  field(
    "node_size",
    num(0.2, 5),
    (s) => s.nodeSize,
    (s, v) => (s.nodeSize = v),
    D.nodeSize,
  ),
  field(
    "link_thickness",
    num(0.2, 5),
    (s) => s.linkThickness,
    (s, v) => (s.linkThickness = v),
    D.linkThickness,
  ),
  field(
    "force_centre",
    num(0, 1),
    (s) => s.forces.centre,
    (s, v) => (s.forces.centre = v),
    F.centre,
  ),
  field(
    "force_repel",
    num(0, 20),
    (s) => s.forces.repel,
    (s, v) => (s.forces.repel = v),
    F.repel,
  ),
  field(
    "force_link",
    num(0, 2),
    (s) => s.forces.linkForce,
    (s, v) => (s.forces.linkForce = v),
    F.linkForce,
  ),
  field(
    "force_distance",
    num(5, 200),
    (s) => s.forces.linkDistance,
    (s, v) => (s.forces.linkDistance = v),
    F.linkDistance,
  ),
  field(
    "local_depth",
    (v) => (v === 1 || v === 2 || v === 3 ? v : undefined),
    (s) => s.localDepth,
    (s, v) => (s.localDepth = v),
    D.localDepth,
  ),
];

export const freshGraphSettings = (): GraphSettings => ({
  ...D,
  groups: [],
  forces: { ...F },
});

/** The `[graph]` table (as JSON) -> valid settings; unknown keys ignored, bad values -> defaults. */
export function parseGraphSettings(table: unknown): GraphSettings {
  const out = freshGraphSettings();
  if (!table || typeof table !== "object" || Array.isArray(table)) {
    return out;
  }
  for (const f of FIELDS) {
    const v = f.read((table as Json)[f.key]);
    if (v !== undefined) {
      f.set(out, v as never);
    }
  }
  return out;
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** own-table changes turning `prev` into `next`; defaults are removed (null). */
export function graphSettingsChanges(
  prev: GraphSettings,
  next: GraphSettings,
): Change[] {
  const changes: Change[] = [];
  for (const f of FIELDS) {
    const value = f.get(next);
    if (!same(f.get(prev), value)) {
      changes.push({
        key: f.key,
        value: same(value, f.def) ? null : value,
      });
    }
  }
  return changes;
}

/** Read this vault's graph settings; any failure yields the defaults. */
export async function loadGraphSettings(
  table: SettingsTable,
): Promise<GraphSettings> {
  try {
    return parseGraphSettings(await table.read());
  } catch {
    return freshGraphSettings();
  }
}

export interface GraphSettingsSaver {
  /** Schedule a write of `next` (debounced; the last call wins). */
  save(next: GraphSettings): void;
  /** Write any pending change now. */
  flush(): Promise<void>;
}

/** Debounced writer; `saved` is what the file holds now (the loaded settings). */
export function createGraphSettingsSaver(
  table: SettingsTable,
  saved: GraphSettings,
  delay = GRAPH_SAVE_DELAY_MS,
): GraphSettingsSaver {
  let pending: GraphSettings | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = saved;
  let queue: Promise<void> = Promise.resolve();

  const write = (next: GraphSettings): Promise<void> => {
    const changes = graphSettingsChanges(last, next);
    if (changes.length === 0) {
      return Promise.resolve();
    }
    const before = last;
    last = next;
    queue = queue.then(async () => {
      try {
        await table.update(changes);
      } catch {
        last = before; // the next save re-sends the full diff
      }
    });
    return queue;
  };
  const flush = async () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const next = pending;
    pending = null;
    await (next ? write(next) : queue);
  };
  return {
    save(next) {
      pending = next;
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => void flush(), delay);
    },
    flush,
  };
}
