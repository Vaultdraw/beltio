import { matchesWords, queryWords } from "../search/matchWords";
import { compareEntries } from "../vault/sortOrder";
import { getBaseName } from "../vault/treeStore";

import { flattenTree } from "./tree/flattenTree";

import type { TreeNode } from "../vault/treeStore";
import type { TreeRow } from "./tree/flattenTree";

/** Nested folder nodes for the Move dialog, from flat folder paths. The vault root ("") is the single top node. */
export function buildFolderTree(folders: readonly string[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  const make = (path: string): TreeNode => {
    let node = nodes.get(path);
    if (!node) {
      node = {
        entry: {
          path,
          name: path === "" ? "Vault root" : getBaseName(path),
          kind: "folder",
          modifiedAt: 0,
          size: 0,
        },
        children: [],
      };
      nodes.set(path, node);
    }
    return node;
  };
  const root = make("");
  for (const folder of new Set(folders)) {
    if (folder === "") {
      continue;
    }
    // Every ancestor exists even if the list only names the leaf.
    let parent = root;
    let path = "";
    for (const segment of folder.split("/")) {
      path = path === "" ? segment : `${path}/${segment}`;
      const known = nodes.has(path);
      const node = make(path);
      if (!known) {
        parent.children!.push(node);
      }
      parent = node;
    }
  }
  // Each level in the file tree's order (natural: "Week 2" before "Week 10").
  for (const node of nodes.values()) {
    node.children!.sort((a, b) => compareEntries(a.entry, b.entry, "name_asc"));
  }
  return [root];
}

/** Paths whose name matches the type-ahead plus all their ancestors. */
export function matchingFolderPaths(
  folders: readonly string[],
  query: string,
): Set<string> {
  const keep = new Set<string>([""]);
  if (queryWords(query).length === 0) {
    return keep;
  }
  for (const folder of folders) {
    if (nameMatches(folder, query)) {
      let path = folder;
      while (path !== "") {
        keep.add(path);
        const slash = path.lastIndexOf("/");
        path = slash < 0 ? "" : path.slice(0, slash);
      }
    }
  }
  return keep;
}

/** `matches`: the folder itself fits the type-ahead (false for ancestors kept only for context; always true without a filter). */
export type MoveRow = TreeRow & { hasChildren: boolean; matches: boolean };

/**
 * Each word, in any order, with case and accents folded, like every type-to-filter list
 * (search/matchWords.ts): "cafe" finds "Café", "mocha catppuccin" finds "Catppuccin Mocha".
 */
const nameMatches = (path: string, query: string): boolean =>
  path !== "" && matchesWords(query, getBaseName(path));

/**
 * Rows the Move dialog shows: the whole tree with `expanded` folders open, or,
 * while a type-ahead is active, only matches and their ancestors, all open.
 */
export function moveRows(
  folders: readonly string[],
  expanded: ReadonlySet<string>,
  query: string,
): MoveRow[] {
  const filtering = query.trim() !== "";
  const keep = filtering ? matchingFolderPaths(folders, query) : null;
  const prune = (list: TreeNode[]): TreeNode[] =>
    list
      .filter((n) => !keep || keep.has(n.entry.path))
      .map((n) => ({ ...n, children: prune(n.children ?? []) }));
  const full = buildFolderTree(folders);
  const nodes = keep ? prune(full) : full;
  const open = keep ?? expanded;
  const hasKids = new Map<string, boolean>();
  const walk = (list: TreeNode[]) =>
    list.forEach((n) => {
      hasKids.set(n.entry.path, (n.children?.length ?? 0) > 0);
      walk(n.children ?? []);
    });
  walk(nodes);
  return flattenTree(nodes, open).map((row) => ({
    ...row,
    hasChildren: hasKids.get(row.entry.path) ?? false,
    matches: !filtering || nameMatches(row.entry.path, query),
  }));
}
