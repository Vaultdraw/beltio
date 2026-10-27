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
}

let current: OverlayEntry | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const getOverlay = (): OverlayEntry | null => current;
export const hasOverlay = (): boolean => current !== null;

export const subscribeOverlay = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Closes the open overlay (if it is `entry`, or any when omitted); runs its onClose once. */
export function closeOverlay(entry?: OverlayEntry): void {
  const open = current;
  if (!open || (entry && open !== entry)) {
    return;
  }
  current = null;
  emit();
  try {
    open.onClose?.();
  } catch {
    // a plugin's onClose must not break the shell
  }
}

/** Shows `entry`, closing the previous overlay first. */
export function showOverlay(entry: OverlayEntry): void {
  closeOverlay();
  current = entry;
  emit();
}
