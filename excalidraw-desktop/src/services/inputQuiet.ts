/**
 * Background work in the webview yields to the user: `waitForInputQuiet`
 * resolves once key, pointer, wheel and click input has been quiet for
 * `quietMs` (at once when it already is), or after `maxMs` at the latest, so
 * the work still finishes while the user keeps working. Listeners are
 * installed once per window, on first use (zero cost until then).
 */
export const INPUT_EVENTS = [
  "keydown",
  "pointerdown",
  "wheel",
  "click",
] as const;

const lastInput = new WeakMap<Window, number>();

function track(win: Window): void {
  if (lastInput.has(win)) {
    return;
  }
  lastInput.set(win, 0);
  const onInput = () => {
    lastInput.set(win, Date.now());
  };
  for (const type of INPUT_EVENTS) {
    win.addEventListener(type, onInput, { capture: true, passive: true });
  }
}

/** Milliseconds since the last input (Infinity if none since tracking began). */
export function sinceInput(win: Window): number {
  track(win);
  const last = lastInput.get(win) ?? 0;
  return last === 0 ? Infinity : Date.now() - last;
}

export function waitForInputQuiet(
  win: Window,
  quietMs = 150,
  maxMs = 1000,
): Promise<void> {
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      const quiet = sinceInput(win);
      const left = start + maxMs - Date.now();
      if (quiet >= quietMs || left <= 0) {
        resolve();
        return;
      }
      setTimeout(check, Math.min(quietMs - quiet, left));
    };
    check();
  });
}
