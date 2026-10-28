/**
 * The plugin overlay: one view that covers the drawing area (`ctx.overlays.open`).
 * A tiny store with no imports, so the shell can ask "is one open?" without loading
 * the plugin host (startupGraph.test.ts). Only one overlay is open at a time.
 */
import type { ComponentType } from "react";

export interface OverlayEntry {
  pluginId: string;
  Component: ComponentType<{ close(): void }>;
  onClose?: () => void;
  /** A dialog: the drawing stays usable behind it (no cover). */
  modal?: boolean;
}

let current: OverlayEntry | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const getOverlay = (): OverlayEntry | null => current;
export const hasOverlay = (): boolean => current !== null;
/** An overlay that covers the drawing area (not a modal dialog). */
export const hasCoveringOverlay = (): boolean =>
  current !== null && !current.modal;

export const subscribeOverlay = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

const runClose = (entry: OverlayEntry) => {
  try {
    entry.onClose?.();
  } catch {
    // a plugin's onClose must not break the shell
  }
};

/**
 * A covering view that gave way to a file the user opened. Back brings it
 * back (`reopenYielded`). Its onClose waits: it runs once, when the view is
 * finally left behind (forgotten) or closed for good.
 */
let yielded: OverlayEntry | null = null;

const forgetYielded = () => {
  const old = yielded;
  yielded = null;
  if (old) {
    runClose(old);
  }
};

/** Closes the open overlay (if it is `entry`, or any when omitted); runs its onClose once. */
export function closeOverlay(entry?: OverlayEntry): void {
  if (entry && entry === yielded) {
    forgetYielded(); // the plugin closed (or stopped) its dismissed view
    return;
  }
  const open = current;
  if (!open || (entry && open !== entry)) {
    return;
  }
  current = null;
  emit();
  runClose(open);
}

/** Shows `entry`, closing the previous overlay first. */
export function showOverlay(entry: OverlayEntry): void {
  closeOverlay();
  forgetYielded();
  current = entry;
  emit();
}

/**
 * The user opened a file (explorer, tab, palette, search, link, CLI): a covering
 * view gives way to it and is remembered for Back. Called once per navigation by
 * the tab host; with no view open it forgets an older one, so Back only returns
 * to a view the latest navigation dismissed.
 */
export function yieldOverlay(): void {
  const open = current;
  if (!open) {
    forgetYielded();
    return;
  }
  forgetYielded();
  if (open.modal) {
    closeOverlay(open);
    return;
  }
  current = null;
  emit();
  yielded = open;
}

/** Back after a view gave way: shows it again. False when there is nothing to bring back. */
export function reopenYielded(): boolean {
  const entry = yielded;
  if (!entry) {
    return false;
  }
  yielded = null;
  closeOverlay();
  current = entry;
  emit();
  return true;
}
