import { useEffect, useRef } from "react";

import { installPointerPrefetch } from "./pointerPrefetch";

import type { VaultRepository } from "../vault/types";

/**
 * Installs the pointer-down prefetch while `enabled` (`files.speculative_open`);
 * turning it off removes the listener and drops the held entry at once.
 */
export function useSpeculativeOpen(
  doc: Document | null | undefined,
  enabled: boolean,
  repository: Pick<VaultRepository, "readDrawing">,
  handle: string | null,
  activePath: string | null,
): void {
  const live = useRef({ repository, handle, activePath });
  live.current = { repository, handle, activePath };
  useEffect(() => {
    if (!doc || !enabled) {
      return;
    }
    return installPointerPrefetch(doc, {
      handle: () => live.current.handle,
      activePath: () => live.current.activePath,
      read: (h, p) => live.current.repository.readDrawing(h, p),
    });
  }, [doc, enabled]);
}
