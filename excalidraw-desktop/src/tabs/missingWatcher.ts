/**
 * Tabs: marks background tabs "missing" when their file is deleted or moved
 * outside the app, and clears the mark when it comes back. Event-driven: work
 * only starts for an event path that equals (or is a folder prefix of) a tab's
 * path, is coalesced for a short window (an autosave burst, or an in-app
 * rename whose event beats `controller.renamed`, settles first) and costs one
 * existence probe per affected tab. No timers run while nothing is affected.
 */
import { fileKind } from "../vault/fileKind";

import type { Tab, TabId } from "./types";

type TabView = Pick<Tab, "id" | "path"> & { missing?: boolean };

export type MissingWatcherDeps = {
  tabs: () => readonly TabView[];
  activeId: () => TabId;
  /** The cheapest existence probe the repository offers. */
  exists: (path: string) => Promise<boolean>;
  setMissing: (path: string, missing: boolean) => void;
  /**
   * Where a tab's file went when it vanished in a batch (an outside rename or move), or null.
   * Only the same revision counts (vault/renamePairing.ts). Optional: without it, missing.
   */
  findRenamed?: (
    tab: TabView,
    batch: readonly string[],
    active: boolean,
  ) => Promise<string | null>;
  renamed?: (from: string, to: string) => void;
  delayMs?: number;
};

export const DEFAULT_COALESCE_MS = 250;

/** Does a vault change at `eventPath` possibly affect `tabPath`? */
export const touchesPath = (eventPath: string, tabPath: string): boolean =>
  eventPath === tabPath || tabPath.startsWith(`${eventPath}/`);

/** Tab paths a change can affect (all drawing tabs on a rescan). */
export const affectedTabPaths = (
  eventPaths: readonly string[],
  tabs: readonly TabView[],
  rescan: boolean,
): string[] => {
  const out: string[] = [];
  for (const tab of tabs) {
    if (
      tab.path !== null &&
      (rescan || eventPaths.some((e) => touchesPath(e, tab.path as string)))
    ) {
      out.push(tab.path);
    }
  }
  return out;
};

export const createMissingWatcher = (deps: MissingWatcherDeps) => {
  const pending = new Set<string>();
  const batch = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const settle = async (): Promise<void> => {
    timer = null;
    const paths = [...pending];
    pending.clear();
    const seen = [...batch];
    batch.clear();
    for (const path of paths) {
      const tab = deps.tabs().find((t) => t.path === path);
      if (!tab) {
        continue; // closed, or renamed in-app meanwhile
      }
      const isActive = tab.id === deps.activeId();
      // A renamed or moved file: the tab follows it (an open drawing is followed by the document
      // hook; notes and background tabs here).
      if (deps.findRenamed && deps.renamed && !tab.missing) {
        const exists = await deps.exists(path).catch(() => true);
        if (!exists) {
          const to = await deps
            .findRenamed(tab, seen, isActive)
            .catch(() => null);
          if (
            to &&
            !disposed &&
            deps.tabs().some((t) => t.id === tab.id && t.path === path)
          ) {
            deps.renamed(path, to);
            continue;
          }
        }
      }
      // Shown: nothing to mark. A shown tab that is already marked may still be cleared.
      if (isActive && !tab.missing) {
        continue;
      }
      let exists: boolean;
      try {
        exists = await deps.exists(path);
      } catch {
        continue; // unknown: keep the current mark
      }
      const now = deps.tabs().find((t) => t.path === path);
      if (disposed || !now || now.missing === !exists) {
        continue;
      }
      if (!exists && now.id === deps.activeId()) {
        continue; // the active document keeps today's conflict flow
      }
      deps.setMissing(path, !exists);
    }
  };

  return {
    onChange(eventPaths: readonly string[], rescan: boolean): void {
      if (disposed) {
        return;
      }
      for (const p of affectedTabPaths(eventPaths, deps.tabs(), rescan)) {
        pending.add(p);
      }
      if (pending.size > 0) {
        for (const p of eventPaths) {
          batch.add(p);
        }
      }
      if (pending.size > 0 && timer === null) {
        timer = setTimeout(
          () => void settle(),
          deps.delayMs ?? DEFAULT_COALESCE_MS,
        );
      }
    },
    dispose(): void {
      disposed = true;
      pending.clear();
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
};

/** Existence via the revision probe, else the parent listing. */
export const probeExists = async (
  repo: {
    readRevision?: (handle: string, path: string) => Promise<string | null>;
    listDirectory: (
      handle: string,
      path: string,
    ) => Promise<readonly { path: string }[]>;
  },
  handle: string,
  path: string,
): Promise<boolean> => {
  // The native revision probe takes drawings only (it refuses a note with INVALID_PATH): notes
  // and other files go through the parent listing.
  const kind = fileKind(path);
  if (repo.readRevision && (kind === "drawing" || kind === "excalidrawMd")) {
    return (await repo.readRevision(handle, path)) !== null;
  }
  const slash = path.lastIndexOf("/");
  const entries = await repo.listDirectory(
    handle,
    slash < 0 ? "" : path.slice(0, slash),
  );
  return entries.some((e) => e.path === path);
};

/**
 * After a session restore: tabs whose file the first vault scan did not list
 * are probed once and marked missing when the file is gone (never removed).
 */
export const markUnlistedMissing = (
  tabs: readonly TabView[],
  known: ReadonlySet<string>,
  exists: (path: string) => Promise<boolean>,
  setMissing: (path: string) => void,
): void => {
  for (const tab of tabs) {
    const path = tab.path;
    if (path === null || known.has(path)) {
      continue;
    }
    void exists(path).then(
      (there) => {
        if (!there) {
          setMissing(path);
        }
      },
      () => undefined, // unknown: leave the tab alone
    );
  }
};
