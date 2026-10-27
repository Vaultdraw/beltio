/** Arrowheads for the "arrows" display setting, drawn on the 2D overlay (the GPU edges are hairlines). */
import type { CameraState } from "./renderer/types";

export const MAX_ARROWS = 4000;

export interface ArrowFrame {
  edges: Uint32Array;
  positions: Float32Array;
  radius: Float32Array;
  camera: CameraState;
  width: number;
  height: number;
  mask: Uint8Array | null;
}

/** Draws at most `MAX_ARROWS` heads for edges with an endpoint on screen. Returns the count. */
export function drawArrows(
  ctx: CanvasRenderingContext2D,
  f: ArrowFrame,
  colour: string,
): number {
  const { edges: e, positions: p, camera: c, mask } = f;
  const hw = f.width / 2;
  const hh = f.height / 2;
  const zf = Math.min(2.5, Math.max(0.6, Math.sqrt(c.scale)));
  ctx.fillStyle = colour;
  ctx.beginPath();
  let drawn = 0;
  for (let k = 0; k < e.length && drawn < MAX_ARROWS; k += 2) {
    const a = e[k];
    const b = e[k + 1];
    if (mask && (mask[a] || mask[b])) {
      continue;
    }
    const ax = (p[2 * a] - c.x) * c.scale + hw;
    const ay = (p[2 * a + 1] - c.y) * c.scale + hh;
    const bx = (p[2 * b] - c.x) * c.scale + hw;
    const by = (p[2 * b + 1] - c.y) * c.scale + hh;
    if (
      (bx < 0 || by < 0 || bx > f.width || by > f.height) &&
      (ax < 0 || ay < 0 || ax > f.width || ay > f.height)
    ) {
      continue;
    }
    const dx = bx - ax;
    const dy = by - ay;
    const d = Math.hypot(dx, dy);
    const r = f.radius[b] * zf + 2;
    if (d < r + 6) {
      continue;
    }
    const ux = dx / d;
    const uy = dy / d;
    const tx = bx - ux * r;
    const ty = by - uy * r;
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - ux * 7 - uy * 3, ty - uy * 7 + ux * 3);
    ctx.lineTo(tx - ux * 7 + uy * 3, ty - uy * 7 - ux * 3);
    ctx.closePath();
    drawn++;
  }
  ctx.fill();
  return drawn;
}
