/**
 * The interactive canvas is a full-window accelerated canvas (~17 MB at
 * 1280x850 @2x) that draws nothing most of the time: no selection, hover,
 * snap lines, collaborators, and so on. When renders keep drawing nothing for
 * `IDLE_SHRINK_MS` the backing store is shrunk to 1x1 (the CSS size, and with
 * it layout and pointer events, is untouched). Every render still runs while
 * shrunk: the first one that would draw restores the full size and renders
 * again within the same call, so nothing is ever lost or delayed.
 *
 * "Draws" is measured by temporarily counting calls to the painting methods
 * of the 2D context during one render. When in doubt the full store is kept:
 * the canvas is only shrunk after an observed empty render, and a canvas with
 * no known full size is never shrunk.
 */

export const IDLE_SHRINK_MS = 2000;

const PAINT_METHODS = [
  "fill",
  "stroke",
  "fillRect",
  "strokeRect",
  "drawImage",
  "fillText",
  "strokeText",
  "putImageData",
] as const;

type State = {
  timer: ReturnType<typeof setTimeout> | null;
  /** full backing size remembered while the canvas is shrunk */
  full: { width: number; height: number } | null;
  /**
   * The backing size the canvas last painted at. A canvas that has not
   * painted since it got its size (editor mount, window resize) is shrunk at
   * once instead of after `IDLE_SHRINK_MS`: it is not being interacted with,
   * and shrinking before the next composite means WebKit never makes display
   * buffers for an empty full-window canvas (up to 4 of them at mount).
   */
  paintedAt: string | null;
};

const states = new WeakMap<HTMLCanvasElement, State>();

const getState = (canvas: HTMLCanvasElement): State => {
  let state = states.get(canvas);
  if (!state) {
    state = { timer: null, full: null, paintedAt: null };
    states.set(canvas, state);
  }
  return state;
};

const isShrunk = (canvas: HTMLCanvasElement, state: State) =>
  state.full !== null && canvas.width === 1 && canvas.height === 1;

const clearTimer = (state: State) => {
  if (state.timer !== null) {
    clearTimeout(state.timer);
    state.timer = null;
  }
};

type PaintCounter = { paints: number };

const counters = new WeakMap<object, PaintCounter>();

/**
 * Installs counting wrappers on a context once; they stay for its lifetime,
 * so no property is added or removed per render (that would churn the
 * object's shape on the pointer-move path).
 */
const instrument = (context: Record<string, unknown>): PaintCounter => {
  const counter = counters.get(context);
  if (counter) {
    return counter;
  }
  const c: PaintCounter = { paints: 0 };
  const proto = Object.getPrototypeOf(context) as Record<string, unknown>;
  for (const name of PAINT_METHODS) {
    const original = proto[name] as
      | ((...args: unknown[]) => unknown)
      | undefined;
    if (typeof original === "function") {
      context[name] = function (this: unknown, ...args: unknown[]) {
        c.paints++;
        return original.apply(this, args);
      };
    }
  }
  counters.set(context, c);
  return c;
};

/** Runs `render` and returns the result and how many paint calls it made. */
const countPaints = <T>(
  canvas: HTMLCanvasElement,
  render: () => T,
): { result: T; paints: number } => {
  const context = canvas.getContext("2d") as unknown as Record<
    string,
    unknown
  > | null;
  if (!context) {
    // can't observe: assume it drew
    return { result: render(), paints: 1 };
  }
  const counter = instrument(context);
  counter.paints = 0;
  const result = render();
  return { result, paints: counter.paints };
};

const sizeKey = (canvas: HTMLCanvasElement) =>
  `${canvas.width}x${canvas.height}`;

const shrink = (canvas: HTMLCanvasElement, state: State) => {
  state.timer = null;
  // released (0x0) or already resized by React: nothing to do
  if (canvas.width <= 1 || canvas.height <= 1) {
    return;
  }
  state.full = { width: canvas.width, height: canvas.height };
  canvas.width = 1;
  canvas.height = 1;
};

/**
 * Wraps one interactive render. `render` must be safe to call twice (it is
 * re-run once, on the restored canvas, when a shrunk canvas needs to draw).
 */
export const renderWithIdleBackingStore = <T>(
  canvas: HTMLCanvasElement | null,
  render: () => T,
): T => {
  if (!canvas) {
    return render();
  }
  const state = getState(canvas);
  const shrunk = isShrunk(canvas, state);
  if (!shrunk) {
    // React (resize, zoom/scale, StrictMode restore) may have given the
    // canvas a new size since we shrank it
    state.full = null;
  }

  let { result, paints } = countPaints(canvas, render);

  if (paints > 0) {
    clearTimer(state);
    if (shrunk) {
      canvas.width = state.full!.width;
      canvas.height = state.full!.height;
      state.full = null;
      ({ result } = countPaints(canvas, render));
    }
    state.paintedAt = sizeKey(canvas);
  } else if (!shrunk && canvas.width > 1) {
    if (state.paintedAt !== sizeKey(canvas)) {
      clearTimer(state);
      shrink(canvas, state);
    } else if (state.timer === null) {
      state.timer = setTimeout(() => shrink(canvas, state), IDLE_SHRINK_MS);
    }
  }
  return result;
};

/** Stops the idle timer (editor unmount); the caller releases the store. */
export const cancelIdleBackingStore = (canvas: HTMLCanvasElement) => {
  const state = states.get(canvas);
  if (state) {
    clearTimer(state);
    state.full = null;
    state.paintedAt = null;
  }
};
