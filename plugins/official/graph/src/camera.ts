/**
 * Graph camera: `x, y` is the world point at the viewport centre, `scale` is CSS px per world
 * unit. Pure maths plus an optional 200 ms ease-out tween driven by the caller's frame loop
 * (`step(now)` returns true while animating, so rAF only runs during the animation).
 */
import type { CameraState } from "./renderer/types";

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Viewport {
  w: number;
  h: number;
}

export const FIT_MS = 200;
export const DEFAULT_MIN_SCALE = 0.005;
export const DEFAULT_MAX_SCALE = 8;
/** Zoom easing time constant (ms): frame-rate independent exponential smoothing. */
export const ZOOM_TAU_MS = 70;
/** The ease snaps to its target within this relative distance (0.1%). */
export const ZOOM_SNAP = 0.001;
/** Inertial pan friction time constant (ms). */
export const GLIDE_TAU_MS = 325;
/** The glide stops below this speed (px/ms). */
export const GLIDE_STOP = 0.02;
/** Release speed (px/ms) needed to start a glide. */
export const GLIDE_START = 0.3;
/** Longest frame step honoured (ms); a hidden tab must not teleport the camera. */
export const MAX_DT_MS = 64;
const FIRST_DT_MS = 1000 / 60;
/** Per-event wheel factor limits so one huge delta can never jump the view. */
export const WHEEL_MIN_FACTOR = 0.5;
export const WHEEL_MAX_FACTOR = 2;

/** d3-zoom style wheel gain: pinch (ctrl+wheel) is 10x a plain scroll; line mode is coarser. */
export function wheelZoomFactor(
  deltaY: number,
  deltaMode = 0,
  ctrlKey = false,
): number {
  const f = Math.pow(
    2,
    -deltaY * (deltaMode === 1 ? 0.05 : 0.002) * (ctrlKey ? 10 : 1),
  );
  return Math.min(WHEEL_MAX_FACTOR, Math.max(WHEEL_MIN_FACTOR, f));
}

export function easeOutCubic(t: number): number {
  const u = 1 - Math.min(1, Math.max(0, t));
  return 1 - u * u * u;
}

/** Bounding box of visible nodes of a Float32Array(2n); null when none. */
export function computeBounds(
  positions: Float32Array,
  n: number,
  mask?: Uint8Array | null,
): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    if (mask && mask[i]) {
      continue;
    }
    const x = positions[2 * i];
    const y = positions[2 * i + 1];
    if (x < minX) {
      minX = x;
    }
    if (x > maxX) {
      maxX = x;
    }
    if (y < minY) {
      minY = y;
    }
    if (y > maxY) {
      maxY = y;
    }
  }
  return minX > maxX ? null : { minX, minY, maxX, maxY };
}

/** Camera that shows `bounds` inside the viewport with `padding` CSS px on every side. */
export function fitCamera(
  bounds: Bounds,
  viewport: Viewport,
  padding = 40,
  maxScale = 2,
  minScale = DEFAULT_MIN_SCALE,
): CameraState {
  const bw = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const bh = Math.max(bounds.maxY - bounds.minY, 1e-6);
  const aw = Math.max(1, viewport.w - 2 * padding);
  const ah = Math.max(1, viewport.h - 2 * padding);
  const scale = Math.min(
    maxScale,
    Math.max(minScale, Math.min(aw / bw, ah / bh)),
  );
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    scale,
  };
}

export class Camera implements CameraState {
  x = 0;
  y = 0;
  scale = 1;
  minScale = DEFAULT_MIN_SCALE;
  maxScale = DEFAULT_MAX_SCALE;
  /** Optional world rect the centre is clamped into. */
  limits: Bounds | null = null;

  private w = 1;
  private h = 1;
  private from: CameraState = { x: 0, y: 0, scale: 1 };
  private to: CameraState = { x: 0, y: 0, scale: 1 };
  private t0 = 0;
  private dur = 0;
  private animating = false;
  /** Smooth zoom: eased towards `zoomTarget`, anchored on a world point under a screen point. */
  private zooming = false;
  private zoomTarget = 1;
  private anchor = { sx: 0, sy: 0, wx: 0, wy: 0 };
  /** Inertial pan velocity in screen px/ms. */
  private gliding = false;
  private vx = 0;
  private vy = 0;
  private lastT = 0;

  get viewport(): Viewport {
    return { w: this.w, h: this.h };
  }

  /** True during any tween, zoom ease or glide. */
  get isAnimating(): boolean {
    return this.animating || this.zooming || this.gliding;
  }

  /** Drops the zoom ease and the glide (new input, fit, set). */
  cancelMotion(): void {
    this.zooming = false;
    this.gliding = false;
    this.vx = this.vy = 0;
  }

  setViewport(w: number, h: number): void {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
  }

  set(state: CameraState): void {
    this.animating = false;
    this.cancelMotion();
    this.x = state.x;
    this.y = state.y;
    this.scale = state.scale;
    this.clamp();
  }

  /** World -> screen (CSS px relative to the canvas). */
  worldToScreen(
    wx: number,
    wy: number,
    out: { x: number; y: number } = { x: 0, y: 0 },
  ) {
    out.x = (wx - this.x) * this.scale + this.w / 2;
    out.y = (wy - this.y) * this.scale + this.h / 2;
    return out;
  }

  screenToWorld(
    sx: number,
    sy: number,
    out: { x: number; y: number } = { x: 0, y: 0 },
  ) {
    out.x = (sx - this.w / 2) / this.scale + this.x;
    out.y = (sy - this.h / 2) / this.scale + this.y;
    return out;
  }

  /** Pan by a screen-space delta (drag). */
  panBy(dxPx: number, dyPx: number): void {
    this.animating = false;
    this.gliding = false;
    this.x -= dxPx / this.scale;
    this.y -= dyPx / this.scale;
    this.clamp();
    if (this.zooming) {
      this.pinAnchor(this.anchor.sx, this.anchor.sy);
    }
  }

  private pinAnchor(sx: number, sy: number): void {
    const a = this.anchor;
    a.sx = sx;
    a.sy = sy;
    a.wx = (sx - this.w / 2) / this.scale + this.x;
    a.wy = (sy - this.h / 2) / this.scale + this.y;
  }

  /**
   * Smooth zoom: multiplies the (pending) target scale by `factor`, anchored under (sx, sy);
   * `step()` eases the scale there. Events mid-ease retarget and re-anchor.
   */
  zoomSmooth(sx: number, sy: number, factor: number): void {
    this.animating = false;
    this.gliding = false;
    const base = this.zooming ? this.zoomTarget : this.scale;
    this.zoomTarget = Math.min(
      this.maxScale,
      Math.max(this.minScale, base * factor),
    );
    this.pinAnchor(sx, sy);
    this.zooming = Math.abs(this.zoomTarget / this.scale - 1) > ZOOM_SNAP;
  }

  /** Starts an inertial pan glide from a release velocity (screen px/ms). */
  fling(vx: number, vy: number): void {
    if (Math.hypot(vx, vy) < GLIDE_START) {
      return;
    }
    this.animating = false;
    this.vx = vx;
    this.vy = vy;
    this.gliding = true;
  }

  /** Zoom by `factor` keeping the world point under (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    this.animating = false;
    this.cancelMotion();
    const next = Math.min(
      this.maxScale,
      Math.max(this.minScale, this.scale * factor),
    );
    const k = next / this.scale;
    // world point under the pointer stays: x' = wx - (sx - w/2)/next
    const wx = (sx - this.w / 2) / this.scale + this.x;
    const wy = (sy - this.h / 2) / this.scale + this.y;
    this.scale = next;
    this.x = wx - (sx - this.w / 2) / next;
    this.y = wy - (sy - this.h / 2) / next;
    if (k !== 1) {
      this.clamp();
    }
  }

  fit(
    bounds: Bounds,
    padding = 40,
    animate = true,
    now = performance.now(),
  ): void {
    const target = fitCamera(bounds, this.viewport, padding, 2, this.minScale);
    if (animate) {
      this.animateTo(target, now);
    } else {
      this.set(target);
    }
  }

  animateTo(target: CameraState, now: number, durationMs = FIT_MS): void {
    this.cancelMotion();
    this.from = { x: this.x, y: this.y, scale: this.scale };
    this.to = { ...target };
    this.t0 = now;
    this.dur = durationMs;
    this.animating = durationMs > 0;
    if (!this.animating) {
      this.set(target);
    }
  }

  /**
   * Advances the tween, zoom ease and glide. Returns true while another frame is needed.
   * The first frame uses a nominal 60 Hz step; dt is clamped to MAX_DT_MS.
   */
  step(now: number): boolean {
    if (!this.isAnimating) {
      this.lastT = 0;
      return false;
    }
    const dt = this.lastT
      ? Math.min(MAX_DT_MS, Math.max(0, now - this.lastT))
      : FIRST_DT_MS;
    this.lastT = now;
    if (this.animating) {
      this.stepTween(now);
    }
    if (this.zooming) {
      this.stepZoom(dt);
    }
    if (this.gliding) {
      this.stepGlide(dt);
    }
    if (!this.isAnimating) {
      this.lastT = 0;
      return false;
    }
    return true;
  }

  private stepTween(now: number): void {
    const t = (now - this.t0) / this.dur;
    if (t >= 1) {
      this.x = this.to.x;
      this.y = this.to.y;
      this.scale = this.to.scale;
      this.animating = false;
      return;
    }
    const e = easeOutCubic(t);
    this.x = this.from.x + (this.to.x - this.from.x) * e;
    this.y = this.from.y + (this.to.y - this.from.y) * e;
    // interpolate zoom geometrically so the motion feels linear in zoom
    this.scale = this.from.scale * Math.pow(this.to.scale / this.from.scale, e);
  }

  private stepZoom(dt: number): void {
    const k = 1 - Math.exp(-dt / ZOOM_TAU_MS);
    // ease geometrically so zoom-in and zoom-out feel symmetric
    let next = this.scale * Math.pow(this.zoomTarget / this.scale, k);
    if (Math.abs(this.zoomTarget / next - 1) <= ZOOM_SNAP) {
      next = this.zoomTarget;
      this.zooming = false;
    }
    const a = this.anchor;
    this.scale = next;
    this.x = a.wx - (a.sx - this.w / 2) / next;
    this.y = a.wy - (a.sy - this.h / 2) / next;
    this.clamp();
  }

  private stepGlide(dt: number): void {
    this.x -= (this.vx * dt) / this.scale;
    this.y -= (this.vy * dt) / this.scale;
    const decay = Math.exp(-dt / GLIDE_TAU_MS);
    this.vx *= decay;
    this.vy *= decay;
    this.clamp();
    if (Math.hypot(this.vx, this.vy) < GLIDE_STOP) {
      this.gliding = false;
      this.vx = this.vy = 0;
    }
  }

  private clamp(): void {
    this.scale = Math.min(this.maxScale, Math.max(this.minScale, this.scale));
    const l = this.limits;
    if (l) {
      this.x = Math.min(l.maxX, Math.max(l.minX, this.x));
      this.y = Math.min(l.maxY, Math.max(l.minY, this.y));
    }
  }
}
