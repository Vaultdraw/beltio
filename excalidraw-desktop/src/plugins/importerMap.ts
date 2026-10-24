/**
 * Which plugin imports a file type. A tiny core store with no imports, so the
 * editor's drop path and "Import: File…" can read it without loading the
 * plugin host (startupGraph.test.ts).
 *
 * - Plugin stubs claim extensions from `contributes.importers` (no plugin code).
 * - The `plugins.importers` config key picks the owner of an extension, or
 *   turns plugin handling off for it with "".
 * - Without the key, the first plugin id in sort order wins; the others are
 *   listed by `importerClashes()` for the Plugins page.
 * - Lookups are O(1) per suffix: the winners are resolved on every change.
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

export interface ImporterClash {
  extension: string;
  winner: ImporterEntry | null;
  /** Plugins that claim the extension but do not handle it. */
  others: ImporterEntry[];
}

/** extension -> every claim, in claim order */
const claims = new Map<string, ImporterEntry[]>();
/** extension -> the claim that handles it */
let winners = new Map<string, ImporterEntry>();
let overrides: Readonly<Record<string, string>> = {};
let longestParts = 1;
let runner: ImportRunner | null = null;
let canceller: (() => boolean) | null = null;
let version = 0;
const listeners = new Set<() => void>();

const resolveWinners = () => {
  const next = new Map<string, ImporterEntry>();
  let longest = 1;
  for (const [ext, list] of claims) {
    if (list.length === 0) {
      continue;
    }
    const chosen = Object.hasOwn(overrides, ext) ? overrides[ext] : undefined;
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
  winners = next;
  longestParts = longest;
  version++;
  listeners.forEach((fn) => fn());
};

/** Claims `extensions` for one importer; returns the disposer. */
export function claimImporter(
  entry: ImporterEntry,
  extensions: readonly string[],
): () => void {
  const exts = [...new Set(extensions.map((e) => e.toLowerCase()))];
  for (const ext of exts) {
    const list = claims.get(ext) ?? [];
    list.push(entry);
    claims.set(ext, list);
  }
  resolveWinners();
  let done = false;
  return () => {
    if (done) {
      return;
    }
    done = true;
    for (const ext of exts) {
      const list = claims.get(ext);
      if (!list) {
        continue;
      }
      const i = list.indexOf(entry);
      if (i >= 0) {
        list.splice(i, 1);
      }
      if (list.length === 0) {
        claims.delete(ext);
      }
    }
    resolveWinners();
  };
}

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
  overrides = clean;
  resolveWinners();
}

/** True when any extension is handled by a plugin (the drop path's one check). */
export const hasImporters = (): boolean => winners.size > 0;

/** The importer for a file name; the longest suffix wins (`excalidraw.md` before `md`). */
export function findImporter(name: string): ImporterMatch | null {
  if (winners.size === 0) {
    return null;
  }
  const parts = name.toLowerCase().split(".");
  // parts[0] is the base name: a file called "txt" has no extension.
  const first = Math.max(1, parts.length - longestParts);
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
export const importerExtensions = (): string[] => [...winners.keys()].sort();

/** Extensions claimed by more than one plugin, or turned off by the config key. */
export function importerClashes(): ImporterClash[] {
  const out: ImporterClash[] = [];
  for (const [extension, list] of claims) {
    const winner = winners.get(extension) ?? null;
    const others = list.filter((e) => e !== winner);
    if (others.length > 0) {
      out.push({ extension, winner, others });
    }
  }
  return out.sort((a, b) => a.extension.localeCompare(b.extension));
}

/** The plugin host sets the runner when it starts; null clears it. */
export function setImportRunner(next: ImportRunner | null): void {
  runner = next;
}

/** Runs plugin imports; false when the plugin host is not running. */
export async function runImports(
  items: readonly ImportItem[],
  target: ImportTarget,
): Promise<boolean> {
  if (!runner || items.length === 0) {
    return false;
  }
  await runner(items, target);
  return true;
}

/** The plugin host sets how to abort the running import. */
export function setImportCanceller(next: (() => boolean) | null): void {
  canceller = next;
}

/** "Import: Cancel": true when an import was running and is now aborted. */
export const cancelImports = (): boolean => canceller?.() ?? false;

/** For views (Plugins page): called after every change. */
export const subscribeImporters = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

export const importersVersion = (): number => version;

/** Tests only. */
export function resetImporterMap(): void {
  claims.clear();
  overrides = {};
  runner = null;
  canceller = null;
  resolveWinners();
}
