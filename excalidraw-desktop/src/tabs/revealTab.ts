/**
 * Scroll the active tab into view. `scrollIntoView` forces a synchronous layout. On the
 * strip's first mount, which is the vault opening, that layout runs in the middle of the
 * first render of the whole window (11 ms of a 78 ms vault open on a 4x slower CPU), so the
 * first reveal waits for the next frame, when the browser has laid the page out for painting
 * anyway. Later reveals (the user switched tabs) stay synchronous.
 * Returns a cancel function for effect cleanup.
 */
export const revealTab = (
  el: HTMLElement | null,
  { deferred }: { deferred: boolean },
): (() => void) => {
  if (!el || typeof el.scrollIntoView !== "function") {
    return () => {};
  }
  const reveal = () =>
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  if (!deferred || typeof requestAnimationFrame !== "function") {
    reveal();
    return () => {};
  }
  const handle = requestAnimationFrame(() => {
    if (el.isConnected) {
      reveal();
    }
  });
  return () => cancelAnimationFrame(handle);
};
