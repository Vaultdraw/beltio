/**
 * Graph filters, pure: settings + GraphData -> visibility mask, search dim set and node colours.
 *
 * Query grammar (search box and colour groups; terms are ANDed, `-` negates, quotes group):
 *   path:Folder   drawings whose path contains the text (other nodes: label contains it)
 *   tag:#x        drawings linked to tag node #x or a child tag (#x/y); the tag nodes themselves
 *   name / file:name   label contains the text
 * Matching ignores case and accents, like the vault search.
 */
import { packRgba, parseColour } from "./renderer/shared";
import { FLAG_ORPHAN, FLAG_TAG, FLAG_UNRESOLVED } from "./types";

import type { GraphSettings } from "./settings";
import type { GraphPalette } from "./theme";
import type { GraphData } from "./types";

export type Matcher = (node: number) => boolean;

type Term = {
  negate: boolean;
  kind: "name" | "path" | "tag";
  value: string;
};

const MARKS = /\p{M}/gu;
export const fold = (s: string) =>
  s.normalize("NFKD").replace(MARKS, "").toLowerCase();

const TERM = /(-?)(?:(path|tag|file):)?(?:"([^"]*)"|(\S+))/g;

export function parseQuery(query: string): Term[] {
  const terms: Term[] = [];
  for (const m of query.matchAll(TERM)) {
    let value = fold(m[3] ?? m[4] ?? "");
    const kind = m[2] === "path" ? "path" : m[2] === "tag" ? "tag" : "name";
    if (kind === "tag") {
      value = value.replace(/^#/, "");
    }
    if (value) {
      terms.push({ negate: m[1] === "-", kind, value });
    }
  }
  return terms;
}

const labelCache = new WeakMap<GraphData, string[]>();
const pathCache = new WeakMap<GraphData, string[]>();

function folded(
  cache: WeakMap<GraphData, string[]>,
  g: GraphData,
  get: (i: number) => string,
): string[] {
  let list = cache.get(g);
  if (!list) {
    list = new Array<string>(g.nodeCount);
    for (let i = 0; i < list.length; i++) {
      list[i] = fold(get(i));
    }
    cache.set(g, list);
  }
  return list;
}

const tagMatches = (tagLabel: string, v: string) => {
  const key = tagLabel.replace(/^#/, "");
  return key === v || key.startsWith(`${v}/`);
};

function termMatcher(g: GraphData, t: Term): Matcher {
  const labels = folded(labelCache, g, (i) => g.label(i));
  let test: Matcher;
  if (t.kind === "name") {
    test = (i) => labels[i].includes(t.value);
  } else if (t.kind === "path") {
    const paths = folded(pathCache, g, (i) => g.path(i) ?? g.label(i));
    test = (i) => paths[i].includes(t.value);
  } else {
    test = (i) => {
      if (g.flags[i] & FLAG_TAG) {
        return tagMatches(labels[i], t.value);
      }
      for (const j of g.neighbours(i)) {
        if (g.flags[j] & FLAG_TAG && tagMatches(labels[j], t.value)) {
          return true;
        }
      }
      return false;
    };
  }
  return t.negate ? (i) => !test(i) : test;
}

/** Null for an empty query (matches everything). */
export function compileQuery(g: GraphData, query: string): Matcher | null {
  const terms = parseQuery(query);
  if (!terms.length) {
    return null;
  }
  const ms = terms.map((t) => termMatcher(g, t));
  return ms.length === 1 ? ms[0] : (i) => ms.every((m) => m(i));
}

/** Global id of view node `i` (`ids` null = the view is the whole graph). */
const gid = (ids: Uint32Array | null, i: number) => (ids ? ids[i] : i);

/** 1 = hidden by a toggle; null when nothing is hidden. Orphans only hide in the global graph. */
export function visibilityMask(
  g: GraphData,
  s: Pick<GraphSettings, "showTags" | "showUnresolved" | "showOrphans">,
  ids: Uint32Array | null = null,
): Uint8Array | null {
  const n = ids ? ids.length : g.nodeCount;
  let hide = 0;
  if (!s.showTags) {
    hide |= FLAG_TAG;
  }
  if (!s.showUnresolved) {
    hide |= FLAG_UNRESOLVED;
  }
  if (!s.showOrphans && !ids) {
    hide |= FLAG_ORPHAN;
  }
  if (!hide) {
    return null;
  }
  const mask = new Uint8Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    if (g.flags[gid(ids, i)] & hide) {
      mask[i] = 1;
      any = true;
    }
  }
  return any ? mask : null;
}

/** 1 = matches the search (stays bright); null when the search is empty. */
export function searchBright(
  g: GraphData,
  search: string,
  ids: Uint32Array | null = null,
): Uint8Array | null {
  const m = compileQuery(g, search);
  if (!m) {
    return null;
  }
  const n = ids ? ids.length : g.nodeCount;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = m(gid(ids, i)) ? 1 : 0;
  }
  return out;
}

const colourOf = (css: string) => {
  const c = parseColour(css);
  return packRgba(
    Math.round(c[0] * 255),
    Math.round(c[1] * 255),
    Math.round(c[2] * 255),
    Math.round(c[3] * 255),
  );
};

export function nodeColours(
  g: GraphData,
  s: Pick<GraphSettings, "colourBy" | "groups">,
  palette: GraphPalette,
  ids: Uint32Array | null = null,
): Uint32Array {
  const n = ids ? ids.length : g.nodeCount;
  const folder = palette.folder.map(colourOf);
  const mono = colourOf(palette.mono);
  const ghost = colourOf(palette.ghost);
  const tag = colourOf(palette.tag);
  const groups = s.groups
    .map((grp) => ({ m: compileQuery(g, grp.query), c: colourOf(grp.colour) }))
    .filter((x): x is { m: Matcher; c: number } => x.m !== null);
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const id = gid(ids, i);
    let c: number | null = null;
    for (const grp of groups) {
      if (grp.m(id)) {
        c = grp.c;
        break;
      }
    }
    if (c === null) {
      const f = g.flags[id];
      if (f & FLAG_UNRESOLVED) {
        c = ghost;
      } else if (f & FLAG_TAG) {
        c = tag;
      } else {
        c = s.colourBy === "mono" ? mono : folder[g.folder[id] % folder.length];
      }
    }
    out[i] = c;
  }
  return out;
}

/** Base radius in CSS px at scale 1 (links grow the node), times the node size setting. */
export function nodeRadii(
  g: GraphData,
  nodeSize: number,
  ids: Uint32Array | null = null,
): Float32Array {
  const n = ids ? ids.length : g.nodeCount;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const id = gid(ids, i);
    out[i] = (3 + 1.5 * Math.sqrt(g.outDeg[id] + g.inDeg[id])) * nodeSize;
  }
  return out;
}
