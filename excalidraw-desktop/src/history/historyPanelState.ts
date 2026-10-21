/**
 * Whether the History panel is showing, published by HistoryHost so entry
 * points outside it (the header button, "History" in a row menu) can show a
 * pressed state or avoid toggling an open panel shut. One boolean; listeners
 * run only when it flips.
 */
import {
  isPanelOpen,
  panelFlag,
  subscribePanel,
  usePanelOpen,
} from "../slots/panelStore";

export const HISTORY_PANEL_ID = "history";

export const publishHistoryPanelOpen = (value: boolean): void =>
  panelFlag(HISTORY_PANEL_ID).publish(value);

const focusListeners = new Set<() => void>();

/** Asks an already open panel to take keyboard focus (row menu "History"). */
export const requestHistoryPanelFocus = (): void =>
  focusListeners.forEach((l) => l());

/** The open panel registers here; returns the unsubscribe. */
export const onHistoryPanelFocusRequest = (cb: () => void) => {
  focusListeners.add(cb);
  return () => {
    focusListeners.delete(cb);
  };
};

export const isHistoryPanelOpen = (): boolean => isPanelOpen(HISTORY_PANEL_ID);

export const subscribeHistoryPanelOpen = (cb: () => void) =>
  subscribePanel(HISTORY_PANEL_ID, cb);

export const useHistoryPanelOpen = (): boolean =>
  usePanelOpen(HISTORY_PANEL_ID);
