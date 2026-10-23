/**
 * Unknown-key check for config.toml: a key no mapping reads is reported (never
 * fatal), with a "did you mean" suggestion, like Alacritty's "Unused config
 * key" and Cargo's "unused manifest key". The known-key index is built lazily
 * from the mapping table on first use; the check is one pass over the parsed
 * tables. Suggestions are computed only for unknown keys.
 */

/** Tables whose keys are open (command ids, plugin ids): never checked. */
export const OPEN_TABLES: ReadonlySet<string> = new Set(["hotkeys", "plugin"]);

export interface UnknownKey {
  /** Dotted key as written: `table.key`, `table` or a root key. */
  key: string;
  /** Closest known key, if one is close enough. */
  suggestion: string | null;
  /** A known table written as a plain value (`interface = 1`). */
  notTable?: boolean;
}

type KnownIndex = ReadonlyMap<string, ReadonlySet<string>>;

/** table -> keys, from dotted mapping keys (`tools.arrow` -> tools: {arrow}). */
export const buildKnownIndex = (keys: readonly string[]): KnownIndex => {
  const index = new Map<string, Set<string>>();
  for (const dotted of keys) {
    const dot = dotted.indexOf(".");
    const table = dotted.slice(0, dot);
    const name = dotted.slice(dot + 1);
    let set = index.get(table);
    if (!set) {
      set = new Set();
      index.set(table, set);
    }
    set.add(name);
  }
  return index;
};

/** Levenshtein distance, capped: returns max + 1 once it is exceeded. */
export const editDistance = (a: string, b: string, max: number): number => {
  if (Math.abs(a.length - b.length) > max) {
    return max + 1;
  }
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      best = Math.min(best, row[j]);
    }
    if (best > max) {
      return max + 1;
    }
    prev = row;
  }
  return prev[b.length];
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
    if (OPEN_TABLES.has(table)) {
      continue;
    }
    const keys = known.get(table);
    if (!keys) {
      const guess = closest(table, [...known.keys(), ...OPEN_TABLES]);
      unknown.push({ key: table, suggestion: guess });
      continue;
    }
    if (!isTable(value)) {
      unknown.push({ key: table, suggestion: null, notTable: true });
      continue;
    }
    for (const name of Object.keys(value)) {
      if (!keys.has(name)) {
        const guess = closest(name, keys);
        unknown.push({
          key: `${table}.${name}`,
          suggestion: guess ? `${table}.${guess}` : null,
        });
      }
    }
  }
  return unknown;
};

/** The banner / log line for one unknown key. */
export const unknownKeyMessage = ({
  key,
  suggestion,
  notTable,
}: UnknownKey): string =>
  notTable
    ? `config.toml: ${key} must be a table like [${key}] (ignored)`
    : `config.toml: unknown key ${key} (ignored${
        suggestion ? `; did you mean ${suggestion}?` : ""
      })`;
