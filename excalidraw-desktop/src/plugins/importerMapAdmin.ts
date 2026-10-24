/**
 * The importer map's write side and its views: plugin stubs claim extensions,
 * the plugin host sets the runner, the Plugins page lists clashes. Loaded only
 * with the plugin host or the Plugins page, never at startup.
 */
import {
  importersChanged,
  importerState as st,
  currentWinners,
  type ImporterEntry,
  type ImportRunner,
} from "./importerMap";

export interface ImporterClash {
  extension: string;
  winner: ImporterEntry | null;
  /** Plugins that claim the extension but do not handle it. */
  others: ImporterEntry[];
  /** `plugins.importers` names this plugin, but it does not import the extension. */
  unknownChoice?: string;
}

/** Claims `extensions` for one importer; returns the disposer. */
export function claimImporter(
  entry: ImporterEntry,
  extensions: readonly string[],
): () => void {
  const exts = [...new Set(extensions.map((e) => e.toLowerCase()))];
  for (const ext of exts) {
    const list = st.claims.get(ext) ?? [];
    list.push(entry);
    st.claims.set(ext, list);
  }
  importersChanged();
  let done = false;
  return () => {
    if (done) {
      return;
    }
    done = true;
    for (const ext of exts) {
      const list = st.claims.get(ext);
      if (!list) {
        continue;
      }
      const i = list.indexOf(entry);
      if (i >= 0) {
        list.splice(i, 1);
      }
      if (list.length === 0) {
        st.claims.delete(ext);
      }
    }
    importersChanged();
  };
}

/** Extensions claimed by more than one plugin, turned off, or set to a plugin that does not claim them. */
export function importerClashes(): ImporterClash[] {
  const winners = currentWinners();
  const out: ImporterClash[] = [];
  for (const [extension, list] of st.claims) {
    const winner = winners.get(extension) ?? null;
    const others = list.filter((e) => e !== winner);
    const choice = Object.hasOwn(st.overrides, extension)
      ? st.overrides[extension]
      : "";
    const unknownChoice =
      choice && !list.some((e) => e.pluginId === choice) ? choice : undefined;
    if (others.length > 0 || unknownChoice) {
      out.push(
        unknownChoice
          ? { extension, winner, others, unknownChoice }
          : { extension, winner, others },
      );
    }
  }
  return out.sort((a, b) => a.extension.localeCompare(b.extension));
}

/** The plugin host sets the runner when it starts; null clears it. */
export function setImportRunner(next: ImportRunner | null): void {
  st.runner = next;
}

/** The plugin host sets how to abort the running import. */
export function setImportCanceller(next: (() => boolean) | null): void {
  st.canceller = next;
}

/** For views (Plugins page): called after every change. */
export const subscribeImporters = (fn: () => void): (() => void) => {
  st.listeners.add(fn);
  return () => void st.listeners.delete(fn);
};

export const importersVersion = (): number => st.version;

/** Tests only. */
export function resetImporterMap(): void {
  st.claims.clear();
  st.overrides = {};
  st.runner = null;
  st.canceller = null;
  importersChanged();
}
