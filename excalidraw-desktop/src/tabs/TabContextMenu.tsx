/**
 * Tabs: the tab context menu (WAI-ARIA menu). Reuses the app's `vault-menu`
 * styles. Items whose callback is absent are hidden; per-drawing items are
 * hidden for home tabs.
 */

import { useLayoutEffect, useRef } from "react";

import { getMenuItems, runMenuItem } from "../plugins/menuRegistry";

import type { TabId } from "./types";

export type TabMenuAction =
  | "close"
  | "closeOthers"
  | "closeRight"
  | "closeAll"
  | "pin"
  | "copyPath"
  | "reveal"
  | "newWindow";

export interface TabMenuHandlers {
  onClose?: (id: TabId) => void;
  onCloseOthers?: (id: TabId) => void;
  onCloseRight?: (id: TabId) => void;
  onCloseAll?: () => void;
  onTogglePin?: (id: TabId) => void;
  onCopyPath?: (id: TabId) => void;
  onReveal?: (id: TabId) => void;
}

export interface TabContextMenuProps extends TabMenuHandlers {
  tab: { id: TabId; path: string | null; pinned: boolean };
  x: number;
  y: number;
  /** `restoreFocus`: closed from the keyboard, focus goes back to the tab. */
  onDismiss: (restoreFocus: boolean) => void;
}

const MENU_WIDTH = 210;
const ITEM_HEIGHT = 28;

type Entry = {
  action: TabMenuAction | "sep" | `plugin:${number}`;
  label: string;
  run?: () => void;
};

export const buildEntries = ({
  tab,
  ...h
}: Omit<TabContextMenuProps, "x" | "y" | "onDismiss">): Entry[] => {
  const { id } = tab;
  const groups: (Entry | false)[][] = [
    [
      !!h.onClose && {
        action: "close",
        label: "Close",
        run: () => h.onClose!(id),
      },
      !!h.onCloseOthers && {
        action: "closeOthers",
        label: "Close others",
        run: () => h.onCloseOthers!(id),
      },
      !!h.onCloseRight && {
        action: "closeRight",
        label: "Close to the right",
        run: () => h.onCloseRight!(id),
      },
      !!h.onCloseAll && {
        action: "closeAll",
        label: "Close all",
        run: () => h.onCloseAll!(),
      },
    ],
    [
      !!h.onTogglePin && {
        action: "pin",
        label: tab.pinned ? "Unpin" : "Pin",
        run: () => h.onTogglePin!(id),
      },
      tab.path !== null &&
        !!h.onCopyPath && {
          action: "copyPath",
          label: "Copy path",
          run: () => h.onCopyPath!(id),
        },
      tab.path !== null &&
        !!h.onReveal && {
          action: "reveal",
          label: "Reveal in navigator",
          run: () => h.onReveal!(id),
        },
    ],
    [{ action: "newWindow", label: "Open in new window" }],
    // Items plugins declared (`[[contributes.menus]]`); none without plugins.
    getMenuItems("tab").map(
      (item, i): Entry => ({
        action: `plugin:${i}`,
        label: item.title,
        run: () => runMenuItem(item, { surface: "tab", path: tab.path }),
      }),
    ),
  ];
  const out: Entry[] = [];
  for (const g of groups) {
    const items = g.filter((e): e is Entry => !!e);
    if (items.length) {
      if (out.length) {
        out.push({ action: "sep", label: "" });
      }
      out.push(...items);
    }
  }
  return out;
};

export const TabContextMenu = ({
  x,
  y,
  onDismiss,
  ...rest
}: TabContextMenuProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const entries = buildEntries(rest);

  // Layout effect: focus and key listeners are in place before the first
  // paint, so a key pressed in the same frame as the menu opens is not lost.
  useLayoutEffect(() => {
    const menu = ref.current;
    const doc = menu?.ownerDocument;
    const win = doc?.defaultView;
    if (!menu || !doc || !win) {
      return;
    }
    const items = () =>
      Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    items()[0]?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!menu.contains(e.target as Node)) {
        onDismiss(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const list = items();
      const at = list.indexOf(doc.activeElement as HTMLElement);
      const go = (to: number) => {
        e.preventDefault();
        list[(to + list.length) % list.length]?.focus();
      };
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          return onDismiss(true);
        case "Tab":
          e.preventDefault();
          return onDismiss(true);
        case "ArrowDown":
          return go(at + 1);
        case "ArrowUp":
          return go(at < 0 ? -1 : at - 1);
        case "Home":
          return go(0);
        case "End":
          return go(-1);
      }
    };
    doc.addEventListener("pointerdown", onPointerDown, true);
    doc.addEventListener("keydown", onKeyDown, true);
    const dismiss = () => onDismiss(false);
    win.addEventListener("blur", dismiss);
    win.addEventListener("resize", dismiss);
    return () => {
      doc.removeEventListener("pointerdown", onPointerDown, true);
      doc.removeEventListener("keydown", onKeyDown, true);
      win.removeEventListener("blur", dismiss);
      win.removeEventListener("resize", dismiss);
    };
  }, [onDismiss]);

  const win = typeof window === "undefined" ? null : window;
  const height = entries.length * ITEM_HEIGHT + 12;
  const left = Math.max(
    8,
    Math.min(x, (win?.innerWidth ?? 1280) - MENU_WIDTH - 8),
  );
  const top = Math.max(8, Math.min(y, (win?.innerHeight ?? 800) - height - 8));

  return (
    <div
      ref={ref}
      className="vault-menu"
      role="menu"
      aria-label="Tab actions"
      data-testid="vault-tab-menu"
      style={{ left, top, width: MENU_WIDTH }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((entry, i) =>
        entry.action === "sep" ? (
          <div
            key={`sep${i}`}
            className="vault-menu__separator"
            role="separator"
          />
        ) : (
          <button
            key={entry.action}
            type="button"
            role="menuitem"
            className="vd-row vault-menu__item"
            data-testid={`vault-tab-menu-${entry.action}`}
            aria-disabled={entry.run ? undefined : true}
            title={entry.run ? undefined : "Coming later"}
            tabIndex={-1}
            onClick={() => {
              if (entry.run) {
                entry.run();
                onDismiss(false);
              }
            }}
          >
            <span>{entry.label}</span>
          </button>
        ),
      )}
    </div>
  );
};
