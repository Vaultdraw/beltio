import { useEffect, useState } from "react";

/** Longest wait for the root listing before the home pane mounts anyway. */
const FALLBACK_MS = 500;

/**
 * Whether the vault home pane may mount yet (`interface.defer_home_pane`).
 *
 * At vault open the home pane's first render and layout land in the same
 * frames as the file tree's. When deferred, the pane mounts one frame after the
 * tree's first paint: the root listing commits, the first animation frame paints
 * it, the second one releases the pane. A fallback timer covers a root listing
 * that never arrives. Once released for a vault it stays released, so closing a
 * drawing never defers it again; opening another vault does.
 */
export const useDeferredHome = (
  win: Window,
  vaultKey: string | null,
  rootListed: boolean,
  enabled: boolean,
): boolean => {
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const ready = !enabled || vaultKey === null || readyFor === vaultKey;

  useEffect(() => {
    if (ready || vaultKey === null) {
      return;
    }
    let raf = 0;
    const release = () => setReadyFor(vaultKey);
    const timer = win.setTimeout(release, FALLBACK_MS);
    if (rootListed) {
      raf = win.requestAnimationFrame(() => {
        raf = win.requestAnimationFrame(release);
      });
    }
    return () => {
      win.clearTimeout(timer);
      win.cancelAnimationFrame(raf);
    };
  }, [ready, vaultKey, rootListed, win]);

  return ready;
};
