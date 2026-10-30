import { naturalCompare } from "../vault/sortOrder";

import type { TagCount, TagSort } from "./types";

export type TagNode = {
  key: string;
  /** Full display, e.g. "DSA/Graphs". */
  display: string;
  /** Last segment of `display`. */
  label: string;
  count: number;
  children: TagNode[];
};

const node = (key: string, display: string, count: number): TagNode => ({
  key,
  display,
  label: display.slice(display.lastIndexOf("/") + 1),
  count,
  children: [],
});

/**
 * Nests the flat tag list by `/`. Keys sort parent-first, so a parent is
 * normally present; a missing one is synthesised with its largest child count.
 */
export function buildTagTree(
  tags: readonly TagCount[],
  sort: TagSort = "name",
): TagNode[] {
  const nodes = new Map<string, TagNode>();
  const roots: TagNode[] = [];
  const synthesised = new Set<string>();
  const attach = (n: TagNode) => {
    nodes.set(n.key, n);
    const cut = n.key.lastIndexOf("/");
    if (cut < 0) {
      roots.push(n);
      return;
    }
    const parentKey = n.key.slice(0, cut);
    let parent = nodes.get(parentKey);
    if (!parent) {
      parent = node(parentKey, n.display.slice(0, cut), 0);
      synthesised.add(parentKey);
      attach(parent);
    }
    parent.children.push(n);
  };
  const sorted = [...tags].sort((a, b) => (a.tag < b.tag ? -1 : 1));
  for (const t of sorted) {
    if (!nodes.has(t.tag)) {
      attach(node(t.tag, t.display, t.count));
    }
  }
  // the file tree's order, so "sprint/2" comes before "sprint/10" (toimprove 261)
  const byName = (a: TagNode, b: TagNode) => naturalCompare(a.label, b.label);
  // Count sort: most drawings first, name breaks ties. Applied at every level.
  const order =
    sort === "count"
      ? (a: TagNode, b: TagNode) => b.count - a.count || byName(a, b)
      : byName;
  const finish = (list: TagNode[]) => {
    for (const n of list) {
      finish(n.children);
      if (synthesised.has(n.key)) {
        n.count = Math.max(...n.children.map((c) => c.count));
      }
    }
    list.sort(order);
  };
  finish(roots);
  return roots;
}

export type TagRow = {
  node: TagNode;
  depth: number;
  hasChildren: boolean;
  isOpen: boolean;
  /** Key of the parent row, null for a root. */
  parent: string | null;
};

/** The rows a tree shows: collapsed nodes hide their descendants. */
export function flattenTree(
  tree: readonly TagNode[],
  collapsed: ReadonlySet<string>,
): TagRow[] {
  const rows: TagRow[] = [];
  const walk = (
    list: readonly TagNode[],
    depth: number,
    parent: string | null,
  ) => {
    for (const node of list) {
      const hasChildren = node.children.length > 0;
      const isOpen = hasChildren && !collapsed.has(node.key);
      rows.push({ node, depth, hasChildren, isOpen, parent });
      if (isOpen) {
        walk(node.children, depth + 1, node.key);
      }
    }
  };
  walk(tree, 0, null);
  return rows;
}
