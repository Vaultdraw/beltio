/**
 * Graph keyboard: the "nearest neighbour in this direction" selection behind
 * the graph.moveLeft/Right/Up/Down commands (keys: commands/graphCommands.ts).
 */
export type Direction = "left" | "right" | "up" | "down";

const VEC: Record<Direction, [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
};

/** Minimum cosine between the key direction and the move for a node to count as "that way". */
const CONE = 0.35;

function bestInCone(
  pos: Float32Array,
  from: number,
  dir: Direction,
  candidates: Iterable<number>,
  hidden: Uint8Array | null,
): number {
  const [ux, uy] = VEC[dir];
  const fx = pos[2 * from];
  const fy = pos[2 * from + 1];
  let best = -1;
  let bestScore = Infinity;
  for (const i of candidates) {
    if (i === from || (hidden && hidden[i])) {
      continue;
    }
    const dx = pos[2 * i] - fx;
    const dy = pos[2 * i + 1] - fy;
    const d = Math.hypot(dx, dy);
    const cos = d === 0 ? 1 : (dx * ux + dy * uy) / d;
    if (cos < CONE) {
      continue;
    }
    const score = d / cos; // off-axis nodes cost more
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function* range(n: number): Iterable<number> {
  for (let i = 0; i < n; i++) {
    yield i;
  }
}

/**
 * Next focus when pressing a direction key: the best neighbour of `from` in that direction, else
 * the best visible node in that direction, else the nearest visible node. -1 when nothing else
 * is visible. With no current focus (`from` < 0) the visible node nearest to the screen centre
 * (`centre`, world coordinates) wins.
 */
export function selectInDirection(
  pos: Float32Array,
  n: number,
  from: number,
  dir: Direction,
  neighbours: ArrayLike<number>,
  hidden: Uint8Array | null,
  centre: { x: number; y: number },
): number {
  if (from < 0) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      if (hidden && hidden[i]) {
        continue;
      }
      const d = Math.hypot(pos[2 * i] - centre.x, pos[2 * i + 1] - centre.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }
  const viaNeighbour = bestInCone(
    pos,
    from,
    dir,
    Array.from(neighbours),
    hidden,
  );
  if (viaNeighbour >= 0) {
    return viaNeighbour;
  }
  const viaCone = bestInCone(pos, from, dir, range(n), hidden);
  if (viaCone >= 0) {
    return viaCone;
  }
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < n; i++) {
    if (i === from || (hidden && hidden[i])) {
      continue;
    }
    const d = Math.hypot(
      pos[2 * i] - pos[2 * from],
      pos[2 * i + 1] - pos[2 * from + 1],
    );
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
