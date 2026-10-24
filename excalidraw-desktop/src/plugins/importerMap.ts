/**
 * Which plugin imports a file type. A tiny core store with no imports, so the
 * editor's drop path and "Import: File…" can read it without loading the
 * plugin host (startupGraph.test.ts).
 *
 * - Plugin stubs claim extensions from `contributes.importers` (no plugin code).
 * - The `plugins.importers` config key picks the owner of an extension, or
 *   turns plugin handling off for it with "".
 * - Without the key, the first plugin id in sort order wins; the others are
 *   listed for the Plugins page (importerMapAdmin.ts).
 * - Lookups are O(1) per suffix; winners are resolved lazily after a change.
 *
 * Only what the editor and the shell need lives here (it ships in the main
 * chunk). Claiming, clash listing and the runner setters are in
 * importerMapAdmin.ts, which only the lazy plugin host and Plugins page load.
 */

export interface ImporterEntry {
  pluginId: string;
  /** The importer's short id in its plugin.toml. */
  importerId: string;
  /** Shown on the Plugins page and in messages. */
  title: string;
}

export interface ImporterMatch extends ImporterEntry {
  /** The matched extension, lower case, no leading dot (`txt`, `excalidraw.md`). */
  extension: string;
}

/** Where an import goes: the drawing it targets and a scene point. */
export interface ImportTarget {
  /** Vault-relative path of the drawing the result goes into. */
  path: string;
  /** Scene coordinates: the drop point, or the viewport centre for the picker. */
  at: { x: number; y: number };
}

export interface ImportItem {
  file: File;
  match: ImporterMatch;
}

/** Set by the plugin host: runs the items one after another. */
export type ImportRunner = (
  items: readonly ImportItem[],
  target: ImportTarget,
) => Promise<void>;

/** Shared with importerMapAdmin.ts only. */
export const importerState = {
  /** extension -> every claim, in claim order */
  claims: new Map<string, ImporterEntry[]>(),
  /** extension -> the claim that handles it */
  winners: new Map<string, ImporterEntry>(),
  overrides: {} as Readonly<Record<string, string>>,
  longestParts: 1,
  runner: null as ImportRunner | null,
  canceller: null as (() => boolean) | null,
  version: 0,
  listeners: new Set<() => void>(),
  dirty: false,
};
const st = importerState;

/** Marks the winners stale; they are resolved on the next read (claims come in bursts at host start). */
export const importersChanged = () => {
  st.dirty = true;
  st.version++;
  st.listeners.forEach((fn) => fn());
};

const resolveWinners = () => {
  st.dirty = false;
  const next = new Map<string, ImporterEntry>();
  let longest = 1;
  for (const [ext, list] of st.claims) {
    if (list.length === 0) {
      continue;
    }
    const chosen = Object.hasOwn(st.overrides, ext)
      ? st.overrides[ext]
      : undefined;
    if (chosen === "") {
      continue;
    }
    const byOverride = chosen
      ? list.find((e) => e.pluginId === chosen)
      : undefined;
    const winner =
      byOverride ??
      list.reduce((a, b) => (b.pluginId < a.pluginId ? b : a), list[0]);
    next.set(ext, winner);
    longest = Math.max(longest, ext.split(".").length);
  }
  st.winners = next;
  st.longestParts = longest;
};

/** The resolved winners (resolves first after a change). */
export const currentWinners = (): Map<string, ImporterEntry> => {
  if (st.dirty) {
    resolveWinners();
  }
  return st.winners;
};

/** The `plugins.importers` config value: extension -> plugin id ("" = off). */
export function setImporterOverrides(
  next: Readonly<Record<string, string>> | null | undefined,
): void {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(next ?? {})) {
    if (typeof v === "string") {
      clean[k.toLowerCase().replace(/^\./, "")] = v;
    }
  }
  st.overrides = clean;
  importersChanged();
}

/** True when any extension is handled by a plugin (the drop path's one check). */
export const hasImporters = (): boolean => currentWinners().size > 0;

/** The importer for a file name; the longest suffix wins (`excalidraw.md` before `md`). */
export function findImporter(name: string): ImporterMatch | null {
  const winners = currentWinners();
  if (winners.size === 0) {
    return null;
  }
  const parts = name.toLowerCase().split(".");
  // parts[0] is the base name: a file called "txt" has no extension.
  const first = Math.max(1, parts.length - st.longestParts);
  for (let i = first; i < parts.length; i++) {
    const ext = parts.slice(i).join(".");
    const hit = winners.get(ext);
    if (hit) {
      return { ...hit, extension: ext };
    }
  }
  return null;
}

/** Extensions plugins handle now, for the picker's `accept`. */
export const importerExtensions = (): string[] =>
  [...currentWinners().keys()].sort();

/** Runs plugin imports; false when the plugin host is not running. */
export async function runImports(
  items: readonly ImportItem[],
  target: ImportTarget,
): Promise<boolean> {
  if (!st.runner || items.length === 0) {
    return false;
  }
  await st.runner(items, target);
  return true;
}

/** "Import: Cancel": true when an import was running and is now aborted. */
export const cancelImports = (): boolean => st.canceller?.() ?? false;
