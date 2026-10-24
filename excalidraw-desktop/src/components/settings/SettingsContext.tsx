import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from "react";

import {
  getEditorDefaults,
  getPreferences,
  getLinksSettings,
  getTagsSettings,
  getTheme,
  resolveTheme,
  setAutosaveDelayMs,
  setEditorDefaults,
  setTheme,
  subscribePreferences,
  updatePreferences,
  type VaultTheme,
} from "../../vault/preferences";
import {
  getSettingsStatus,
  PREFERENCES_CHANGED_EVENT,
  SETTINGS_STATUS_EVENT,
  type SettingsStatus,
} from "../../vault/settingsSync";
import {
  getThemeRegistry,
  resolveSelectedTheme,
  type ThemeEntry,
  type ThemeRegistry,
} from "../../theme/registry";

import { clampZoom } from "../../vault/zoom";
import { useVaultSettingsView } from "../../vault/useVaultSettingsView";

import {
  getSettingsScope,
  setSettingsScope,
  subscribeSettingsScope,
  type SettingsScope,
} from "./settingsScope";

import type { LinksSettings } from "../../links/types";
import type { TagsSettings } from "../../tags/types";
import type { UseVaultSettings } from "../../vault/useVaultSettings";
import type { VaultPreferences } from "../../vault/preferences";
import type { VaultInfo } from "../../vault/types";
import type {
  EffectiveVaultSettings,
  VaultField,
} from "../../vault/vaultSettings";

export type EditorDefaults = ReturnType<typeof getEditorDefaults>;

/**
 * Shared state for every settings control. The shell owns it so a control
 * behaves the same on its page and in search results.
 */
export interface SettingsContextValue {
  win: Window | null;
  vault: VaultInfo | null;
  onRevealVault?: (path: string) => void;
  onRevealRecovery?: () => void;

  mode: VaultTheme;
  setMode: (mode: VaultTheme) => void;

  registry: ThemeRegistry;
  selection: ReturnType<typeof resolveSelectedTheme>;
  selectColourTheme: (entry: ThemeEntry) => void;

  syncCanvas: boolean;
  setSyncCanvas: (next: boolean) => void;

  /** "" = the theme's own primary colour. */
  accentColor: string;
  setAccentColor: (hex: string) => void;

  zoom: number;
  setZoom: (percent: number) => void;

  confirmDelete: boolean;
  setConfirmDelete: (next: boolean) => void;
  showTagChips: boolean;
  setShowTagChips: (next: boolean) => void;
  thumbnails: boolean;
  setThumbnails: (next: boolean) => void;

  /** The `[links]` settings. */
  links: LinksSettings;
  setLinks: (partial: Partial<LinksSettings>) => void;
  /** The `[tags]` settings. */
  tags: TagsSettings;
  setTags: (partial: Partial<TagsSettings>) => void;
  /**
   * Asks the user for a drawing (vault-relative path, null = cancelled).
   * Supplied by the app shell; without it "Add drawing shortcut" is hidden.
   */
  pickDrawing?: () => Promise<string | null>;

  /** Read-only view of the per-vault store (overrides, effective values). */
  vaultSettings: UseVaultSettings;
  /**
   * Which layer Settings edits. "vault" only while a writable vault is open;
   * otherwise "global" whatever was chosen.
   */
  scope: SettingsScope;
  setScope: (scope: SettingsScope) => void;
  /** Edit a per-vault field in the current scope. */
  setScopedValue: <F extends VaultField>(
    field: F,
    value: VaultPreferences[F],
  ) => void;
  /** The value shown in the current scope (global value, or effective one). */
  scopedValue: <F extends VaultField>(field: F) => EffectiveVaultSettings[F];
  /** Remove the vault's override of `field` (the global value applies). */
  resetToGlobal: (field: VaultField) => void;

  defaults: EditorDefaults;
  updateDefaults: (partial: Parameters<typeof setEditorDefaults>[0]) => void;

  autosaveDelay: number;
  setAutosaveDelay: (ms: number) => void;

  settingsStatus: SettingsStatus;
  setSettingsStatus: (status: SettingsStatus) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export const SettingsProvider = SettingsContext.Provider;

export const useSettings = (): SettingsContextValue => {
  const value = useContext(SettingsContext);
  if (!value) {
    throw new Error("useSettings must be used inside <SettingsModal>");
  }
  return value;
};

/** Like `useSettings`, but `null` outside <SettingsModal> (rows rendered alone). */
export const useSettingsOptional = (): SettingsContextValue | null =>
  useContext(SettingsContext);

export interface SettingsControllerOptions {
  win: Window | null;
  doc: Document | null;
  vault: VaultInfo | null;
  themeRegistry?: ThemeRegistry;
  onThemeChanged?: (resolvedTheme: "light" | "dark") => void;
  onAppearanceChanged?: () => void;
  onRevealVault?: (path: string) => void;
  onRevealRecovery?: () => void;
  pickDrawing?: () => Promise<string | null>;
}

export const useSettingsController = ({
  win,
  doc,
  vault,
  themeRegistry,
  onThemeChanged,
  onAppearanceChanged,
  onRevealVault,
  onRevealRecovery,
  pickDrawing,
}: SettingsControllerOptions): SettingsContextValue => {
  const [mode, setModeState] = useState<VaultTheme>(() => getTheme(win));
  const [colorTheme, setColorThemeState] = useState(
    () => getPreferences(win).colorTheme,
  );
  const [syncCanvas, setSyncCanvasState] = useState(
    () => getPreferences(win).syncCanvas,
  );
  // Stable between renders: getThemeRegistry() without a cache builds new
  // entries each call, which would defeat the picker's memoised cards.
  const registry = useMemo(
    () => themeRegistry ?? getThemeRegistry(),
    [themeRegistry],
  );
  const selection = resolveSelectedTheme(registry, colorTheme);
  const [defaults, setDefaultsState] = useState(() => getEditorDefaults(win));
  const [autosaveDelay, setAutosaveDelayState] = useState(
    () => getPreferences(win).autosaveDelayMs,
  );
  const [accentColor, setAccentColorState] = useState(
    () => getPreferences(win).accentColor,
  );
  const [zoom, setZoomState] = useState(() => getPreferences(win).zoom);
  const [confirmDelete, setConfirmDeleteState] = useState(
    () => getPreferences(win).confirmDelete,
  );
  const [showTagChips, setShowTagChipsState] = useState(
    () => getPreferences(win).showTagChips,
  );
  const [thumbnails, setThumbnailsState] = useState(
    () => getPreferences(win).thumbnails,
  );
  const [links, setLinksState] = useState(() =>
    getLinksSettings(getPreferences(win)),
  );
  const [tags, setTagsState] = useState(() =>
    getTagsSettings(getPreferences(win)),
  );
  const vaultSettings = useVaultSettingsView(win);
  const [settingsStatus, setSettingsStatus] = useState(getSettingsStatus);

  // The view.zoom* shortcuts change the zoom while Settings may be open.
  useEffect(
    () => subscribePreferences(() => setZoomState(getPreferences(win).zoom)),
    [win],
  );

  // Refresh displayed values when config.toml is reloaded while open.
  useEffect(() => {
    if (!win) {
      return;
    }
    const handlePreferencesChanged = () => {
      const prefs = getPreferences(win);
      setModeState(prefs.theme);
      setColorThemeState(prefs.colorTheme);
      setSyncCanvasState(prefs.syncCanvas);
      setDefaultsState(getEditorDefaults(win));
      setAutosaveDelayState(prefs.autosaveDelayMs);
      setAccentColorState(prefs.accentColor);
      setZoomState(prefs.zoom);
      setConfirmDeleteState(prefs.confirmDelete);
      setShowTagChipsState(prefs.showTagChips);
      setThumbnailsState(prefs.thumbnails);
      setLinksState(getLinksSettings(prefs));
      setTagsState(getTagsSettings(prefs));
    };
    const handleStatus = () => setSettingsStatus(getSettingsStatus());
    win.addEventListener(PREFERENCES_CHANGED_EVENT, handlePreferencesChanged);
    win.addEventListener(SETTINGS_STATUS_EVENT, handleStatus);
    return () => {
      win.removeEventListener(
        PREFERENCES_CHANGED_EVENT,
        handlePreferencesChanged,
      );
      win.removeEventListener(SETTINGS_STATUS_EVENT, handleStatus);
    };
  }, [win]);

  const setMode = (next: VaultTheme) => {
    setModeState(next);
    setTheme(next, win);
    const resolved = resolveTheme(next, win);
    const targetDoc =
      doc ?? (typeof document !== "undefined" ? document : null);
    targetDoc?.documentElement.classList.toggle("dark", resolved === "dark");
    onThemeChanged?.(resolved);
    onAppearanceChanged?.();
  };

  const selectColourTheme = (entry: ThemeEntry) => {
    // summary.key is the value stored in appearance.theme.
    const { key } = entry.summary;
    setColorThemeState(key);
    updatePreferences({ colorTheme: key }, win);
    onAppearanceChanged?.();
  };

  const setSyncCanvas = (next: boolean) => {
    setSyncCanvasState(next);
    updatePreferences({ syncCanvas: next }, win);
    onAppearanceChanged?.();
  };

  const setAccentColor = (hex: string) => {
    setAccentColorState(hex);
    updatePreferences({ accentColor: hex }, win);
    onAppearanceChanged?.();
  };

  const setZoom = (percent: number) => {
    const next = clampZoom(percent);
    setZoomState(next);
    updatePreferences({ zoom: next }, win);
  };

  const setConfirmDelete = (next: boolean) => {
    setConfirmDeleteState(next);
    updatePreferences({ confirmDelete: next }, win);
  };

  const setShowTagChips = (next: boolean) => {
    setShowTagChipsState(next);
    updatePreferences({ showTagChips: next }, win);
  };

  const setThumbnails = (next: boolean) => {
    setThumbnailsState(next);
    updatePreferences({ thumbnails: next }, win);
  };

  const setLinks = (partial: Partial<LinksSettings>) => {
    const next = { ...links, ...partial };
    setLinksState(next);
    updatePreferences(
      {
        linkNewFormat: next.newLinkFormat,
        linkShapeFormat: next.shapeLinkFormat,
        linkOpenModifier: next.openModifier,
        linkUpdateOnRename: next.updateOnRename,
        linkAutocomplete: next.autocomplete,
        linkHintChars: next.hintChars,
        linkStyle: next.styleLinks,
        linkColor: next.linkColor,
        linkHoverPreview: next.hoverPreview,
      },
      win,
    );
  };

  const setTags = (partial: Partial<TagsSettings>) => {
    const next = { ...tags, ...partial };
    setTagsState(next);
    updatePreferences(
      { tagAutocomplete: next.autocomplete, tagPaneSort: next.paneSort },
      win,
    );
  };

  const chosenScope = useSyncExternalStore(
    subscribeSettingsScope,
    getSettingsScope,
  );
  const scope: SettingsScope =
    vault && !vault.readOnly ? chosenScope : "global";

  const setScopedValue = <F extends VaultField>(
    field: F,
    value: VaultPreferences[F],
  ) => {
    if (scope === "vault") {
      void vaultSettings.setOverride(field, value);
    } else {
      updatePreferences({ [field]: value }, win);
    }
  };

  const scopedValue = <F extends VaultField>(
    field: F,
  ): EffectiveVaultSettings[F] =>
    (scope === "vault" ? vaultSettings.effective : vaultSettings.global)[field];

  const resetToGlobal = (field: VaultField) => {
    void vaultSettings.setOverride(field, null);
  };

  const updateDefaults = (partial: Parameters<typeof setEditorDefaults>[0]) => {
    setEditorDefaults(partial, win);
    setDefaultsState(getEditorDefaults(win));
  };

  const setAutosaveDelay = (ms: number) => {
    setAutosaveDelayState(ms);
    setAutosaveDelayMs(ms, win);
  };

  return {
    win,
    vault,
    onRevealVault,
    onRevealRecovery,
    mode,
    setMode,
    registry,
    selection,
    selectColourTheme,
    syncCanvas,
    setSyncCanvas,
    accentColor,
    setAccentColor,
    zoom,
    setZoom,
    confirmDelete,
    setConfirmDelete,
    showTagChips,
    setShowTagChips,
    thumbnails,
    setThumbnails,
    links,
    setLinks,
    tags,
    setTags,
    pickDrawing,
    vaultSettings,
    scope,
    setScope: setSettingsScope,
    setScopedValue,
    scopedValue,
    resetToGlobal,
    defaults,
    updateDefaults,
    autosaveDelay,
    setAutosaveDelay,
    settingsStatus,
    setSettingsStatus,
  };
};

/** A setting's control, rendered on its page and in search results. */
export interface SettingControl {
  Component: () => ReactElement | null;
  /** Shown in search results instead of `Component` (a heavy custom page). */
  SearchComponent?: () => ReactElement | null;
  /** False hides the setting (and excludes it from search). */
  available?: (ctx: SettingsContextValue) => boolean;
  /** False keeps a shown setting out of search results (page notes). */
  searchable?: (ctx: SettingsContextValue) => boolean;
}

export type SettingControls = Record<string, SettingControl>;
