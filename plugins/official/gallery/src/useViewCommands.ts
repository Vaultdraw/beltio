/**
 * The grid's commands. The plugin declares them in plugin.toml and `main.tsx` registers one
 * dispatcher per id; the mounted grid says what each does right now (`actions` may change
 * every render). An id with no action, or with no grid open, does nothing. Run from the
 * palette, the grid is focused first.
 */
import { useEffect, useRef, type RefObject } from "react";

export type ViewActions = Readonly<Record<string, (() => void) | undefined>>;

let bound: {
  ref: RefObject<HTMLElement | null>;
  actions: { current: ViewActions };
} | null = null;

/** What a command id does with the grid that is open now (nothing when none is). */
export function runGridCommand(id: string): void {
  if (!bound) {
    return;
  }
  const root = bound.ref.current;
  if (root && !root.contains(root.ownerDocument.activeElement)) {
    root.focus();
  }
  bound.actions.current[id]?.();
}

export function useViewCommands(
  ref: RefObject<HTMLElement | null>,
  actions: ViewActions,
): void {
  const live = useRef(actions);
  live.current = actions;
  useEffect(() => {
    const mine = { ref, actions: live };
    bound = mine;
    return () => {
      if (bound === mine) {
        bound = null;
      }
    };
  }, [ref]);
}
