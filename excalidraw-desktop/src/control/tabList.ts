import { ControlError } from "./errors";
import { objectParams } from "./params";

import type { TabsState } from "../tabs/types";

export interface TabInfo {
  id: string;
  path: string | null;
  pinned: boolean;
  missing: boolean;
  active: boolean;
  dirty: boolean;
}
export interface TabListResult {
  tabs: TabInfo[];
  activeId: string | null;
}

/** The tab.list result. Non-active tabs are saved; only the active one can be dirty. */
export function tabListResult(
  state: TabsState | null,
  active: { path: string; dirty: boolean } | null,
): TabListResult {
  if (!state) {
    return active
      ? {
          tabs: [
            {
              id: "active",
              path: active.path,
              pinned: false,
              missing: false,
              active: true,
              dirty: active.dirty,
            },
          ],
          activeId: "active",
        }
      : { tabs: [], activeId: null };
  }
  return {
    tabs: state.tabs.map((t) => ({
      id: t.id,
      path: t.path,
      pinned: t.pinned,
      missing: t.missing,
      active: t.id === state.activeId,
      dirty: t.id === state.activeId && !!active?.dirty,
    })),
    activeId: state.activeId,
  };
}

/** Tab id from {id} | {index (1-based)} | {path}. */
export function resolveTabId(
  state: TabsState | null,
  params: unknown,
  allowIndex: boolean,
): string {
  if (!state) {
    throw new ControlError("NOT_FOUND", "Tabs are disabled");
  }
  const p = objectParams(params);
  let tab;
  if (typeof p.id === "string") {
    tab = state.tabs.find((t) => t.id === p.id);
  } else if (allowIndex && typeof p.index === "number") {
    tab = state.tabs[Math.trunc(p.index) - 1];
  } else if (typeof p.path === "string") {
    tab = state.tabs.find((t) => t.path === p.path);
  } else {
    throw new ControlError(
      "INVALID_PARAMS",
      allowIndex ? "id, index or path required" : "id or path required",
    );
  }
  if (!tab) {
    throw new ControlError("NOT_FOUND", "No such tab", { params: p });
  }
  return tab.id;
}
