/**
 * Register a panel's list as a `list.*` command target (see listNav.ts) while
 * `actions` is non-null and `ref` is mounted. `actions` may change every
 * render: the controller reads the latest object, and an action that is
 * missing (or undefined) now is not offered, so its key passes through.
 */
import { useEffect, useRef, type RefObject } from "react";

import { LIST_ACTIONS, registerList, type ListController } from "./listNav";

export function useListKeys(
  ref: RefObject<HTMLElement | null>,
  name: string,
  actions: ListController | null,
): void {
  const live = useRef(actions);
  live.current = actions;
  const enabled = actions !== null;
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) {
      return;
    }
    const controller: ListController = {};
    for (const action of LIST_ACTIONS) {
      Object.defineProperty(controller, action, {
        enumerable: true,
        get: () =>
          live.current?.[action] ? () => live.current?.[action]?.() : undefined,
      });
    }
    return registerList(el, name, controller);
  }, [ref, name, enabled]);
}
