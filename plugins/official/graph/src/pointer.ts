/**
 * Pointer and wheel input for the graph stage: hover pick, click-to-open, node drag, background
 * pan and wheel zoom. Listeners exist only while the graph is open (the returned function
 * removes them).
 */
import { GLIDE_START, wheelZoomFactor } from "./camera";

import type { OpenTarget } from "./settings";

import type { GraphSession } from "./GraphSession";

/** Cmd/Ctrl+click opens in a new tab; a plain click uses the current one. */
const clickTarget = (e: {
  metaKey: boolean;
  ctrlKey: boolean;
}): OpenTarget | undefined => (e.metaKey || e.ctrlKey ? "new" : undefined);

const CLICK_SLOP = 4;
/** Velocity window (ms) and max age of the last move for a release to glide. */
const VELOCITY_WINDOW_MS = 80;
const STALE_MOVE_MS = 50;

export interface Sample {
  x: number;
  y: number;
  t: number;
}

/** Release velocity (px/ms) from samples in the last 80 ms; zero when stale or too slow. */
export function releaseVelocity(
  samples: Sample[],
  releaseT: number,
): { vx: number; vy: number } {
  const last = samples[samples.length - 1];
  if (!last || releaseT - last.t > STALE_MOVE_MS) {
    return { vx: 0, vy: 0 };
  }
  let first = last;
  for (let i = samples.length - 2; i >= 0; i--) {
    if (last.t - samples[i].t > VELOCITY_WINDOW_MS) {
      break;
    }
    first = samples[i];
  }
  const dt = last.t - first.t;
  if (dt <= 0) {
    return { vx: 0, vy: 0 };
  }
  const vx = (last.x - first.x) / dt;
  const vy = (last.y - first.y) / dt;
  return Math.hypot(vx, vy) < GLIDE_START ? { vx: 0, vy: 0 } : { vx, vy };
}

export function bindPointer(
  el: HTMLElement,
  session: GraphSession,
  onInteract: () => void,
): () => void {
  let down: {
    x: number;
    y: number;
    node: number;
    id: number;
    button: number;
  } | null = null;
  let moved = false;
  let lastX = 0;
  let lastY = 0;
  let samples: Sample[] = [];

  const local = (e: PointerEvent | WheelEvent) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: PointerEvent) => {
    // Left button, or the middle button on a node (opens in a new tab).
    if (e.button !== 0 && e.button !== 1) {
      return;
    }
    const p = local(e);
    if (e.button === 1 && session.pickScreen(p.x, p.y) < 0) {
      return;
    }
    onInteract();
    session.stopMotion();
    samples = [{ x: p.x, y: p.y, t: e.timeStamp }];
    down = {
      x: p.x,
      y: p.y,
      node: session.pickScreen(p.x, p.y),
      id: e.pointerId,
      button: e.button,
    };
    moved = false;
    lastX = p.x;
    lastY = p.y;
    el.setPointerCapture?.(e.pointerId);
  };

  const onMove = (e: PointerEvent) => {
    const p = local(e);
    if (!down) {
      session.hoverAt(p.x, p.y);
      return;
    }
    if (!moved && Math.hypot(p.x - down.x, p.y - down.y) < CLICK_SLOP) {
      return;
    }
    if (!moved) {
      moved = true;
      if (down.node >= 0) {
        session.beginDrag(down.node);
        session.hoverAt(p.x, p.y);
      }
    }
    if (down.node >= 0) {
      session.dragTo(p.x, p.y);
    } else {
      session.panBy(p.x - lastX, p.y - lastY);
      samples.push({ x: p.x, y: p.y, t: e.timeStamp });
      if (samples.length > 32) {
        samples.shift();
      }
    }
    lastX = p.x;
    lastY = p.y;
  };

  const onUp = (e: PointerEvent) => {
    if (!down) {
      return;
    }
    const d = down;
    down = null;
    el.releasePointerCapture?.(d.id);
    if (moved) {
      session.endDrag();
      if (d.node < 0 && e.type === "pointerup") {
        const v = releaseVelocity(samples, e.timeStamp);
        if (v.vx || v.vy) {
          session.fling(v.vx, v.vy);
        }
      }
    } else if (d.node >= 0) {
      session.activate(d.node, d.button === 1 ? "new" : clickTarget(e));
    }
    const p = local(e);
    session.hoverAt(p.x, p.y);
  };

  const onLeave = () => {
    if (!down) {
      session.hoverLeave();
    }
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    onInteract();
    const p = local(e);
    session.zoomSmooth(
      p.x,
      p.y,
      wheelZoomFactor(e.deltaY, e.deltaMode, e.ctrlKey),
    );
  };

  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
  el.addEventListener("pointerleave", onLeave);
  el.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    el.removeEventListener("pointerdown", onDown);
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onUp);
    el.removeEventListener("pointerleave", onLeave);
    el.removeEventListener("wheel", onWheel);
  };
}
