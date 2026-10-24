/**
 * Unknown-key check for config.toml and a vault's settings.toml: a key no mapping reads is reported (never
 * fatal), with a "did you mean" suggestion, like Alacritty's "Unused config
 * key" and Cargo's "unused manifest key". The known-key index is built lazily
 * from the mapping table on first use; the check is one pass over the parsed
 * tables. Suggestions are computed only for unknown keys.
 */

/** config.toml tables whose keys are open (command ids, plugin ids): never checked. */
export const OPEN_TABLES: ReadonlySet<string> = new Set([
  "hotkeys",
  "plugin",
  // `[include] files` is read by the Rust loader, not by a mapping.
  "include",
]);

/**
 * Keys only the native side reads (no preference field): known, so never
 * reported as unknown. `[control] enabled` gates the control socket at launch.
 */
export const NATIVE_KEYS: readonly string[] = [
  "control.enabled",
  "control.uri_enabled",
  "control.uri_allow",
];

export interface UnknownKey {
  /** Dotted key as written: `table.key`, `table.sub.key`, `table` or a root key. */
  key: string;
  /** Closest known key, if one is close enough. */
  suggestion: string | null;
  /** A known table written as a plain value (`interface = 1`). */
  notTable?: boolean;
}

export interface KnownIndex {
  /** table -> keys. */
  tables: ReadonlyMap<string, ReadonlySet<string>>;
  /** `table.key` sub-tables whose own keys are checked too (`tools.arrow`). */
  nested: ReadonlyMap<string, ReadonlySet<string>>;
  /** Tables never checked. */
  open: ReadonlySet<string>;
}

/**
 * Index from dotted mapping keys (`tools.arrow` -> tools: {arrow}); `nested`
 * lists the keys allowed inside sub-tables (`tools.arrow` -> stroke_color, …).
 */
export const buildKnownIndex = (
  keys: readonly string[],
  nested: Readonly<Record<string, readonly string[]>> = {},
  open: ReadonlySet<string> = OPEN_TABLES,
): KnownIndex => {
  const tables = new Map<string, Set<string>>();
  for (const dotted of keys) {
    const dot = dotted.indexOf(".");
    const table = dotted.slice(0, dot);
    let set = tables.get(table);
    if (!set) {
      set = new Set();
      tables.set(table, set);
    }
    set.add(dotted.slice(dot + 1));
  }
  return {
    tables,
    nested: new Map(
      Object.entries(nested).map(([key, names]) => [key, new Set(names)]),
    ),
    open,
  };
};

/**
 * Edit distance counting a swap of two neighbours as one edit (optimal string
 * alignment), so `srot` is one edit from `sort`. Capped: returns max + 1 once
 * it is exceeded.
 */
export const editDistance = (a: string, b: string, max: number): number => {
  if (Math.abs(a.length - b.length) > max) {
    return max + 1;
  }
  let before: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let prevBest = 0;
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        row[j] = Math.min(row[j], before[j - 2] + 1);
      }
      best = Math.min(best, row[j]);
    }
    // A swap reaches back two rows, so stop only when both rows are over.
    if (best > max && prevBest > max) {
      return max + 1;
    }
    before = prev;
    prev = row;
    prevBest = best;
  }
  return Math.min(prev[b.length], max + 1);
};

/** Closest candidate within a third of the word's length (at least 1, at most 3). */
const closest = (word: string, candidates: Iterable<string>): string | null => {
  const max = Math.min(3, Math.max(1, Math.floor(word.length / 3)));
  let best: string | null = null;
  let bestDistance = max + 1;
  for (const candidate of candidates) {
    const d = editDistance(word, candidate, max);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
};

const isTable = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** Every key in `config` that no known table or key reads, in file order. */
export const findUnknownKeys = (
  config: Record<string, unknown>,
  known: KnownIndex,
): UnknownKey[] => {
  const unknown: UnknownKey[] = [];
  for (const [table, value] of Object.entries(config)) {
    if (known.open.has(table)) {
      continue;
    }
    const keys = known.tables.get(table);
    if (!keys) {
      const guess = closest(table, [...known.tables.keys(), ...known.open]);
      unknown.push({ key: table, suggestion: guess });
      continue;
    }
    if (!isTable(value)) {
      unknown.push({ key: table, suggestion: null, notTable: true });
      continue;
    }
    for (const [name, inner] of Object.entries(value)) {
      if (!keys.has(name)) {
        const guess = closest(name, keys);
        unknown.push({
          key: `${table}.${name}`,
          suggestion: guess ? `${table}.${guess}` : null,
        });
        continue;
      }
      const allowed = known.nested.get(`${table}.${name}`);
      if (allowed && isTable(inner)) {
        for (const sub of Object.keys(inner)) {
          if (!allowed.has(sub)) {
            const guess = closest(sub, allowed);
            unknown.push({
              key: `${table}.${name}.${sub}`,
              suggestion: guess ? `${table}.${name}.${guess}` : null,
            });
          }
        }
      }
    }
  }
  return unknown;
};

/** The banner / log line for one unknown key in `file`. */
export const unknownKeyMessage = (
  { key, suggestion, notTable }: UnknownKey,
  file = "config.toml",
): string =>
  notTable
    ? `${file}: ${key} must be a table like [${key}] (ignored)`
    : `${file}: unknown key ${key} (ignored${
        suggestion ? `; did you mean ${suggestion}?` : ""
      })`;
