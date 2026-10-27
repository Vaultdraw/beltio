/** What the hover card shows about one node (global node id). */
import { FLAG_TAG, FLAG_UNRESOLVED } from "./types";

import type { GraphData } from "./types";

export interface NodeInfo {
  kind: "drawing" | "ghost" | "tag";
  name: string;
  path: string | null;
  folder: string;
  tags: string[];
  /** Links to other nodes. */
  links: number;
  /** Drawings linking here (drawings only). */
  backlinks: number;
}

/**
 * What the graph writes next to a node: the drawing (or unresolved target) name without its
 * folders, like Obsidian; tags keep their full `#a/b` text. The folder is in the hover card.
 */
export function displayName(g: GraphData, i: number): string {
  const label = g.label(i);
  if (g.flags[i] & FLAG_TAG) {
    return label;
  }
  const slash = label.lastIndexOf("/");
  return slash >= 0 && slash < label.length - 1
    ? label.slice(slash + 1)
    : label;
}

export function describeNode(g: GraphData, i: number): NodeInfo {
  const f = g.flags[i];
  const kind = f & FLAG_TAG ? "tag" : f & FLAG_UNRESOLVED ? "ghost" : "drawing";
  const tags: string[] = [];
  if (kind === "drawing") {
    for (const j of g.neighbours(i)) {
      if (g.flags[j] & FLAG_TAG) {
        tags.push(g.label(j));
      }
    }
  }
  return {
    kind,
    name: displayName(g, i),
    path: g.path(i),
    folder: g.folderName(g.folder[i]),
    tags,
    links: g.outDeg[i],
    backlinks: kind === "drawing" ? g.inDeg[i] : 0,
  };
}
