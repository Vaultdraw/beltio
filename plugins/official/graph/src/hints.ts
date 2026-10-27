/**
 * Vimium-style hint letters for the visible graph nodes. Labels come from the P1 link hint
 * generator (`assignLabels`: uniform length, prefix-free). Importance order = most links first,
 * so the busiest nodes get the first (shortest-to-type) labels.
 */
import type { CameraState } from "./renderer/types";

const DEFAULT_HINT_CHARS = "asdfghjkl";

/** Uniform-length, prefix-free labels (so a typed prefix is never an exact hit); the same rule as the editor's link hints. */
function assignLabels(count: number, hintChars: string): string[] {
  const chars = [...new Set(hintChars.toLowerCase())];
  if (chars.length === 0) {
    chars.push(...DEFAULT_HINT_CHARS);
  }
  const n = chars.length;
  let length = 1;
  while (n ** length < count && length < 4) {
    length++;
  }
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let label = "";
    let rest = i;
    for (let k = 0; k < length; k++) {
      label = chars[rest % n] + label;
      rest = Math.floor(rest / n);
    }
    out.push(label);
  }
  return out;
}

export const MAX_HINT_NODES = 400;

export interface HintView {
  positions: Float32Array;
  n: number;
  camera: CameraState;
  width: number;
  height: number;
  mask: Uint8Array | null;
  /** Links per node, for the importance order. */
  degree: (i: number) => number;
}

/** Visible, unmasked node ids, busiest first (ties by id), at most `max`. */
export function visibleHintNodes(v: HintView, max = MAX_HINT_NODES): number[] {
  const { positions: p, camera: c } = v;
  const hw = v.width / 2;
  const hh = v.height / 2;
  const ids: number[] = [];
  for (let i = 0; i < v.n; i++) {
    if (v.mask && v.mask[i]) {
      continue;
    }
    const x = (p[2 * i] - c.x) * c.scale + hw;
    const y = (p[2 * i + 1] - c.y) * c.scale + hh;
    if (x >= 0 && y >= 0 && x <= v.width && y <= v.height) {
      ids.push(i);
    }
  }
  if (ids.length > max) {
    ids.sort((a, b) => v.degree(b) - v.degree(a) || a - b);
    ids.length = max;
  } else {
    ids.sort((a, b) => v.degree(b) - v.degree(a) || a - b);
  }
  return ids;
}

/** `chars`^2 labels at most: hints stay 1-2 letters. */
export function hintCapacity(chars: string): number {
  const n = new Set(chars.toLowerCase()).size || 1;
  return Math.min(MAX_HINT_NODES, n * n);
}

export type HintMap = {
  /** node -> label */
  labels: Map<number, string>;
  /** label -> node */
  nodes: Map<string, number>;
};

export function assignNodeHints(
  ids: readonly number[],
  chars: string = DEFAULT_HINT_CHARS,
): HintMap {
  const cap = hintCapacity(chars);
  const used = ids.slice(0, cap);
  const names = assignLabels(used.length, chars);
  const labels = new Map<number, string>();
  const nodes = new Map<string, number>();
  used.forEach((id, k) => {
    labels.set(id, names[k]);
    nodes.set(names[k], id);
  });
  return { labels, nodes };
}

export type HintProgress =
  | { kind: "match"; node: number }
  | { kind: "partial" }
  | { kind: "none" };

/** What the typed letters mean: a full label, a prefix of some labels, or nothing. */
export function resolveHint(map: HintMap, typed: string): HintProgress {
  const t = typed.toLowerCase();
  const exact = map.nodes.get(t);
  if (exact !== undefined) {
    return { kind: "match", node: exact };
  }
  for (const label of map.nodes.keys()) {
    if (label.startsWith(t)) {
      return { kind: "partial" };
    }
  }
  return { kind: "none" };
}
