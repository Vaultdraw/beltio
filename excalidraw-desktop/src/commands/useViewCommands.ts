/**
 * Bind a view's commands (gallery grid, graph view) while it is mounted.
 * `actions` may change every render; an id whose action is missing (or
 * undefined) right now is not offered, so its key passes through. Run from
 * the palette, the view is focused first (the palette holds focus).
 *
 * The view root carries `data-keyscope` (see context.ts), which is what the
 * commands' `when` (`galleryFocus`, `graphFocus`) checks.
 */
import { useEffect, useRef, type RefObject } from "react";

import { registerCommandHandlers } from "./handlerRegistry";

import type { CommandHandlers } from "./types";

export type ViewActions = Readonly<Record<string, (() => void) | undefined>>;

export function useViewCommands(
  ref: RefObject<HTMLElement | null>,
  ids: readonly string[],
  actions: ViewActions,
): void {
  const live = useRef(actions);
  live.current = actions;
  useEffect(() => {
    const layer: CommandHandlers = {};
    for (const id of ids) {
      const run = () => {
        const root = ref.current;
        if (root && !root.contains(root.ownerDocument.activeElement)) {
          root.focus();
        }
        live.current[id]?.();
      };
      Object.defineProperty(layer, id, {
        enumerable: true,
        get: () => (live.current[id] ? run : undefined),
      });
    }
    return registerCommandHandlers(layer);
  }, [ref, ids]);
}
