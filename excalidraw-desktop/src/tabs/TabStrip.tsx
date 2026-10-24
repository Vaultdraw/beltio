/**
 * Tabs (F5): the tab strip (PLAN.md §3). Subscribes to the tab store only, so
 * canvas edits and view changes never re-render it. WAI-ARIA tabs pattern with
 * manual activation (arrows move focus, Enter/Space activate).
 */

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  IconAlert,
  IconChevronDown,
  IconClose,
  IconDrawing,
  IconPlus,
} from "../components/Icons";

import { TabContextMenu } from "./TabContextMenu";
import { TabListPopover } from "./TabListPopover";
import { revealTab } from "./revealTab";
import { tabLabels } from "./tabLabels";
import { useActiveTab, useTabList } from "./tabStore";
import { useStripDrag } from "./useStripDrag";

import "./TabStrip.css";

import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import type { StripSignals } from "./stripSignals";
import type { TabStore } from "./tabStore";
import type { Tab, TabId } from "./types";

export type TabStripStatus = "saved" | "dirty" | "conflict" | "error";

export interface TabStripProps {
  store: TabStore;
  onActivate: (id: TabId) => void;
  onClose: (id: TabId) => void;
  onNewTab: () => void;
  /** Save state of the active tab (background tabs are always saved). */
  activeStatus?: TabStripStatus;
  onTogglePin?: (id: TabId) => void;
  onMove?: (id: TabId, toIndex: number) => void;
  onCloseOthers?: (id: TabId) => void;
  onCloseRight?: (id: TabId) => void;
  onCloseAll?: () => void;
  onCopyPath?: (id: TabId) => void;
  onReveal?: (id: TabId) => void;
  signals?: StripSignals;
}

/** Tabs never get narrower than this (then the list scrolls). */
const TAB_MIN_PX = 72;
/** Below this strip width only the active tab and a count chip are shown. */
const NARROW_PX = 2 * TAB_MIN_PX + 28 + 32;

const IconPin = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 17v5M9 3h6l-1 7 3 3v2H7v-2l3-3z" />
  </svg>
);

/** Keep focus on the canvas: tabs and their buttons never take mouse focus. */
const keepFocus = (e: MouseEvent) => e.preventDefault();

interface TabItemProps {
  tab: Tab;
  label: string;
  isActive: boolean;
  tabStop: boolean;
  /** Save state; only ever non-"saved" for the active tab. */
  status: TabStripStatus;
  onActivate: (id: TabId) => void;
  onClose: (id: TabId) => void;
  onFocusTab: (id: TabId) => void;
  onMenu: (id: TabId, x: number, y: number) => void;
  onPointerDown: (e: PointerEvent<HTMLElement>, id: TabId) => void;
  wasDrag: () => boolean;
}

/** One tab. Memoized: a 50-tab strip re-renders only the rows that changed. */
const TabItem = memo(
  ({
    tab,
    label,
    isActive,
    tabStop,
    status,
    onActivate,
    onClose,
    onFocusTab,
    onMenu,
    onPointerDown,
    wasDrag,
  }: TabItemProps) => {
    const className = [
      "vault-tabs__tab",
      isActive && "vault-tabs__tab--active",
      tab.pinned && "vault-tabs__tab--pinned",
      tab.missing && "vault-tabs__tab--missing",
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <div
        className={className}
        role="tab"
        aria-selected={isActive}
        aria-label={tab.pinned ? `${label} (pinned)` : undefined}
        tabIndex={tabStop ? 0 : -1}
        title={tab.pinned ? `${label} (pinned)` : tab.path ?? label}
        data-testid="vault-tab"
        data-tab-id={tab.id}
        data-path={tab.path ?? ""}
        data-active={isActive ? "true" : "false"}
        onMouseDown={keepFocus}
        onPointerDown={(e) => onPointerDown(e, tab.id)}
        onClick={() => {
          if (!wasDrag()) {
            onActivate(tab.id);
          }
        }}
        onAuxClick={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            // Pinned tabs ignore middle click (Cmd+W rule); the menu still closes them.
            if (!tab.pinned) {
              onClose(tab.id);
            }
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu(tab.id, e.clientX, e.clientY);
        }}
        onFocus={() => onFocusTab(tab.id)}
      >
        {tab.pinned ? (
          <span className="vault-tabs__pin">
            <IconPin />
          </span>
        ) : (
          <>
            <IconDrawing className="vault-tabs__icon" width={13} height={13} />
            <span className="vault-tabs__name">{label}</span>
            {status === "dirty" && (
              <span
                className="vault-tabs__dot"
                role="img"
                aria-label="Unsaved changes"
              />
            )}
            {(status === "conflict" || status === "error") && (
              <span
                className="vault-tabs__warn"
                role="img"
                aria-label={
                  status === "conflict" ? "Save conflict" : "Save failed"
                }
              >
                <IconAlert />
              </span>
            )}
            <button
              type="button"
              className="vault-tabs__close"
              data-testid="vault-tab-close"
              tabIndex={-1}
              aria-label={`Close ${label}`}
              onMouseDown={keepFocus}
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
            >
              <IconClose width={12} height={12} />
            </button>
          </>
        )}
      </div>
    );
  },
);

type MenuState = { id: TabId; x: number; y: number };

export const TabStrip = memo(
  ({
    store,
    onActivate,
    onClose,
    onNewTab,
    activeStatus = "saved",
    onTogglePin,
    onMove,
    onCloseOthers,
    onCloseRight,
    onCloseAll,
    onCopyPath,
    onReveal,
    signals,
  }: TabStripProps) => {
    const tabs = useTabList(store);
    const active = useActiveTab(store);
    const labels = tabLabels(tabs);
    const stripRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const indicatorRef = useRef<HTMLDivElement>(null);
    const pendingFocus = useRef<TabId | null>(null);
    const [menu, setMenu] = useState<MenuState | null>(null);
    const [listOpen, setListOpen] = useState(false);
    const [narrow, setNarrow] = useState(false);
    // Roving tabindex: focus position is only valid for the active tab it was set under.
    const [roving, setRoving] = useState<{
      forActive: TabId;
      id: TabId;
    } | null>(null);
    const tabStop =
      roving &&
      roving.forActive === active.id &&
      tabs.some((t) => t.id === roving.id)
        ? roving.id
        : active.id;

    // Latest values for stable per-row callbacks.
    const latest = useRef({ tabs, activeId: active.id, menuId: menu?.id });
    latest.current = { tabs, activeId: active.id, menuId: menu?.id };
    const getTabs = useCallback(() => latest.current.tabs, []);

    const tabElement = (id: TabId): HTMLElement | null =>
      listRef.current?.querySelector<HTMLElement>(
        `[data-tab-id="${CSS.escape(id)}"]`,
      ) ?? null;

    // Narrow mode: one observer on the strip, state flips only at the threshold.
    useEffect(() => {
      const el = stripRef.current;
      if (!el || typeof ResizeObserver === "undefined") {
        return;
      }
      const ro = new ResizeObserver((entries) => {
        const width = entries[entries.length - 1].contentRect.width;
        setNarrow(width > 0 && width < NARROW_PX);
      });
      ro.observe(el);
      return () => ro.disconnect();
    }, []);

    // The first reveal (vault open) waits a frame: scrollIntoView forces a layout mid-render.
    const revealedOnce = useRef(false);
    useLayoutEffect(() => {
      const deferred = !revealedOnce.current;
      revealedOnce.current = true;
      return revealTab(tabElement(active.id), { deferred });
    }, [active.id]);

    useEffect(() => {
      const id = pendingFocus.current;
      if (id) {
        pendingFocus.current = null;
        tabElement(id)?.focus();
      }
    }, [tabs]);

    useEffect(
      () =>
        signals?.subscribe((kind) => {
          if (kind === "showAll") {
            setMenu(null);
            setListOpen(true);
          } else {
            tabElement(latest.current.activeId)?.focus();
          }
        }),
      [signals],
    );

    const focusTab = (id: TabId) => {
      setRoving({ forActive: active.id, id });
      tabElement(id)?.focus();
    };
    const onFocusTab = useCallback(
      (id: TabId) => setRoving({ forActive: latest.current.activeId, id }),
      [],
    );

    const onMenu = useCallback((id: TabId, x: number, y: number) => {
      setListOpen(false);
      setMenu({ id, x, y });
    }, []);

    const dismissMenu = useCallback((restoreFocus: boolean) => {
      const id = latest.current.menuId;
      setMenu(null);
      if (restoreFocus && id) {
        tabElement(id)?.focus();
      }
      // tabElement only reads listRef
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const dismissList = useCallback((restoreFocus: boolean) => {
      setListOpen(false);
      if (restoreFocus) {
        tabElement(latest.current.activeId)?.focus();
      }
    }, []);

    const { onTabPointerDown, wasDrag } = useStripDrag({
      listRef,
      indicatorRef,
      getTabs,
      onMove,
    });

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
      const id = el?.dataset.tabId;
      const index = tabs.findIndex((t) => t.id === id);
      if (index < 0) {
        return;
      }
      const n = tabs.length;
      const go = (to: number) => {
        e.preventDefault();
        focusTab(tabs[(to + n) % n].id);
      };
      if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
        e.preventDefault();
        const r = el!.getBoundingClientRect();
        return onMenu(tabs[index].id, r.left, r.bottom);
      }
      switch (e.key) {
        case "ArrowRight":
          return go(index + 1);
        case "ArrowLeft":
          return go(index - 1);
        case "Home":
          return go(0);
        case "End":
          return go(n - 1);
        case "Enter":
        case " ":
          e.preventDefault();
          return onActivate(tabs[index].id);
        case "Delete": {
          e.preventDefault();
          const neighbor = tabs[index + 1] ?? tabs[index - 1];
          pendingFocus.current = neighbor ? neighbor.id : null;
          return onClose(tabs[index].id);
        }
      }
    };

    const onStripDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
      if (
        !(e.target as HTMLElement).closest(
          '[role="tab"], button, .vault-tablist',
        )
      ) {
        onNewTab();
      }
    };

    // Vertical wheel scrolls the list sideways.
    const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && listRef.current) {
        listRef.current.scrollLeft += e.deltaY;
      }
    };

    const menuTab = menu ? tabs.find((t) => t.id === menu.id) : undefined;
    const activeIndex = tabs.findIndex((t) => t.id === active.id);
    const shown = narrow ? [activeIndex] : tabs.map((_, i) => i);

    return (
      <div
        className="vault-tabs"
        data-testid="vault-tabs"
        ref={stripRef}
        onDoubleClick={onStripDoubleClick}
      >
        <div
          className="vault-tabs__list"
          role="tablist"
          aria-label="Open drawings"
          ref={listRef}
          onKeyDown={onKeyDown}
          onWheel={onWheel}
        >
          {shown.map((i) => {
            const tab = tabs[i];
            const isActive = tab.id === active.id;
            return (
              <TabItem
                key={tab.id}
                tab={tab}
                label={labels[i]}
                isActive={isActive}
                tabStop={tab.id === tabStop}
                status={isActive ? activeStatus : "saved"}
                onActivate={onActivate}
                onClose={onClose}
                onFocusTab={onFocusTab}
                onMenu={onMenu}
                onPointerDown={onTabPointerDown}
                wasDrag={wasDrag}
              />
            );
          })}
        </div>
        <div
          className="vault-tabs__indicator"
          ref={indicatorRef}
          hidden
          aria-hidden="true"
        />
        <button
          type="button"
          className="vault-tabs__new"
          data-testid="vault-tab-new"
          aria-label="New tab"
          title="New tab"
          onMouseDown={keepFocus}
          onClick={onNewTab}
        >
          <IconPlus width={14} height={14} />
        </button>
        {narrow ? (
          <button
            type="button"
            className="vault-tabs__count"
            data-testid="vault-tab-count"
            aria-label="Show open tabs"
            aria-haspopup="listbox"
            aria-expanded={listOpen}
            onMouseDown={keepFocus}
            onClick={() => setListOpen((o) => !o)}
          >
            {activeIndex + 1} / {tabs.length}
          </button>
        ) : (
          <button
            type="button"
            className="vault-tabs__overflow"
            data-testid="vault-tab-overflow"
            aria-label="Show open tabs"
            title="Show open tabs"
            aria-haspopup="listbox"
            aria-expanded={listOpen}
            onMouseDown={keepFocus}
            onClick={() => setListOpen((o) => !o)}
          >
            <IconChevronDown width={14} height={14} />
          </button>
        )}
        {listOpen && (
          <TabListPopover
            entries={tabs.map((t, i) => ({
              id: t.id,
              label: labels[i],
              path: t.path,
              pinned: t.pinned,
              missing: t.missing,
            }))}
            activeId={active.id}
            onActivate={onActivate}
            onDismiss={dismissList}
          />
        )}
        {menu && menuTab && (
          <TabContextMenu
            tab={menuTab}
            x={menu.x}
            y={menu.y}
            onClose={onClose}
            onCloseOthers={onCloseOthers}
            onCloseRight={onCloseRight}
            onCloseAll={onCloseAll}
            onTogglePin={onTogglePin}
            onCopyPath={onCopyPath}
            onReveal={onReveal}
            onDismiss={dismissMenu}
          />
        )}
      </div>
    );
  },
);
