import { DRAWING_EXT, hasDrawingExt } from "../vault/fileKind";
/**
 * Fuzzy scorer for the quick switcher (Cmd+P): ranks drawing paths and command
 * titles with one function. Case/diacritics-insensitive subsequence matching,
 * scored by a small Smith-Waterman-style alignment (fzf v2 family) with
 * boundary / camelCase / consecutive bonuses, an affine gap penalty, a strong
 * bonus for the file name (basename) and exact / prefix basename bonuses.
 * Space-separated query pieces must all match (AND), like VS Code.
 * See personal/feature/hotkeys/RESEARCH.md for the rationale and numbers.
 */

const COMBINING_MARKS = /\p{M}/gu;

const NEG = -0x3fffffff;
const MATCH = 16;
const CONSECUTIVE = 10;
const GAP_OPEN = 3;
const GAP_EXTEND = 1;
/** A gap never costs more than this, so acronyms across long folders still win. */
const GAP_MAX = 8;
const BASENAME_CHAR = 4;
const PREFIX_BONUS = 120;
const EXACT_BONUS = 300;

const B_PATH_START = 8;
const B_SEPARATOR = 6;
const B_CAMEL = 5;

export interface Prepared {
  /** Original text (positions index into this). */
  text: string;
  /** Folded, lowercased text without the ".excalidraw" extension. */
  norm: string;
  /** Per norm char: UTF-16 index of its source char in `text` (null = identity). */
  map: Int32Array | null;
  /** Index in `norm` where the basename starts. */
  base: number;
  /** Per norm char: match bonus (boundary / camelCase / basename). */
  bonus: Uint8Array;
}

export interface ScoreResult {
  score: number;
  positions: number[];
}

export interface Ranked<T> extends ScoreResult {
  item: T;
}

const isSeparator = (c: number) =>
  c === 32 || c === 45 || c === 95 || c === 46 || c === 40 || c === 58;
const isSlash = (c: number) => c === 47 || c === 92;

/** Fold one string the way F1 search does: NFKD, strip marks, lowercase. */
const fold = (s: string) =>
  s.normalize("NFKD").replace(COMBINING_MARKS, "").toLowerCase();

/** Precompute everything that does not depend on the query. Call once per item. */
export function prepare(text: string): Prepared {
  let origEnd = text.length;
  if (hasDrawingExt(text) && text.length > DRAWING_EXT.length) {
    origEnd = text.length - DRAWING_EXT.length;
  }
  const origBase =
    Math.max(
      text.lastIndexOf("/", origEnd - 1),
      text.lastIndexOf("\\", origEnd - 1),
    ) + 1;

  let norm = "";
  const starts: number[] = [];
  const camel: boolean[] = [];
  let identity = true;
  let base = -1;
  let prevLower = false;
  for (let i = 0; i < origEnd; ) {
    const code = text.charCodeAt(i);
    const len = code >= 0xd800 && code <= 0xdbff && i + 1 < origEnd ? 2 : 1;
    if (base < 0 && i >= origBase) {
      base = norm.length;
    }
    const ch = len === 1 ? text[i] : text.slice(i, i + 2);
    const piece = code < 128 ? ch.toLowerCase() : fold(ch);
    const isUpper = ch !== ch.toLowerCase();
    for (let k = 0; k < piece.length; k++) {
      starts.push(i);
      camel.push(k === 0 && prevLower && isUpper);
    }
    if (piece.length !== len) {
      identity = false;
    }
    prevLower = ch !== ch.toUpperCase();
    norm += piece;
    i += len;
  }
  if (base < 0) {
    base = norm.length;
  }
  const n = norm.length;
  const bonus = new Uint8Array(n);
  for (let j = 0; j < n; j++) {
    let b = 0;
    if (j === 0) {
      b = B_PATH_START;
    } else {
      const p = norm.charCodeAt(j - 1);
      if (isSlash(p)) {
        b = B_PATH_START;
      } else if (isSeparator(p)) {
        b = B_SEPARATOR;
      } else if (camel[j]) {
        b = B_CAMEL;
      }
    }
    bonus[j] = b + (j >= base ? BASENAME_CHAR : 0);
  }
  let map: Int32Array | null = null;
  if (!identity) {
    map = Int32Array.from(starts);
  }
  return { text, norm, map, base, bonus };
}

/** Split the query into folded, non-empty, space-separated pieces. */
export function parseQuery(query: string): string[] {
  const pieces: string[] = [];
  for (const raw of query.split(/\s+/)) {
    const piece = fold(raw);
    if (piece) {
      pieces.push(piece);
    }
  }
  return pieces;
}

// Grow-only scratch buffers: the inner loop never allocates.
let matrix = new Int32Array(1024);
let gaps = new Int32Array(256);

/**
 * Align one piece against the target. Returns NEG for no match. When `out` is
 * given (empty), fills it with the matched norm indexes (ascending).
 */
function align(q: string, t: Prepared, out: number[] | null): number {
  const norm = t.norm;
  const n = norm.length;
  const m = q.length;
  if (m === 0 || m > n) {
    return m === 0 ? 0 : NEG;
  }
  // Cheap subsequence prefilter (native indexOf), rejects most items.
  let at = -1;
  for (let i = 0; i < m; i++) {
    at = norm.indexOf(q[i], at + 1);
    if (at < 0) {
      return NEG;
    }
  }

  const bonus = t.bonus;
  const size = m * n;
  if (matrix.length < size) {
    matrix = new Int32Array(Math.max(size, matrix.length * 2));
  }
  if (gaps.length < n) {
    gaps = new Int32Array(Math.max(n, gaps.length * 2));
  }
  const M = matrix;
  const A = gaps;

  const c0 = q.charCodeAt(0);
  for (let j = 0; j < n; j++) {
    M[j] = norm.charCodeAt(j) === c0 ? MATCH + bonus[j] : NEG;
  }
  for (let i = 1; i < m; i++) {
    const prev = (i - 1) * n;
    const row = i * n;
    // A[j]: best prev-row score ending at k <= j, minus the gap cost to j.
    let run = NEG;
    let peak = NEG;
    for (let j = 0; j < n; j++) {
      const v = M[prev + j];
      run = run - GAP_EXTEND;
      if (v !== NEG) {
        if (v > peak) {
          peak = v;
        }
        if (v - GAP_OPEN > run) {
          run = v - GAP_OPEN;
        }
      }
      // max over k of (v - min(cost, GAP_MAX)) = max(affine, best raw - GAP_MAX)
      if (peak !== NEG && peak - GAP_MAX > run) {
        run = peak - GAP_MAX;
      }
      if (run < NEG) {
        run = NEG;
      }
      A[j] = run;
    }
    const c = q.charCodeAt(i);
    for (let j = 0; j < n; j++) {
      let best = NEG;
      if (norm.charCodeAt(j) === c && j >= i) {
        if (j >= 1 && M[prev + j - 1] !== NEG) {
          best = M[prev + j - 1] + CONSECUTIVE;
        }
        if (j >= 2 && A[j - 2] > best) {
          best = A[j - 2];
        }
        if (best !== NEG) {
          best += MATCH + bonus[j];
        }
      }
      M[row + j] = best;
    }
  }

  let score = NEG;
  let end = -1;
  const last = (m - 1) * n;
  for (let j = 0; j < n; j++) {
    if (M[last + j] > score) {
      score = M[last + j];
      end = j;
    }
  }
  if (score === NEG) {
    return NEG;
  }

  // Basename exact / prefix bonuses. The contiguous prefix alignment wins
  // ties so highlights show the file-name start.
  const base = t.base;
  let prefix = false;
  if (n - base >= m && norm.startsWith(q, base)) {
    let run = CONSECUTIVE * (m - 1);
    for (let i = 0; i < m; i++) {
      run += MATCH + bonus[base + i];
    }
    if (run >= score) {
      score = run;
      prefix = true;
    }
    score += n - base === m ? EXACT_BONUS : PREFIX_BONUS;
  }

  if (out) {
    if (prefix) {
      for (let i = 0; i < m; i++) {
        out.push(base + i);
      }
    } else {
      let j = end;
      for (let i = m - 1; i >= 0; i--) {
        out.push(j);
        if (i === 0) {
          break;
        }
        const prev = (i - 1) * n;
        let bestK = -1;
        let bestV = NEG;
        if (j >= 1 && M[prev + j - 1] !== NEG) {
          bestK = j - 1;
          bestV = M[prev + j - 1] + CONSECUTIVE;
        }
        for (let k = j - 2; k >= 0; k--) {
          const v = M[prev + k];
          if (v !== NEG) {
            const g =
              v - Math.min(GAP_OPEN + GAP_EXTEND * (j - 2 - k), GAP_MAX);
            if (g > bestV) {
              bestV = g;
              bestK = k;
            }
          }
        }
        j = bestK;
      }
      out.reverse();
    }
  }
  return score;
}

function toOriginal(t: Prepared, normPositions: number[]): number[] {
  const res: number[] = [];
  const map = t.map;
  const text = t.text;
  for (const j of normPositions) {
    const o = map ? map[j] : j;
    if (res.length === 0 || res[res.length - 1] < o) {
      res.push(o);
      const c = text.charCodeAt(o);
      if (c >= 0xd800 && c <= 0xdbff && o + 1 < text.length) {
        res.push(o + 1);
      }
    }
  }
  return res;
}

function scorePieces(pieces: readonly string[], t: Prepared): number {
  let total = 0;
  for (const piece of pieces) {
    const s = align(piece, t, null);
    if (s === NEG) {
      return NEG;
    }
    total += s;
  }
  return total;
}

function positionsFor(pieces: readonly string[], t: Prepared): number[] {
  const all: number[] = [];
  for (const piece of pieces) {
    const seg: number[] = [];
    align(piece, t, seg);
    all.push(...seg);
  }
  all.sort((a, b) => a - b);
  return toOriginal(t, all);
}

/** Score one target. Returns null when any query piece does not match. */
export function score(query: string, target: Prepared): ScoreResult | null {
  const pieces = parseQuery(query);
  const s = scorePieces(pieces, target);
  if (s === NEG) {
    return null;
  }
  return { score: s, positions: positionsFor(pieces, target) };
}

const before = (
  aScore: number,
  a: Prepared,
  bScore: number,
  b: Prepared,
): boolean => {
  if (aScore !== bScore) {
    return aScore > bScore;
  }
  if (a.text.length !== b.text.length) {
    return a.text.length < b.text.length;
  }
  return a.norm < b.norm;
};

/** Rank items, best first. Empty query returns the first `limit` items. */
export function filter<T>(
  items: readonly T[],
  query: string,
  get: (item: T) => Prepared,
  limit: number,
): Ranked<T>[] {
  const pieces = parseQuery(query);
  if (pieces.length === 0) {
    return items
      .slice(0, limit)
      .map((item) => ({ item, score: 0, positions: [] }));
  }
  if (limit <= 0) {
    return [];
  }
  const top: { item: T; score: number; p: Prepared }[] = [];
  for (const item of items) {
    const p = get(item);
    const s = scorePieces(pieces, p);
    if (s === NEG) {
      continue;
    }
    if (top.length === limit) {
      const worst = top[top.length - 1];
      if (!before(s, p, worst.score, worst.p)) {
        continue;
      }
      top.pop();
    }
    let at = top.length;
    while (at > 0 && before(s, p, top[at - 1].score, top[at - 1].p)) {
      at--;
    }
    top.splice(at, 0, { item, score: s, p });
  }
  return top.map(({ item, score: s, p }) => ({
    item,
    score: s,
    positions: positionsFor(pieces, p),
  }));
}
