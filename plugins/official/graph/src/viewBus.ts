/**
 * The open view's in-view commands. The plugin registers each `graph.*` view command once; this
 * bus hands the run to whatever the mounted GraphView offers right now (`actions` may change
 * every render). An id the view does not offer does nothing. Run from the palette, the view is
 * focused first (the palette holds focus), as the app's other views do.
 */
import { useEffect, useRef, type RefObject } from "react";

export type ViewActions = Readonly<Record<string, (() => void) | undefined>>;

let current: { root: HTMLElement | null; actions: () => ViewActions } | null =
  null;

/** Runs the view command `id` (a full id such as `graph.moveLeft`); true when the view had it. */
export function runViewCommand(id: string): boolean {
  const view = current;
  const run = view?.actions()[id];
  if (!view || !run) {
    return false;
  }
  const root = view.root;
  if (root && !root.contains(root.ownerDocument.activeElement)) {
    root.focus();
  }
  run();
  return true;
}

/** Offers `actions` as the view commands while the view is mounted. */
export function useViewCommands(
  ref: RefObject<HTMLElement | null>,
  actions: ViewActions,
): void {
  const live = useRef(actions);
  live.current = actions;
  useEffect(() => {
    const view = {
      get root() {
        return ref.current;
      },
      actions: () => live.current,
    };
    current = view;
    return () => {
      if (current === view) {
        current = null;
      }
    };
  }, [ref]);
}
