import { useEffect, useRef } from "react";

import type { VaultRepository } from "../vault/types";

/**
 * Keeps the native file watcher in step with `files.auto_reload`. The native side already
 * read the key when the vault opened, so an "on" value at open needs no call; a change
 * (or an "off" value) is sent once. Turning it on makes the native side ask for a rescan.
 */
export function useAutoReload(
  repository: Pick<VaultRepository, "setWatching">,
  handle: string | null,
  enabled: boolean,
): void {
  const sent = useRef<{ handle: string; enabled: boolean } | null>(null);
  useEffect(() => {
    if (!handle) {
      sent.current = null;
      return;
    }
    const prev = sent.current;
    sent.current = { handle, enabled };
    if (prev?.handle === handle && prev.enabled === enabled) {
      return;
    }
    if (enabled && (!prev || prev.handle !== handle)) {
      return;
    }
    void repository.setWatching?.(handle, enabled).catch(() => {});
  }, [repository, handle, enabled]);
}
