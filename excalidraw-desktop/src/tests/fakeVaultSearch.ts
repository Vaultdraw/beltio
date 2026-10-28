/**
 * Test/harness-only reference implementation of the `VaultSearch` contract
 * over a `FakeVaultRepository`. Mirrors the native index semantics (NFKD,
 * combining marks stripped, lowercase, every term must occur in name or
 * content) with a plain scan; never a production fallback.
 */
import { findTags, keyUnder, tagKey } from "../tags/grammar";

import type {
  ElementMatch,
  HighlightRange,
  IndexStatus,
  NamesListing,
  SearchHit,
  SearchOptions,
  SearchResponse,
  VaultSearch,
} from "../search/types";

import type { TagsResponse } from "../tags/types";
import type { VaultRepository } from "../vault/types";

const MAX_SNIPPET = 120;
const MAX_MATCHES = 5;
const COMBINING_MARKS = /\p{M}/gu;

type Normalized = { text: string; starts: number[]; ends: number[] };

/** Normalises per code point so every output unit maps back to UTF-16 offsets. */
export function normalizeWithMap(input: string): Normalized {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let offset = 0;
  for (const ch of input) {
    const piece = ch
      .normalize("NFKD")
      .replace(COMBINING_MARKS, "")
      .toLowerCase();
    for (let i = 0; i < piece.length; i++) {
      starts.push(offset);
      ends.push(offset + ch.length);
    }
    text += piece;
    offset += ch.length;
  }
  return { text, starts, ends };
}

export const normalizeQuery = (q: string) => normalizeWithMap(q).text;

function findRanges(n: Normalized, terms: string[]): HighlightRange[] {
  const ranges: HighlightRange[] = [];
  for (const term of terms) {
    let from = 0;
    for (;;) {
      const at = n.text.indexOf(term, from);
      if (at < 0) {
        break;
      }
      ranges.push([n.starts[at], n.ends[at + term.length - 1]]);
      from = at + Math.max(1, term.length);
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: HighlightRange[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) {
      last[1] = Math.max(last[1], r[1]);
    } else {
      merged.push([r[0], r[1]]);
    }
  }
  return merged;
}

function makeSnippet(
  original: string,
  ranges: HighlightRange[],
): { snippet: string; highlights: HighlightRange[] } {
  const line = original.replace(/\s/g, " ");
  if (line.length <= MAX_SNIPPET) {
    return { snippet: line, highlights: ranges };
  }
  const first = ranges[0]?.[0] ?? 0;
  let start = Math.max(0, first - 30);
  const end = Math.min(line.length, start + MAX_SNIPPET - 2);
  start = Math.max(0, Math.min(start, end - (MAX_SNIPPET - 2)));
  const prefix = start > 0 ? "…" : "";
  const suffix = end < line.length ? "…" : "";
  const shift = prefix.length - start;
  const highlights: HighlightRange[] = [];
  for (const [s, e] of ranges) {
    const cs = Math.max(s, start);
    const ce = Math.min(e, end);
    if (cs < ce) {
      highlights.push([cs + shift, ce + shift]);
    }
  }
  return {
    snippet: prefix + line.slice(start, end) + suffix,
    highlights,
  };
}

type Item = {
  elementId: string;
  containerId: string | null;
  kind: "text" | "frame" | "formula";
  text: string;
};

function extractItems(json: string): Item[] {
  let parsed: { elements?: unknown };
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const items: Item[] = [];
  const elements = Array.isArray(parsed.elements) ? parsed.elements : [];
  for (const el of elements as Array<Record<string, unknown>>) {
    if (el.isDeleted) {
      continue;
    }
    if (el.type === "text" && typeof el.text === "string" && el.text) {
      items.push({
        elementId: String(el.id),
        containerId: typeof el.containerId === "string" ? el.containerId : null,
        kind: "text",
        text: el.text,
      });
    } else if (
      (el.type === "frame" || el.type === "magicframe") &&
      typeof el.name === "string" &&
      el.name
    ) {
      items.push({
        elementId: String(el.id),
        containerId: null,
        kind: "frame",
        text: el.name,
      });
    } else if (el.type === "image") {
      const latex = (el.customData as { latex?: { source?: unknown } } | null)
        ?.latex;
      if (typeof latex?.source === "string" && latex.source.trim()) {
        items.push({
          elementId: String(el.id),
          containerId: null,
          kind: "formula",
          text: latex.source,
        });
      }
    }
  }
  return items;
}

/** `tag:#x` tokens (case-insensitive prefix) split from the free text. */
function splitTagFilters(q: string): { text: string; filters: string[] } {
  const text: string[] = [];
  const filters: string[] = [];
  for (const tok of q.split(/\s+/).filter(Boolean)) {
    if (!/^tag:/i.test(tok)) {
      text.push(tok);
      continue;
    }
    const key = tagKey(tok.slice(4).replace(/^#+/, "")).replace(/[/-]+$/, "");
    if (key && !filters.includes(key)) {
      filters.push(key);
    }
  }
  return { text: text.join(" "), filters };
}

/** Distinct tags of a drawing (first spelling per key wins). */
function docTags(items: Item[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const item of items) {
    for (const m of findTags(item.text)) {
      const key = tagKey(m.display);
      if (!out.has(key)) {
        out.set(key, m.display);
      }
    }
  }
  return out;
}

/** The tag plus every ancestor, as [key, display] (display cut by segments). */
function withAncestors(key: string, display: string): [string, string][] {
  const keys = key.split("/");
  const shown = display.split("/");
  return keys.map((_, i): [string, string] => [
    keys.slice(0, i + 1).join("/"),
    shown.slice(0, i + 1).join("/"),
  ]);
}

export class FakeVaultSearch implements VaultSearch {
  private listeners = new Set<(s: IndexStatus) => void>();
  private override: Partial<Pick<IndexStatus, "state" | "indexed">> | null =
    null;

  /** Opt-in lazy mode (D8): the index is "loading" until start() or the first query. */
  private started: boolean;
  /** Every start() call and first-query start, in order ("start" | "query"). */
  readonly startCalls: string[] = [];

  constructor(
    private readonly repository: VaultRepository,
    options: { lazy?: boolean } = {},
  ) {
    this.started = !options.lazy;
  }

  private begin(handle: string, by: string): boolean {
    if (this.started) {
      return false;
    }
    this.started = true;
    this.startCalls.push(by);
    const emit = async (state: "building" | "ready") => {
      const s = { ...(await this.status(handle)), state };
      for (const l of [...this.listeners]) {
        l(s);
      }
    };
    setTimeout(() => {
      void emit("building").then(() => emit("ready"));
    }, 20);
    return true;
  }

  async start(handle: string): Promise<void> {
    this.begin(handle, "start");
  }

  /** Test hook: pretend the index is still building (or ready again with null). */
  setIndexState(
    override: Partial<Pick<IndexStatus, "state" | "indexed">> | null,
    handle = "",
  ) {
    this.override = override;
    void this.status(handle).then((s) => {
      for (const l of [...this.listeners]) {
        l(s);
      }
    });
  }

  private async drawings(handle: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string) => {
      for (const e of await this.repository.listDirectory(handle, dir)) {
        if (e.kind === "folder") {
          await walk(e.path);
        } else if (e.kind === "drawing") {
          // Notes hold no drawing JSON: never read them as drawings (toimprove 89).
          out.push(e.path);
        }
      }
    };
    await walk("");
    return out;
  }

  private async items(handle: string, path: string): Promise<Item[]> {
    return extractItems((await this.repository.readDrawing(handle, path)).json);
  }

  async tags(handle: string): Promise<TagsResponse> {
    const started = Date.now();
    const counts = new Map<string, number>();
    const displays = new Map<string, string>();
    const byPath: Record<string, string[]> = {};
    for (const path of await this.drawings(handle)) {
      const tags = docTags(await this.items(handle, path));
      if (tags.size === 0) {
        continue;
      }
      byPath[path] = [...tags.values()];
      const keys = new Set<string>();
      for (const [key, display] of tags) {
        for (const [k, d] of withAncestors(key, display)) {
          keys.add(k);
          const seen = displays.get(k);
          if (seen === undefined || d < seen) {
            displays.set(k, d);
          }
        }
      }
      keys.forEach((k) => counts.set(k, (counts.get(k) ?? 0) + 1));
    }
    const tags = [...counts]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([tag, count]) => ({ tag, display: displays.get(tag)!, count }));
    return {
      tags,
      byPath,
      status: await this.status(handle),
      tookMs: Date.now() - started,
    };
  }

  async status(handle: string): Promise<IndexStatus> {
    if (!this.started) {
      return { handle, state: "loading", indexed: 0, total: 0 };
    }
    const total = (await this.drawings(handle)).length;
    const state = this.override?.state ?? "ready";
    return {
      handle,
      state,
      indexed: this.override?.indexed ?? total,
      total,
    };
  }

  async listNames(handle: string): Promise<NamesListing> {
    if (this.begin(handle, "query")) {
      return { paths: [], status: await this.status(handle) };
    }
    const paths = (await this.drawings(handle)).sort();
    return { paths, status: await this.status(handle) };
  }

  async subscribe(listener: (s: IndexStatus) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async search(
    handle: string,
    query: string,
    opts?: SearchOptions,
  ): Promise<SearchResponse> {
    const started = Date.now();
    if (this.begin(handle, "query")) {
      return {
        query,
        results: [],
        totalMatches: 0,
        status: { handle, state: "loading", indexed: 0, total: 0 },
        tookMs: 0,
      };
    }
    const status = await this.status(handle);
    const { text, filters } = splitTagFilters(query);
    const terms = normalizeQuery(text).split(/\s+/).filter(Boolean);
    const scope = opts?.scope ?? "all";
    const limit = Math.min(opts?.limit ?? 50, 200);
    const hits: SearchHit[] = [];
    if (terms.length > 0 || filters.length > 0) {
      for (const path of await this.drawings(handle)) {
        const name = path.slice(path.lastIndexOf("/") + 1);
        const nameN = normalizeWithMap(name);
        const all = await this.items(handle, path);
        const items = scope === "names" ? [] : all;
        const tagKeys = [...docTags(all).keys()];
        if (!filters.every((f) => tagKeys.some((k) => keyUnder(k, f)))) {
          continue;
        }
        const itemNs = items.map((i) => normalizeWithMap(i.text));
        const nameText = scope === "content" ? "" : nameN.text;
        const ok = terms.every(
          (t) => nameText.includes(t) || itemNs.some((n) => n.text.includes(t)),
        );
        if (!ok) {
          continue;
        }
        const nameHighlights =
          scope === "content" ? [] : findRanges(nameN, terms);
        const matches: ElementMatch[] = [];
        let matchCount = 0;
        items.forEach((item, i) => {
          const ranges =
            terms.length > 0
              ? findRanges(itemNs[i], terms)
              : findTags(item.text)
                  .filter((m) =>
                    filters.some((f) => keyUnder(tagKey(m.display), f)),
                  )
                  .map((m): HighlightRange => [m.start, m.end]);
          if (ranges.length === 0) {
            return;
          }
          matchCount++;
          if (matches.length < MAX_MATCHES) {
            matches.push({
              elementId: item.elementId,
              containerId: item.containerId,
              kind: item.kind,
              ...makeSnippet(item.text, ranges),
            });
          }
        });
        hits.push({
          path,
          name,
          score: (nameHighlights.length ? 100 : 0) + matchCount,
          nameHighlights,
          matches,
          matchCount,
        });
      }
    }
    hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    return {
      query,
      results: hits.slice(0, limit),
      totalMatches: hits.length,
      status,
      tookMs: Date.now() - started,
    };
  }
}
