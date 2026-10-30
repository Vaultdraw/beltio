/**
 * Tabs (F5): pure label helpers for the strip. No React, no IO.
 */

import { entryDisplayName } from "../vault/fileKind";

import type { Tab } from "./types";

export const HOME_TAB_LABEL = "New tab";

/** File name without the `.excalidraw` extension; home tab => "New tab". */
export const tabName = (path: string | null): string => {
  if (path === null) {
    return HOME_TAB_LABEL;
  }
  const base = path.split("/").pop() ?? path;
  return entryDisplayName(base) || base;
};

/** "Intro · DP/" style suffix from the `depth` closest parent folders. */
const folderSuffix = (path: string, depth: number): string => {
  const parts = path.split("/");
  parts.pop();
  if (parts.length === 0) {
    return "";
  }
  return ` · ${parts.slice(-depth).join("/")}/`;
};

/**
 * One label per tab, same order. Tabs that share a name get a folder suffix
 * (the parent folder, then more parents until unique, as VS Code does).
 * Home tabs never get a suffix.
 */
export const tabLabels = (tabs: readonly Pick<Tab, "path">[]): string[] => {
  const names = tabs.map((t) => tabName(t.path));
  // Same name, different kind (Idea.md next to Idea.excalidraw): everything that is not a note
  // shows its extension, as Obsidian does, so the tabs can be told apart.
  const byName = new Map<string, number[]>();
  names.forEach((name, i) => {
    if (tabs[i].path !== null) {
      byName.set(name, [...(byName.get(name) ?? []), i]);
    }
  });
  byName.forEach((indexes) => {
    const base = (i: number) => (tabs[i].path as string).split("/").pop()!;
    if (new Set(indexes.map(base)).size > 1) {
      for (const i of indexes) {
        if (base(i).toLowerCase() !== `${names[i]}.md`.toLowerCase()) {
          names[i] = base(i);
        }
      }
    }
  });
  const labels = [...names];
  const groups = new Map<string, number[]>();
  names.forEach((name, i) => {
    if (tabs[i].path === null) {
      return;
    }
    groups.set(name, [...(groups.get(name) ?? []), i]);
  });
  groups.forEach((indexes) => {
    if (indexes.length < 2) {
      return;
    }
    const maxDepth = Math.max(
      ...indexes.map((i) => (tabs[i].path as string).split("/").length - 1),
    );
    for (let depth = 1; depth <= Math.max(maxDepth, 1); depth++) {
      const suffixes = indexes.map((i) =>
        folderSuffix(tabs[i].path as string, depth),
      );
      indexes.forEach((i, k) => {
        labels[i] = names[i] + suffixes[k];
      });
      if (new Set(suffixes).size === suffixes.length) {
        break;
      }
    }
  });
  return labels;
};
