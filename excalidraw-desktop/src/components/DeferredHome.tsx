import { useEffect, useState } from "react";

import type { ReactNode } from "react";

/** Longest wait for the root listing before the home pane mounts anyway. */
const FALLBACK_MS = 500;

type Props = {
  win: Window;
  /** The open vault's handle; a new vault defers again. */
  vaultKey: string;
  /** True once the root folder listing is in the tree. */
  rootListed: boolean;
  /** `interface.defer_home_pane`. */
  enabled: boolean;
  children: ReactNode;
};

/**
 * Mounts the vault home pane one frame after the file tree's first paint
 * (`interface.defer_home_pane`).
 *
 * At vault open the pane's first render and layout land in the same frames as
 * the tree's. Deferred, the root listing commits, the first animation frame
 * paints the tree, the second releases the pane. A fallback timer covers a
 * listing that never arrives. Once released for a vault it stays released, so
 * closing a drawing never defers it again. The state lives here, not in
 * VaultApp, so the release re-renders only this wrapper. Until then an empty
 * box with the pane's classes holds its place: nothing shifts.
 */
export const DeferredHome = ({
  win,
  vaultKey,
  rootListed,
  enabled,
  children,
}: Props) => {
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const ready = !enabled || readyFor === vaultKey;

  useEffect(() => {
    if (ready) {
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

  return ready ? (
    <>{children}</>
  ) : (
    <div className="vault-empty-state vault-home" />
  );
};
