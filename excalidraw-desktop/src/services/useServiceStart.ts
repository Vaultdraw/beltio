/**
 * Starts one vault service per its `StartMode` (D8) and reports whether it
 * has started for the current vault. "open" starts at once, "idle" through
 * `whenIdle`, "use" only when `activate()` is called (the native side also
 * starts a pending service on the first query that needs it). A started
 * service stays started until the vault changes; switching the mode to an
 * earlier one starts it now.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { whenIdle } from "./whenIdle";

import type { StartMode } from "./servicesSettings";

export interface ServiceStart {
  /** The service runs (or was asked to start) for this vault. */
  started: boolean;
  /** Start now if not started (the "use" trigger). */
  activate: () => void;
}

export function useServiceStart(
  win: Window | null | undefined,
  handle: string | null,
  mode: StartMode,
  start?: (handle: string) => Promise<void> | void,
): ServiceStart {
  const [startedFor, setStartedFor] = useState<string | null>(null);
  const startedRef = useRef<string | null>(null);
  const startRef = useRef(start);
  startRef.current = start;
  const handleRef = useRef(handle);
  handleRef.current = handle;

  const activate = useCallback(() => {
    const h = handleRef.current;
    if (!h || startedRef.current === h) {
      return;
    }
    startedRef.current = h;
    setStartedFor(h);
    try {
      void Promise.resolve(startRef.current?.(h)).catch(() => {});
    } catch {
      // A failed start leaves the native lazy start on first use.
    }
  }, []);

  useEffect(() => {
    if (!handle || startedRef.current === handle) {
      return undefined;
    }
    if (mode === "open") {
      activate();
      return undefined;
    }
    if (mode === "idle" && win) {
      return whenIdle(win, activate);
    }
    return undefined;
  }, [win, handle, mode, activate]);

  return {
    // "open" counts as started from the first render, so its consumers do
    // not wait an extra effect pass.
    started: !!handle && (startedFor === handle || mode === "open"),
    activate,
  };
}
