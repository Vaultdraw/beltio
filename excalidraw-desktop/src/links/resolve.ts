/**
 * Link resolution over a path list (the TS twin of the Rust resolver, used
 * where the answer is needed synchronously: autocomplete, opening, the fake).
 * Order: relative form from the source folder, exact path, unique basename,
 * then the shortest matching path. Case- and accent-folded.
 */
import { foldKey } from "../search/foldKey";

import { findLinks, parseLinkField, stripExtension } from "./grammar";

import type { Resolution } from "./types";

/** Same fold as the search index (one case table pins both). */
export { foldKey };

const folderOf = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

const baseOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** `a/b` + `../c` -> `a/c`; null when it climbs out of the vault. */
export function joinRelative(folder: string, rel: string): string | null {
  const parts = folder ? folder.split("/") : [];
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") {
      continue;
    }
    if (seg === "..") {
      if (parts.length === 0) {
        return null;
      }
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join("/");
}

/** Path of `to` relative to the folder of `from` (no `./`), e.g. `../x/y`. */
export function relativePath(from: string, to: string): string {
  const a = folderOf(from) ? folderOf(from).split("/") : [];
  const b = to.split("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) {
    i++;
  }
  return [...Array(a.length - i).fill(".."), ...b.slice(i)].join("/");
}

const byLengthThenName = (a: string, b: string) =>
  a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);

export class LinkResolver {
  /** folded path without extension -> paths */
  private readonly full = new Map<string, string[]>();
  /** folded basename without extension -> paths */
  private readonly base = new Map<string, string[]>();
  readonly paths: readonly string[];

  constructor(paths: readonly string[]) {
    this.paths = paths;
    for (const path of paths) {
      const key = foldKey(stripExtension(path));
      push(this.full, key, path);
      push(this.base, key.slice(key.lastIndexOf("/") + 1), path);
    }
  }

  /** Resolve a target as written (no brackets). */
  resolveTarget(
    fromPath: string,
    target: string,
    relative = false,
  ): Resolution {
    const clean = stripExtension(target.trim().replace(/^\/+/, ""));
    if (!clean) {
      return { path: null, candidates: [] };
    }
    const explicit = clean.startsWith("./") || clean.startsWith("../");
    if (explicit || relative) {
      const joined = joinRelative(folderOf(fromPath), clean);
      const hit = joined === null ? undefined : this.full.get(foldKey(joined));
      if (hit) {
        return pick(hit);
      }
      if (explicit) {
        return { path: null, candidates: [] };
      }
    }
    const key = foldKey(clean);
    const exact = this.full.get(key);
    if (exact) {
      return pick(exact);
    }
    const slash = key.lastIndexOf("/");
    const basename = this.base.get(key.slice(slash + 1)) ?? [];
    if (slash < 0) {
      return pick(basename);
    }
    // Partial path ("Graphs/BFS"): any file whose path ends with it.
    const suffix = `/${key}`;
    return pick(
      basename.filter((p) => foldKey(stripExtension(p)).endsWith(suffix)),
    );
  }

  /** Resolve a link as written: `[[x|y]]`, a vaultdraw URL, `./x.excalidraw`, `x`. */
  resolve(fromPath: string, raw: string): Resolution {
    const text = raw.trim();
    if (text.startsWith("[[")) {
      const first = findLinks(text)[0];
      return first
        ? this.resolveTarget(fromPath, first.target)
        : { path: null, candidates: [] };
    }
    const field = parseLinkField(text);
    if (field) {
      return this.resolveTarget(fromPath, field.target, field.relative);
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(text)) {
      return { path: null, candidates: [] };
    }
    return this.resolveTarget(fromPath, text);
  }

  /**
   * The shortest form that still resolves to `path` by itself: the bare name,
   * else the fewest trailing folders that are unique, else the full path.
   */
  shortestTarget(path: string): string {
    const bare = stripExtension(path);
    const parts = bare.split("/");
    for (let n = 1; n < parts.length; n++) {
      const candidate = parts.slice(-n).join("/");
      const hit = this.resolveTarget("", candidate);
      if (hit.path === path && hit.candidates.length === 0) {
        return candidate;
      }
    }
    return bare;
  }
}

function push(map: Map<string, string[]>, key: string, value: string) {
  const list = map.get(key);
  if (list) {
    list.push(value);
  } else {
    map.set(key, [value]);
  }
}

function pick(matches: readonly string[]): Resolution {
  if (matches.length === 0) {
    return { path: null, candidates: [] };
  }
  if (matches.length === 1) {
    return { path: matches[0], candidates: [] };
  }
  const sorted = [...matches].sort(byLengthThenName);
  return { path: sorted[0], candidates: sorted };
}

export const createResolver = (paths: readonly string[]) =>
  new LinkResolver(paths);

export { baseOf, folderOf };
