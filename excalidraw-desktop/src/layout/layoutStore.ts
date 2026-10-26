/**
 * Session layout state of this window: the active preset and the parts
 * toggled by hand while it is active. Not saved: `layout.preset` in
 * config.toml says which preset a window starts with.
 */
import type { LayoutPart, LayoutPreset } from "./layoutSettings";

export interface LayoutState {
  /** Active preset name, or null for the base layout. */
  preset: string | null;
  /** Parts toggled by hand while a preset governs them. */
  session: LayoutPreset;
}

const EMPTY: LayoutPreset = Object.freeze({});
let state: LayoutState = { preset: null, session: EMPTY };
const listeners = new Set<() => void>();

const set = (next: LayoutState) => {
  state = next;
  listeners.forEach((l) => l());
};

export const getLayoutState = (): LayoutState => state;

export function subscribeLayout(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Switch to `preset` (null = base layout); hand toggles are dropped. */
export function setActivePreset(preset: string | null): void {
  if (preset !== state.preset || state.session !== EMPTY) {
    set({ preset, session: EMPTY });
  }
}

/** The preset's command: on, or back to the base layout when it is on. */
export function togglePreset(preset: string): void {
  setActivePreset(state.preset === preset ? null : preset);
}

/** Show or hide `part` for this session only. */
export function setSessionPart(part: LayoutPart, shown: boolean): void {
  set({ ...state, session: { ...state.session, [part]: shown } });
}

/** Tests only. */
export function resetLayoutState(): void {
  state = { preset: null, session: EMPTY };
}
