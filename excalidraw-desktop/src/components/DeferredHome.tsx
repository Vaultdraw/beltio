import { useEffect, useState } from "react";

import type { MutableRefObject, ReactNode } from "react";

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
  /**
   * The vault whose pane was already released, owned by the parent so it
   * survives this wrapper unmounting while a drawing is open.
   */
  releasedRef: MutableRefObject<string | null>;
  children: ReactNode;
};

/**
 * Mounts the vault home pane one frame after the file tree's first paint
 * (`interface.defer_home_pane`).
 *
 * At vault open the pane's first render and layout land in the same frames as
 * the tree's. Deferred, the root listing commits, the first animation frame
 * paints the tree, the second releases the pane; a fallback timer covers a
 * listing that never arrives. Once released (or shown with the key off) for a
 * vault it stays released: closing a drawing or turning the key on later never
 * hides it again. The state lives here, not in VaultApp, so the release
 * re-renders only this wrapper. Until then an empty box with VaultHome's root
 * classes holds its place, so nothing shifts (checked by
 * e2e/homePaneDefer.spec.ts).
 */
export const DeferredHome = ({
  win,
  vaultKey,
  rootListed,
  enabled,
  releasedRef,
  children,
}: Props) => {
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const ready =
    !enabled || readyFor === vaultKey || releasedRef.current === vaultKey;
  if (ready) {
    // A ref write, no render: remembers the pane for this vault.
    releasedRef.current = vaultKey;
  }

  // Fallback: started once per vault, not restarted when the listing lands.
  useEffect(() => {
    if (ready) {
      return;
    }
    const timer = win.setTimeout(() => setReadyFor(vaultKey), FALLBACK_MS);
    return () => win.clearTimeout(timer);
  }, [ready, vaultKey, win]);

  useEffect(() => {
    if (ready || !rootListed) {
      return;
    }
    let raf = win.requestAnimationFrame(() => {
      raf = win.requestAnimationFrame(() => setReadyFor(vaultKey));
    });
    return () => win.cancelAnimationFrame(raf);
  }, [ready, rootListed, vaultKey, win]);

  return ready ? (
    <>{children}</>
  ) : (
    <div className="vault-empty-state vault-home" />
  );
};
