/**
 * Runs `run` once, after the next frame or after `ms`, whichever comes first. A window on another
 * space, behind a full-screen app or minimised gets no frames, so work that must not wait for a
 * frame (registering the plugin command stubs) cannot rely on requestAnimationFrame alone.
 */
export function frameOrTimeout(
  win: Pick<Window, "requestAnimationFrame" | "setTimeout" | "clearTimeout">,
  run: () => void,
  ms = 1000,
): void {
  let done = false;
  const once = () => {
    if (done) {
      return;
    }
    done = true;
    win.clearTimeout(timer);
    run();
  };
  const timer = win.setTimeout(once, ms);
  win.requestAnimationFrame(once);
}
