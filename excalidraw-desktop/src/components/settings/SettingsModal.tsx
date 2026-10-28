import { Fragment, useEffect, useRef, useState } from "react";

import { pushEscapeLayer } from "../escapeLayers";
import { IconClose } from "../Icons";

import { APP_VERSION } from "../../appVersion";
import { openConfigDir } from "../../vault/settingsSync";

import { SETTING_CONTROLS } from "./pages";
import { ToolsPage } from "./pages/Tools";
import {
  DEFAULT_SETTINGS_PAGE,
  getPage,
  groupByPage,
  parseSettingsTarget,
  searchSettings,
  SETTINGS_PAGES,
  SETTINGS_SCHEMA,
  settingsForPage,
  type SettingSchema,
  type SettingsPageId,
  type SettingsTarget,
  type ToolsSection,
} from "./schema";

import "./settings.css";

import { ScopeSwitch } from "./ScopeSwitch";
import { SettingsProvider, useSettingsController } from "./SettingsContext";
import { setSettingsScope, targetHasVaultRows } from "./settingsScope";
import { SETTINGS_PANEL_ID, settingsTabId, Sidebar } from "./Sidebar";

import type { ThemeRegistry } from "../../theme/registry";
import type { VaultInfo } from "../../vault/types";

export interface SettingsModalProps {
  vault: VaultInfo | null;
  onClose: () => void;
  onThemeChanged?: (resolvedTheme: "light" | "dark") => void;
  /** Colour theme, mode or canvas sync changed (re-apply the appearance). */
  onAppearanceChanged?: () => void;
  /** Built-in + user themes; defaults to the cached registry. */
  themeRegistry?: ThemeRegistry;
  onRevealVault?: (path: string) => void;
  /** Opens the vault's crash-recovery folder (Files > Recovery); absent = no Reveal. */
  onRevealRecovery?: () => void;
  /** Lets the Hotkeys page bind a key to a drawing; absent = not offered. */
  pickDrawing?: () => Promise<string | null>;
  ownerDocument?: Document | null;
  /** Page (or Tools section, "tools:pen") shown when Settings opens. */
  initialPage?: SettingsTarget;
}

/** Text field or editor that owns the keyboard (e.g. Excalidraw's text editor). */
const isEditable = (el: Element | null) =>
  !!el &&
  (el.tagName === "TEXTAREA" ||
    el.tagName === "INPUT" ||
    el.tagName === "SELECT" ||
    (el as HTMLElement).isContentEditable);

const SettingList = ({
  settings,
  inSearch = false,
}: {
  settings: readonly SettingSchema[];
  inSearch?: boolean;
}) => (
  <div className="vault-settings-section">
    {settings.map((s, i) => {
      const control = SETTING_CONTROLS[s.id];
      const Component =
        (inSearch && control.SearchComponent) || control.Component;
      return (
        <Fragment key={s.id}>
          {!inSearch && s.heading && s.heading !== settings[i - 1]?.heading && (
            <h3 className="vault-settings-heading">{s.heading}</h3>
          )}
          <Component />
        </Fragment>
      );
    })}
  </div>
);

export const SettingsModal = ({
  vault,
  onClose,
  onThemeChanged,
  onAppearanceChanged,
  themeRegistry,
  onRevealVault,
  onRevealRecovery,
  pickDrawing,
  ownerDocument,
  initialPage,
}: SettingsModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const doc = ownerDocument ?? modalRef.current?.ownerDocument ?? null;
  const win =
    doc?.defaultView ?? (typeof window !== "undefined" ? window : null);

  // An explicit target without per-vault rows (Hotkeys, Pens) opens in the
  // global scope. Runs once, before the first read of the scope.
  const [initial] = useState(() => {
    if (initialPage && !targetHasVaultRows(initialPage)) {
      setSettingsScope("global");
    }
    return parseSettingsTarget(initialPage ?? DEFAULT_SETTINGS_PAGE);
  });

  const settings = useSettingsController({
    win,
    doc,
    vault,
    themeRegistry,
    onThemeChanged,
    onAppearanceChanged,
    onRevealVault,
    onRevealRecovery,
    pickDrawing,
  });

  const [page, setPage] = useState<SettingsPageId>(initial.page);
  const [toolsSection, setToolsSection] = useState<ToolsSection | undefined>(
    initial.section,
  );
  const [query, setQuery] = useState("");
  const queryRef = useRef(query);
  queryRef.current = query;

  const inVaultScope = settings.scope === "vault";
  const available = SETTINGS_SCHEMA.filter((s) => {
    const control = SETTING_CONTROLS[s.id];
    return (
      !!control &&
      (!inVaultScope || !!s.perVault) &&
      (control.available?.(settings) ?? true)
    );
  });
  const pages = SETTINGS_PAGES.filter((p) =>
    available.some((s) => s.page === p.id),
  );
  const activePage = pages.some((p) => p.id === page)
    ? page
    : pages[0]?.id ?? DEFAULT_SETTINGS_PAGE;
  const searching = query.trim() !== "";
  const results = searching
    ? groupByPage(
        searchSettings(
          query,
          available.filter(
            (s) => SETTING_CONTROLS[s.id].searchable?.(settings) ?? true,
          ),
        ),
      )
    : [];

  // Enter / ArrowRight on a nav tab: first control of the page.
  const enterPage = () => {
    modalRef.current
      ?.querySelector<HTMLElement>(
        `#${SETTINGS_PANEL_ID} :is(button, input, select, textarea, [tabindex="0"]):not(:disabled)`,
      )
      ?.focus();
  };

  const openPage = (next: SettingsPageId, section?: ToolsSection) => {
    setQuery("");
    setPage(next);
    if (section) {
      setToolsSection(section);
    }
  };

  // Focus the search box, unless Settings opened over a text edit (e.g.
  // Cmd+, while typing on the canvas): taking focus would end that edit.
  useEffect(() => {
    const active = searchRef.current?.ownerDocument.activeElement ?? null;
    if (isEditable(active) && !modalRef.current?.contains(active)) {
      return;
    }
    searchRef.current?.focus({ preventScroll: true });
  }, []);

  // Escape: a control that handled it (e.g. the theme search) marks it
  // handled; otherwise clear the settings search first, then close.
  useEffect(() => {
    const targetDoc =
      doc ?? (typeof document !== "undefined" ? document : null);
    if (!targetDoc) {
      return;
    }
    // Settings joins the Escape stack: a dialog opened over it (an uninstall confirm) closes
    // alone; Settings answers only when it is the top layer.
    const layer = pushEscapeLayer();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !layer.isTop()) {
        return;
      }
      // Respect a handled Escape from our own controls or from a text field
      // (Excalidraw's text editor commits on Escape). Excalidraw's canvas
      // also claims Escape (deselect) but must not keep Settings open.
      const target = e.target instanceof Element ? e.target : null;
      if (
        e.defaultPrevented &&
        (isEditable(target) || !!modalRef.current?.contains(target))
      ) {
        return;
      }
      e.preventDefault();
      if (queryRef.current) {
        setQuery("");
        return;
      }
      onClose();
    };
    targetDoc.addEventListener("keydown", handleKeyDown);
    return () => {
      layer.pop();
      targetDoc.removeEventListener("keydown", handleKeyDown);
    };
  }, [doc, onClose]);

  return (
    <div
      className="vault-modal-backdrop vd-dialog-scrim vd-settings-scrim"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div ref={modalRef} className="vault-settings-modal">
        <Sidebar
          pages={pages}
          activePage={searching ? null : activePage}
          onSelectPage={openPage}
          query={query}
          onQueryChange={setQuery}
          searchRef={searchRef}
          onEnterPage={enterPage}
          top={
            <SettingsProvider value={settings}>
              <ScopeSwitch />
            </SettingsProvider>
          }
          footer={
            <>
              Vaultdraw {APP_VERSION}
              {settings.settingsStatus.mode === "tauri" && (
                <>
                  {" · "}
                  <button
                    type="button"
                    className="vault-settings-foot__link"
                    title={settings.settingsStatus.configPath ?? "config.toml"}
                    onClick={() => void openConfigDir().catch(() => {})}
                  >
                    config.toml
                  </button>
                </>
              )}
            </>
          }
        />

        <section className="vault-settings-content">
          <SettingsProvider value={settings}>
            <div className="vault-settings-header">
              <h2 id="settings-title" className="vault-settings-title">
                {searching ? "Search results" : getPage(activePage).label}
              </h2>
              <button
                type="button"
                className="vault-btn vault-btn--ghost vault-btn--icon"
                onClick={onClose}
                aria-label="Close settings"
              >
                <IconClose />
              </button>
            </div>

            {inVaultScope && (
              <p className="vault-settings-scope-note">
                Values set here apply to this vault only and override the global
                value.
              </p>
            )}

            {searching ? (
              <div
                className="vault-settings-body vault-settings-results"
                aria-label="Settings search results"
                role="region"
              >
                {results.length === 0 ? (
                  <p className="vault-settings-empty" role="status">
                    No settings match &ldquo;{query.trim()}&rdquo;.
                  </p>
                ) : (
                  results.map((group) => (
                    <section
                      key={group.page.id}
                      className="vault-settings-result-group"
                      data-page={group.page.id}
                      aria-label={group.page.label}
                    >
                      <h3 className="vault-settings-result-group__title">
                        <button
                          type="button"
                          className="vault-settings-result-group__link"
                          onClick={() =>
                            openPage(group.page.id, group.settings[0].section)
                          }
                          title={`Open ${group.page.label}`}
                        >
                          {group.page.label}
                        </button>
                      </h3>
                      <SettingList settings={group.settings} inSearch />
                    </section>
                  ))
                )}
              </div>
            ) : (
              <div
                className="vault-settings-body"
                id={SETTINGS_PANEL_ID}
                role="tabpanel"
                aria-labelledby={settingsTabId(activePage)}
                data-page={activePage}
                data-testid={getPage(activePage).testId}
              >
                {getPage(activePage).intro && (
                  <p className="vault-settings-intro">
                    {getPage(activePage).intro}
                  </p>
                )}
                {activePage === "tools" ? (
                  <ToolsPage
                    section={toolsSection}
                    onSectionChange={setToolsSection}
                  />
                ) : (
                  <SettingList
                    settings={settingsForPage(activePage, available)}
                  />
                )}
              </div>
            )}
          </SettingsProvider>
        </section>
      </div>
    </div>
  );
};
