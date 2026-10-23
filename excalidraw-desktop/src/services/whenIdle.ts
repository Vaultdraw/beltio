/**
 * Runs `run` once the app is idle after a vault opens, like lazy.nvim's
 * `VeryLazy` or VS Code's `onStartupFinished`: after the first paint (two
 * animation frames), once key/pointer input has been quiet for `quietMs`,
 * then in an idle callback where the engine has one (WebKit has none). A
 * `deadlineMs` cap keeps the service ready within seconds even while the user
 * keeps working. Returns a cancel function.
 */
export interface IdleOptions {
  quietMs?: number;
  deadlineMs?: number;
}

export const IDLE_QUIET_MS = 1000;
export const IDLE_DEADLINE_MS = 5000;

const INPUT_EVENTS = ["keydown", "pointerdown", "wheel"] as const;

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

export function whenIdle(
  win: Window,
  run: () => void,
  { quietMs = IDLE_QUIET_MS, deadlineMs = IDLE_DEADLINE_MS }: IdleOptions = {},
): () => void {
  const w = win as IdleWindow;
  const start = Date.now();
  let lastInput = start;
  let done = false;
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let idleId: number | undefined;

  const onInput = () => {
    lastInput = Date.now();
  };
  const cleanup = () => {
    done = true;
    for (const type of INPUT_EVENTS) {
      win.removeEventListener(type, onInput, true);
    }
    if (frame) {
      win.cancelAnimationFrame?.(frame);
    }
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    if (idleId !== undefined) {
      w.cancelIdleCallback?.(idleId);
    }
  };
  const fire = () => {
    if (!done) {
      cleanup();
      run();
    }
  };
  const afterQuiet = () => {
    if (done) {
      return;
    }
    const now = Date.now();
    const left = start + deadlineMs - now;
    if (left <= 0) {
      fire();
      return;
    }
    const quietFor = now - lastInput;
    if (quietFor < quietMs) {
      timer = setTimeout(afterQuiet, Math.min(quietMs - quietFor, left));
      return;
    }
    if (typeof w.requestIdleCallback === "function") {
      idleId = w.requestIdleCallback(fire, { timeout: Math.max(1, left) });
    } else {
      fire();
    }
  };

  for (const type of INPUT_EVENTS) {
    win.addEventListener(type, onInput, { capture: true, passive: true });
  }
  const afterPaint = () => {
    // The quiet window counts from the first paint.
    lastInput = Math.max(lastInput, Date.now());
    afterQuiet();
  };
  if (typeof win.requestAnimationFrame === "function") {
    frame = win.requestAnimationFrame(() => {
      frame = win.requestAnimationFrame(() => {
        frame = 0;
        afterPaint();
      });
    });
  } else {
    afterPaint();
  }
  return cleanup;
}
