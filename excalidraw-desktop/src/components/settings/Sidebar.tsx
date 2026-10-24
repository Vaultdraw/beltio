import { useRef } from "react";

import { useListKeys } from "../../commands/useListKeys";

import {
  IconClose,
  IconFolder,
  IconHistory,
  IconInfo,
  IconKeyboard,
  IconLink,
  IconLock,
  IconLayout,
  IconPage,
  IconPalette,
  IconPenTool,
  IconPlug,
  IconSearch,
  IconSettings,
  IconTools,
} from "../Icons";

import type { KeyboardEvent, ReactNode, RefObject } from "react";

import type { SettingsPage, SettingsPageId } from "./schema";

const NAV_ICON = { width: 14, height: 14, "aria-hidden": true } as const;

/** One icon per page, same size and stroke, so every label lines up. */
export const PAGE_ICONS: Record<SettingsPageId, ReactNode> = {
  general: <IconSettings {...NAV_ICON} />,
  appearance: <IconPalette {...NAV_ICON} />,
  page: <IconPage {...NAV_ICON} />,
  interface: <IconLayout {...NAV_ICON} />,
  drawing: <IconPenTool {...NAV_ICON} />,
  tools: <IconTools {...NAV_ICON} />,
  files: <IconFolder {...NAV_ICON} />,
  links: <IconLink {...NAV_ICON} />,
  history: <IconHistory {...NAV_ICON} />,
  hotkeys: <IconKeyboard {...NAV_ICON} />,
  plugins: <IconPlug {...NAV_ICON} />,
  control: <IconLock {...NAV_ICON} />,
  about: <IconInfo {...NAV_ICON} />,
};

export const settingsTabId = (page: SettingsPageId) =>
  `vault-settings-tab-${page}`;
export const SETTINGS_PANEL_ID = "vault-settings-panel";

export interface SidebarProps {
  pages: readonly SettingsPage[];
  /** null while search results are shown. */
  activePage: SettingsPageId | null;
  onSelectPage: (page: SettingsPageId) => void;
  query: string;
  onQueryChange: (query: string) => void;
  searchRef?: RefObject<HTMLInputElement | null>;
  /** Enter, ArrowRight or `l` on a page tab: move focus into the page. */
  onEnterPage?: () => void;
  /** "Vaultdraw 0.1.0 · config.toml" at the nav bottom (D6). */
  footer?: ReactNode;
}

export const Sidebar = ({
  pages,
  activePage,
  onSelectPage,
  query,
  onQueryChange,
  searchRef,
  onEnterPage,
  footer,
}: SidebarProps) => {
  const navRef = useRef<HTMLElement>(null);
  // One tab stop: the active page (or the first while searching).
  const stopId = activePage ?? pages[0]?.id;

  const focusTab = (id: SettingsPageId) =>
    navRef.current
      ?.querySelector<HTMLElement>(`#${settingsTabId(id)}`)
      ?.focus();

  const handleSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // First Escape clears the search; Settings closes on the next one.
    if (e.key === "Escape" && query) {
      e.preventDefault();
      onQueryChange("");
    } else if (e.key === "ArrowDown" && !query && stopId) {
      e.preventDefault();
      focusTab(stopId);
    }
  };

  // Page tabs are a `list.*` command target: j/k or arrows step, Home/End
  // (g/G) jump, Space selects, Enter/l/ArrowRight move focus into the page.
  const currentTab = () => {
    const id = navRef.current?.ownerDocument.activeElement?.id;
    return pages.findIndex((p) => settingsTabId(p.id) === id);
  };
  const step = (pick: (current: number, last: number) => number) => () => {
    const current = currentTab();
    if (current < 0) {
      return;
    }
    const next = pick(current, pages.length - 1);
    if (next < 0) {
      searchRef?.current?.focus();
      return;
    }
    onSelectPage(pages[next].id);
    focusTab(pages[next].id);
  };
  const enterPage = () => {
    const current = currentTab();
    if (current < 0) {
      return;
    }
    if (pages[current].id !== activePage) {
      onSelectPage(pages[current].id);
    }
    onEnterPage?.();
  };
  useListKeys(navRef, "settings", {
    down: step((current, last) => Math.min(last, current + 1)),
    // Up from the first page goes back to the search field.
    up: step((current) => current - 1),
    first: step(() => 0),
    last: step((_, last) => last),
    expand: enterPage,
    open: enterPage,
    // Space selects the focused tab and keeps focus here (ARIA tablist).
    select: step((current) => current),
  });

  return (
    <aside className="vault-settings-sidebar">
      <div className="vault-settings-search">
        <IconSearch
          className="vault-settings-search__icon"
          width="14"
          height="14"
          aria-hidden="true"
        />
        <input
          ref={searchRef}
          type="search"
          className="vault-settings-search__input"
          placeholder="Search settings"
          aria-label="Search settings"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          spellCheck={false}
          autoComplete="off"
        />
        {query && (
          <button
            type="button"
            className="vault-settings-search__clear"
            aria-label="Clear settings search"
            onClick={() => {
              onQueryChange("");
              searchRef?.current?.focus();
            }}
          >
            <IconClose width="12" height="12" />
          </button>
        )}
      </div>
      <nav
        ref={navRef}
        className="vault-settings-nav"
        role="tablist"
        aria-orientation="vertical"
        aria-label="Settings pages"
      >
        {pages.map((page) => {
          const active = page.id === activePage;
          return (
            <button
              key={page.id}
              id={settingsTabId(page.id)}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={SETTINGS_PANEL_ID}
              tabIndex={page.id === stopId ? 0 : -1}
              className={`vault-settings-nav-item ${
                active ? "vault-settings-nav-item--active" : ""
              }`}
              onClick={() => onSelectPage(page.id)}
            >
              {PAGE_ICONS[page.id]}
              <span>{page.label}</span>
            </button>
          );
        })}
      </nav>
      {footer && <div className="vault-settings-foot">{footer}</div>}
    </aside>
  );
};
