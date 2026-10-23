import {
  BACKGROUND_PATTERN_LIMITS,
  isBackgroundPatternType,
  type BackgroundPatternType,
} from "@excalidraw/excalidraw/data/backgroundPattern";

import {
  PAGE_LIMITS,
  isPageLayout,
  isPageOrientation,
  isPageSize,
  type PageLayout,
  type PageOrientation,
  type PageSize,
} from "@excalidraw/excalidraw/data/pageSetup";

import {
  DEFAULT_THUMB_CACHE_MB,
  DEFAULT_THUMB_MAX_ELEMENTS,
  MAX_THUMB_CACHE_MB,
  MIN_THUMB_CACHE_MB,
  MAX_THUMB_MAX_ELEMENTS,
  MIN_THUMB_MAX_ELEMENTS,
} from "../thumbnails/limits";

import {
  DEFAULT_LINKS_SETTINGS,
  type HoverPreview,
  type LinksSettings,
  type NewLinkFormat,
  type OpenModifier,
  type ShapeLinkFormat,
  type UpdateOnRename,
} from "../links/types";
import {
  KEYS_DEFAULTS,
  normalizeKeysPreferences,
  type KeysPreferences,
} from "../commands/keySettings";
import {
  HISTORY_DEFAULTS,
  normalizeHistoryPreferences,
  type HistoryPreferences,
} from "../history/historySettings";
import {
  MEMORY_DEFAULTS,
  normalizeMemoryPreferences,
  type MemoryPreferences,
} from "../memory/memorySettings";
import {
  normalizeSearchPreferences,
  SEARCH_DEFAULTS,
  type SearchPreferences,
} from "../search/searchSettings";
import {
  TABS_DEFAULTS,
  normalizeTabsPreferences,
  type TabsPreferences,
} from "../tabs/tabsSettings";
import {
  SERVICES_DEFAULTS,
  normalizeServicesPreferences,
  type ServicesPreferences,
} from "../services/servicesSettings";

import {
  DEFAULT_TAGS_SETTINGS,
  type TagSort,
  type TagsSettings,
} from "../tags/types";
import {
  DEFAULT_PDF_IMPORT_SETTINGS,
  PDF_IMPORT_LIMITS,
  type PdfImageFormat,
  type PdfImportSettings,
} from "../pdfImport/types";
import { DEFAULT_TEMPLATES_FOLDER } from "../templates/types";
import {
  DEFAULT_LASER,
  LASER_LIMITS,
  inRange,
  type LaserSettings,
} from "../pens/laserSettings";
import {
  DEFAULT_PEN_PRESETS,
  isPenPresets,
  withPenDefaults,
  type PenPreset,
} from "../pens/penPresets";

import {
  isToolStyle,
  TOOL_DEFAULT_TOOLS,
  toolField,
  type ToolField,
  type ToolStyle,
} from "../toolDefaults/toolStyles";

import {
  normalizePluginSettings,
  type PluginSettingsMap,
} from "./pluginSettingsTable";
import { DEFAULT_SORT_ORDER, isSortOrder, type SortOrder } from "./sortOrder";

/** `plugins.storage_limit_kb`: default and bounds (Rust refuses more than 16 MiB). */
export const DEFAULT_PLUGIN_STORAGE_KB = 1024;
export const MIN_PLUGIN_STORAGE_KB = 64;
export const MAX_PLUGIN_STORAGE_KB = 16384;
/** `plugins.scene_max_ops`: ops per plugin batch (sceneRules MAX_OPS and MAX_OPS_LIMIT; a test keeps them equal). */
export const DEFAULT_SCENE_MAX_OPS = 500;
export const MAX_SCENE_MAX_OPS = 1000;

export type VaultTheme = "light" | "dark" | "system";

/** Last-used image export options (machine state, not a user setting). */
export interface ExportOptions {
  scale: 1 | 2 | 3;
  background: boolean;
  embedScene: boolean;
  /** Draw the paper pattern in exports that include the background. */
  pattern: boolean;
  /** Page mode: export the whole page column instead of the content. */
  pageShaped: boolean;
}

const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;

/** Same default scale as the editor (appState.ts defaultExportScale). */
export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  scale: dpr === 2 || dpr === 3 ? dpr : 1,
  background: true,
  embedScene: false,
  pattern: true,
  pageShaped: false,
};

export function normalizeExportOptions(input: unknown): ExportOptions {
  const o =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const d = DEFAULT_EXPORT_OPTIONS;
  return {
    scale: o.scale === 1 || o.scale === 2 || o.scale === 3 ? o.scale : d.scale,
    background: typeof o.background === "boolean" ? o.background : d.background,
    embedScene: typeof o.embedScene === "boolean" ? o.embedScene : d.embedScene,
    pattern: typeof o.pattern === "boolean" ? o.pattern : d.pattern,
    pageShaped: typeof o.pageShaped === "boolean" ? o.pageShaped : d.pageShaped,
  };
}

/** Paper style of new drawings; "plain" = no pattern. */
export type PaperStyle = "plain" | BackgroundPatternType;

/** Default mode of new drawings: the infinite canvas or simulated pages. */
export type PageModeDefault = "normal" | "page";
/** Paper theme as spelled in config.toml (the model uses "oldSchool"). */
export type PagePaperTheme = "normal" | "old_school" | "match";

interface VaultPreferencesBase {
  recentVaults: string[];
  lastVaultPath: string | null;
  navigatorCollapsed: boolean;
  navigatorWidth: number;
  expandedFolders: Record<string, string[]>;
  exportOptions: ExportOptions;
  /** The user has panned the canvas once: the "move canvas" hint stays hidden (machine state). */
  hasPanned: boolean;
  theme: VaultTheme;
  /** Colour theme name: a built-in name or a theme in the config themes/ folder. */
  colorTheme: string;
  /** Make the canvas background, pencil and palette colours follow the theme. */
  syncCanvas: boolean;
  defaultFontFamily: number;
  defaultFontSize: number;
  defaultStrokeColor: string;
  defaultBackgroundColor: string;
  defaultFillStyle: string;
  defaultStrokeWidth: number;
  defaultRoughness: number;
  autosaveDelayMs: number;
  defaultCanvasBackground?: string;
  /** Paper pattern of new drawings. A vault's settings.toml may override the style. */
  paperStyle: PaperStyle;
  /** Distance between lines or dots in scene units; 0 = the style's preset. */
  paperSpacing: number;
  /** Pattern colour "#rrggbb"; "" = automatic. */
  paperColor: string;
  paperOpacity: number;
  /** Grid and graph: a major line every N; 0 = the style's preset. */
  paperMajorEvery: number;
  /** Ruled lines only. */
  paperMarginLine: boolean;
  /** Page mode defaults for new drawings (`[page]`). */
  pageMode: PageModeDefault;
  pageLayout: PageLayout;
  /** A preset id or "custom". */
  pageSize: PageSize;
  pageOrientation: PageOrientation;
  /** Custom page size in px, used when pageSize is "custom"; 0 = unset. */
  pageWidth: number;
  pageHeight: number;
  pagePaperTheme: PagePaperTheme;
  /** Replaces the theme's primary colour ("#rrggbb"); "" = the theme's own. */
  accentColor: string;
  /** Enabled CSS snippets (`<config>/snippets/<name>.css`), applied in order. */
  snippets: string[];
  /** Whole-window zoom in percent (webview zoom), 50 to 200. */
  zoom: number;
  /** Ask before moving a file or folder to the OS Trash. */
  confirmDelete: boolean;
  /** Show small tag chips after drawing names in the file tree. */
  showTagChips: boolean;
  /** Mount the vault home pane one frame after the file tree first paints (faster vault open). */
  deferHomePane: boolean;
  /** Show drawing thumbnails (home, search, palette, gallery). */
  thumbnails: boolean;
  /** Largest drawing (elements) that gets a PNG thumbnail; bigger ones keep the placeholder. */
  thumbnailMaxElements: number;
  /** Size cap of a vault's thumbnail cache on disk, in megabytes. */
  thumbnailCacheMb: number;
  /** Show the icon bar on the left edge. A vault's settings.toml may override it. */
  activityBar: boolean;
  /** Activity bar entry ids in display order; unlisted entries follow in default order. */
  activityBarOrder: string[];
  /** Activity bar entry ids hidden from the bar (their commands still work). */
  activityBarHidden: string[];
  /** Ids of enabled plugins (`[plugins] enabled`). */
  pluginsEnabled: string[];
  /** `[plugins] importers`: file extension -> plugin id ("" = no plugin handles it). */
  pluginImporters: Record<string, string>;
  /** Limit of each plugin's `ctx.storage.global`, in KiB (`plugins.storage_limit_kb`). */
  pluginsStorageLimitKb: number;
  /** Most ops in one plugin `scene.batch` (`plugins.scene_max_ops`). */
  pluginsSceneMaxOps: number;
  /** Global navigator sort order; a vault's settings.toml may override it. */
  navigatorSort: SortOrder;
  /** Folder for new drawings, relative to the vault root ("" = unset). A vault's settings.toml may override it. */
  newDrawingFolder: string;
  /**
   * Vault folder holding templates, relative to the vault root. Never empty:
   * "" is not a valid value and falls back to "Templates". A vault's
   * settings.toml may override it.
   */
  templatesFolder: string;
  /** links.new_link_format */
  linkNewFormat: NewLinkFormat;
  /** links.shape_link_format */
  linkShapeFormat: ShapeLinkFormat;
  /** links.open_modifier */
  linkOpenModifier: OpenModifier;
  /** links.update_on_rename */
  linkUpdateOnRename: UpdateOnRename;
  /** links.autocomplete */
  linkAutocomplete: boolean;
  /** links.hint_chars */
  linkHintChars: string;
  /** links.style_links */
  linkStyle: boolean;
  /** links.color: "accent" or "#rrggbb" */
  linkColor: string;
  /** links.hover_preview */
  linkHoverPreview: HoverPreview;
  /** tags.autocomplete */
  tagAutocomplete: boolean;
  /** tags.pane_sort */
  tagPaneSort: TagSort;
  /** ai.enabled: the AI master switch (off unless the file says literal true) */
  aiEnabled: boolean;
  /** ai.mcp_enabled: the AI tools interface, effective only while aiEnabled */
  aiMcpEnabled: boolean;
  /** control.notify_edits: notice when a script or AI tool edits the drawing */
  controlNotifyEdits: boolean;
  /** pdf_import.max_side */
  pdfMaxSide: number;
  /** pdf_import.format */
  pdfFormat: PdfImageFormat;
  /** pdf_import.quality */
  pdfQuality: number;
  /** pdf_import.lock_pages */
  pdfLockPages: boolean;
  /** pdf_import.warn_pages */
  pdfWarnPages: number;
  /** pdf_import.pixel_budget_mp */
  pdfPixelBudgetMp: number;
  /** Hotkey overrides (`[hotkeys]`): command id -> chords. [] = unassigned. */
  hotkeys: Record<string, string[]>;
  /** Plugin settings (`[plugin.<id>]`): plugin id -> key -> value. */
  pluginSettings: PluginSettingsMap;
  /** Saved pens (1 to 9), selected with the pen.selectN commands (Alt+1..9). */
  penPresets: PenPreset[];
  laserColor: string;
  laserSize: number;
  laserDecayMs: number;
  laserLength: number;
}

/** Saved default style per drawing tool (`[tools.<tool>]`); {} = none. */
export type VaultPreferences = VaultPreferencesBase &
  HistoryPreferences &
  TabsPreferences &
  MemoryPreferences &
  SearchPreferences &
  KeysPreferences &
  ServicesPreferences &
  Record<ToolField, ToolStyle>;

const STORAGE_KEY = "excalidraw-vault-preferences-v1";

/** Excalidraw's FONT_FAMILY.Excalifont (packages/common/src/constants.ts). */
export const DEFAULT_FONT_FAMILY = 5;

const emptyToolStyles = () =>
  Object.fromEntries(
    TOOL_DEFAULT_TOOLS.map((tool) => [toolField(tool), {}]),
  ) as Record<ToolField, ToolStyle>;

/** Untrusted -> a valid style per tool; anything invalid becomes {}. */
const normalizeToolStyles = (parsed: Partial<Record<ToolField, unknown>>) =>
  Object.fromEntries(
    TOOL_DEFAULT_TOOLS.map((tool) => {
      const value = parsed[toolField(tool)];
      return [
        toolField(tool),
        isToolStyle(tool, value) ? { ...(value as ToolStyle) } : {},
      ];
    }),
  ) as Record<ToolField, ToolStyle>;

export const DEFAULT_PREFERENCES: VaultPreferences = {
  recentVaults: [],
  lastVaultPath: null,
  navigatorCollapsed: false,
  navigatorWidth: 280,
  expandedFolders: {},
  exportOptions: DEFAULT_EXPORT_OPTIONS,
  hasPanned: false,
  theme: "system",
  colorTheme: "Default",
  syncCanvas: false,
  defaultFontFamily: DEFAULT_FONT_FAMILY,
  defaultFontSize: 20,
  defaultStrokeColor: "#1e1e1e",
  defaultBackgroundColor: "transparent",
  defaultFillStyle: "solid",
  defaultStrokeWidth: 2,
  defaultRoughness: 1,
  autosaveDelayMs: 500,
  defaultCanvasBackground: "#ffffff",
  paperStyle: "plain",
  paperSpacing: 0,
  paperColor: "",
  paperOpacity: 1,
  paperMajorEvery: 0,
  paperMarginLine: true,
  pageMode: "normal",
  pageLayout: "separate",
  pageSize: "a4",
  pageOrientation: "portrait",
  pageWidth: 0,
  pageHeight: 0,
  pagePaperTheme: "normal",
  accentColor: "",
  snippets: [],
  zoom: 100,
  confirmDelete: true,
  showTagChips: true,
  deferHomePane: true,
  thumbnails: true,
  thumbnailMaxElements: DEFAULT_THUMB_MAX_ELEMENTS,
  thumbnailCacheMb: DEFAULT_THUMB_CACHE_MB,
  activityBar: true,
  activityBarOrder: [],
  activityBarHidden: [],
  pluginsEnabled: [],
  pluginImporters: {},
  pluginsStorageLimitKb: DEFAULT_PLUGIN_STORAGE_KB,
  pluginsSceneMaxOps: DEFAULT_SCENE_MAX_OPS,
  navigatorSort: DEFAULT_SORT_ORDER,
  newDrawingFolder: "",
  templatesFolder: DEFAULT_TEMPLATES_FOLDER,
  linkNewFormat: DEFAULT_LINKS_SETTINGS.newLinkFormat,
  linkShapeFormat: DEFAULT_LINKS_SETTINGS.shapeLinkFormat,
  linkOpenModifier: DEFAULT_LINKS_SETTINGS.openModifier,
  linkUpdateOnRename: DEFAULT_LINKS_SETTINGS.updateOnRename,
  linkAutocomplete: DEFAULT_LINKS_SETTINGS.autocomplete,
  linkHintChars: DEFAULT_LINKS_SETTINGS.hintChars,
  linkStyle: DEFAULT_LINKS_SETTINGS.styleLinks,
  linkColor: DEFAULT_LINKS_SETTINGS.linkColor,
  linkHoverPreview: DEFAULT_LINKS_SETTINGS.hoverPreview,
  tagAutocomplete: DEFAULT_TAGS_SETTINGS.autocomplete,
  tagPaneSort: DEFAULT_TAGS_SETTINGS.paneSort,
  aiEnabled: false,
  aiMcpEnabled: true,
  controlNotifyEdits: true,
  pdfMaxSide: DEFAULT_PDF_IMPORT_SETTINGS.maxSide,
  pdfFormat: DEFAULT_PDF_IMPORT_SETTINGS.format,
  pdfQuality: DEFAULT_PDF_IMPORT_SETTINGS.quality,
  pdfLockPages: DEFAULT_PDF_IMPORT_SETTINGS.lockPages,
  pdfWarnPages: DEFAULT_PDF_IMPORT_SETTINGS.warnPages,
  pdfPixelBudgetMp: DEFAULT_PDF_IMPORT_SETTINGS.pixelBudgetMp,
  hotkeys: {},
  pluginSettings: {},
  penPresets: DEFAULT_PEN_PRESETS.map((p) => ({ ...p })),
  laserColor: DEFAULT_LASER.color,
  laserSize: DEFAULT_LASER.size,
  laserDecayMs: DEFAULT_LASER.decayMs,
  laserLength: DEFAULT_LASER.length,
  ...HISTORY_DEFAULTS,
  ...TABS_DEFAULTS,
  ...MEMORY_DEFAULTS,
  ...SEARCH_DEFAULTS,
  ...KEYS_DEFAULTS,
  ...SERVICES_DEFAULTS,
  ...emptyToolStyles(),
};

/** The laser fields of the preferences as one settings object. */
export const getLaserSettings = (
  prefs: PreferencesSnapshot,
): LaserSettings => ({
  color: prefs.laserColor,
  size: prefs.laserSize,
  decayMs: prefs.laserDecayMs,
  length: prefs.laserLength,
});

/** The links fields of the preferences as one settings object. */
export const getLinksSettings = (
  prefs: PreferencesSnapshot,
): LinksSettings => ({
  newLinkFormat: prefs.linkNewFormat,
  shapeLinkFormat: prefs.linkShapeFormat,
  openModifier: prefs.linkOpenModifier,
  updateOnRename: prefs.linkUpdateOnRename,
  autocomplete: prefs.linkAutocomplete,
  hintChars: prefs.linkHintChars,
  styleLinks: prefs.linkStyle,
  linkColor: prefs.linkColor,
  hoverPreview: prefs.linkHoverPreview,
});

/** The tags fields of the preferences as one settings object. */
export const getTagsSettings = (prefs: PreferencesSnapshot): TagsSettings => ({
  autocomplete: prefs.tagAutocomplete,
  paneSort: prefs.tagPaneSort,
});

/** The `[pdf_import]` fields of the preferences as one settings object. */
export const getPdfImportSettings = (
  prefs: PreferencesSnapshot,
): PdfImportSettings => ({
  maxSide: prefs.pdfMaxSide,
  format: prefs.pdfFormat,
  quality: prefs.pdfQuality,
  lockPages: prefs.pdfLockPages,
  warnPages: prefs.pdfWarnPages,
  pixelBudgetMp: prefs.pdfPixelBudgetMp,
});

export const isPdfFormat = (v: unknown): v is PdfImageFormat =>
  v === "jpeg" || v === "png";
export const isPdfMaxSide = (v: unknown) =>
  Number.isInteger(v) && inRange(v, PDF_IMPORT_LIMITS.maxSide);
export const isPdfQuality = (v: unknown) =>
  inRange(v, PDF_IMPORT_LIMITS.quality);
export const isPdfWarnPages = (v: unknown) =>
  Number.isInteger(v) && inRange(v, PDF_IMPORT_LIMITS.warnPages);
export const isPdfPixelBudgetMp = (v: unknown) =>
  inRange(v, PDF_IMPORT_LIMITS.pixelBudgetMp);

export const isTagSort = (v: unknown): v is TagSort =>
  v === "name" || v === "count";

export const isNewLinkFormat = (v: unknown): v is NewLinkFormat =>
  v === "shortest" || v === "relative" || v === "absolute";
export const isShapeLinkFormat = (v: unknown): v is ShapeLinkFormat =>
  v === "wikilink" || v === "vaultdraw-url";
export const isOpenModifier = (v: unknown): v is OpenModifier =>
  v === "mod" || v === "alt" || v === "ctrl" || v === "shift";
export const isLinkColor = (v: unknown): v is string =>
  v === "accent" || (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v));
export const isHoverPreview = (v: unknown): v is HoverPreview =>
  v === "always" || v === "modifier" || v === "off";
export const isUpdateOnRename = (v: unknown): v is UpdateOnRename =>
  typeof v === "boolean" || v === "ask";
/** At least 2 distinct characters, no whitespace, nothing uppercase. */
export const isHintChars = (v: unknown): v is string => {
  if (typeof v !== "string" || /\s/.test(v) || v !== v.toLowerCase()) {
    return false;
  }
  const chars = Array.from(v);
  return chars.length >= 2 && new Set(chars).size === chars.length;
};

const PAPER_LIMITS = BACKGROUND_PATTERN_LIMITS;

export const isPaperStyle = (value: unknown): value is PaperStyle =>
  value === "plain" || isBackgroundPatternType(value);

/** "" = automatic colour. */
export const isPaperColor = (value: unknown): value is string =>
  value === "" || (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value));

/** 0 = the style's preset. */
export const isPaperSpacing = (value: unknown) =>
  value === 0 || inRange(value, PAPER_LIMITS.spacing);
export const isPaperOpacity = (value: unknown) =>
  inRange(value, PAPER_LIMITS.opacity);
export const isPaperMajorEvery = (value: unknown) =>
  value === 0 ||
  (Number.isInteger(value) && inRange(value, PAPER_LIMITS.majorEvery));

export const isPageMode = (value: unknown): value is PageModeDefault =>
  value === "normal" || value === "page";
export const isPagePaperTheme = (value: unknown): value is PagePaperTheme =>
  value === "normal" || value === "old_school" || value === "match";
/** 0 = unset (the A4 side is used). */
export const isPageSide = (value: unknown) =>
  value === 0 || (Number.isInteger(value) && inRange(value, PAGE_LIMITS.side));

export const MIN_ZOOM = 50;
export const MAX_ZOOM = 200;

export const isVaultTheme = (value: unknown): value is VaultTheme =>
  value === "light" || value === "dark" || value === "system";

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

export const isExpandedFolders = (
  value: unknown,
): value is Record<string, string[]> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.values(value as Record<string, unknown>).every(isStringArray);

/** Keep only entries whose value is an array of strings. */
export const normalizeHotkeys = (value: unknown): Record<string, string[]> => {
  const result: Record<string, string[]> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [id, keys] of Object.entries(value)) {
      if (isStringArray(keys)) {
        result[id] = [...keys];
      }
    }
  }
  return result;
};

const pick = <T>(
  value: unknown,
  guard: (value: unknown) => boolean,
  fallback: T,
): T => (guard(value) ? (value as T) : fallback);

const isNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value);
const isThumbCacheMb = (value: unknown) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= MIN_THUMB_CACHE_MB &&
  value <= MAX_THUMB_CACHE_MB;
const isThumbMaxElements = (value: unknown) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= MIN_THUMB_MAX_ELEMENTS &&
  value <= MAX_THUMB_MAX_ELEMENTS;
/** `plugins.importers`: a table of extension -> plugin id or "". */
export const isPluginImporters = (
  value: unknown,
): value is Record<string, string> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.values(value).every((v) => typeof v === "string");
export const isPluginStorageKb = (value: unknown) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= MIN_PLUGIN_STORAGE_KB &&
  value <= MAX_PLUGIN_STORAGE_KB;
export const isSceneMaxOps = (value: unknown) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= MAX_SCENE_MAX_OPS;
const isString = (value: unknown) => typeof value === "string";
const isBoolean = (value: unknown) => typeof value === "boolean";

/** Presets with missing optional fields filled in; invalid -> fallback. */
const normalizePenPresets = (value: unknown, fallback: PenPreset[]) => {
  const filled = withPenDefaults(value);
  return isPenPresets(filled) ? filled : fallback.map((p) => ({ ...p }));
};

/**
 * Field-by-field normalization of an untrusted preferences object: anything
 * with the wrong type falls back to that field's default.
 */
export function normalizePreferences(input: unknown): VaultPreferences {
  const parsed =
    input && typeof input === "object"
      ? (input as Partial<Record<keyof VaultPreferences, unknown>>)
      : {};
  const d = DEFAULT_PREFERENCES;
  return {
    ...d,
    ...(parsed as Partial<VaultPreferences>),
    recentVaults: Array.isArray(parsed.recentVaults)
      ? (parsed.recentVaults as string[])
      : [],
    lastVaultPath:
      typeof parsed.lastVaultPath === "string" ? parsed.lastVaultPath : null,
    navigatorCollapsed: pick(
      parsed.navigatorCollapsed,
      isBoolean,
      d.navigatorCollapsed,
    ),
    navigatorWidth: pick(parsed.navigatorWidth, isNumber, d.navigatorWidth),
    expandedFolders:
      parsed.expandedFolders && typeof parsed.expandedFolders === "object"
        ? (parsed.expandedFolders as Record<string, string[]>)
        : {},
    exportOptions: normalizeExportOptions(parsed.exportOptions),
    hasPanned: pick(parsed.hasPanned, isBoolean, d.hasPanned),
    theme: isVaultTheme(parsed.theme) ? parsed.theme : d.theme,
    colorTheme:
      typeof parsed.colorTheme === "string" && parsed.colorTheme.trim()
        ? parsed.colorTheme
        : d.colorTheme,
    syncCanvas: pick(parsed.syncCanvas, isBoolean, d.syncCanvas),
    defaultFontFamily: pick(
      parsed.defaultFontFamily,
      isNumber,
      d.defaultFontFamily,
    ),
    defaultFontSize: pick(parsed.defaultFontSize, isNumber, d.defaultFontSize),
    defaultStrokeColor: pick(
      parsed.defaultStrokeColor,
      isString,
      d.defaultStrokeColor,
    ),
    defaultBackgroundColor: pick(
      parsed.defaultBackgroundColor,
      isString,
      d.defaultBackgroundColor,
    ),
    defaultFillStyle: pick(
      parsed.defaultFillStyle,
      isString,
      d.defaultFillStyle,
    ),
    defaultStrokeWidth: pick(
      parsed.defaultStrokeWidth,
      isNumber,
      d.defaultStrokeWidth,
    ),
    defaultRoughness: pick(
      parsed.defaultRoughness,
      isNumber,
      d.defaultRoughness,
    ),
    autosaveDelayMs: pick(parsed.autosaveDelayMs, isNumber, d.autosaveDelayMs),
    defaultCanvasBackground: pick(
      parsed.defaultCanvasBackground,
      isString,
      d.defaultCanvasBackground,
    ),
    paperStyle: pick(parsed.paperStyle, isPaperStyle, d.paperStyle),
    paperSpacing: pick(parsed.paperSpacing, isPaperSpacing, d.paperSpacing),
    paperColor: pick(parsed.paperColor, isPaperColor, d.paperColor),
    paperOpacity: pick(parsed.paperOpacity, isPaperOpacity, d.paperOpacity),
    paperMajorEvery: pick(
      parsed.paperMajorEvery,
      isPaperMajorEvery,
      d.paperMajorEvery,
    ),
    paperMarginLine: pick(parsed.paperMarginLine, isBoolean, d.paperMarginLine),
    pageMode: pick(parsed.pageMode, isPageMode, d.pageMode),
    pageLayout: pick(parsed.pageLayout, isPageLayout, d.pageLayout),
    pageSize: pick(parsed.pageSize, isPageSize, d.pageSize),
    pageOrientation: pick(
      parsed.pageOrientation,
      isPageOrientation,
      d.pageOrientation,
    ),
    pageWidth: pick(parsed.pageWidth, isPageSide, d.pageWidth),
    pageHeight: pick(parsed.pageHeight, isPageSide, d.pageHeight),
    pagePaperTheme: pick(
      parsed.pagePaperTheme,
      isPagePaperTheme,
      d.pagePaperTheme,
    ),
    accentColor: pick(parsed.accentColor, isString, d.accentColor),
    snippets: pick(parsed.snippets, isStringArray, d.snippets),
    zoom: pick(
      parsed.zoom,
      (v) =>
        isNumber(v) && (v as number) >= MIN_ZOOM && (v as number) <= MAX_ZOOM,
      d.zoom,
    ),
    confirmDelete: pick(parsed.confirmDelete, isBoolean, d.confirmDelete),
    showTagChips: pick(parsed.showTagChips, isBoolean, d.showTagChips),
    deferHomePane: pick(parsed.deferHomePane, isBoolean, d.deferHomePane),
    thumbnails: pick(parsed.thumbnails, isBoolean, d.thumbnails),
    thumbnailCacheMb: pick(
      parsed.thumbnailCacheMb,
      isThumbCacheMb,
      d.thumbnailCacheMb,
    ),
    thumbnailMaxElements: pick(
      parsed.thumbnailMaxElements,
      isThumbMaxElements,
      d.thumbnailMaxElements,
    ),
    activityBar: pick(parsed.activityBar, isBoolean, d.activityBar),
    activityBarOrder: pick(
      parsed.activityBarOrder,
      isStringArray,
      d.activityBarOrder,
    ),
    activityBarHidden: pick(
      parsed.activityBarHidden,
      isStringArray,
      d.activityBarHidden,
    ),
    pluginsEnabled: pick(
      parsed.pluginsEnabled,
      isStringArray,
      d.pluginsEnabled,
    ),
    pluginImporters: pick(
      parsed.pluginImporters,
      isPluginImporters,
      d.pluginImporters,
    ),
    pluginsStorageLimitKb: pick(
      parsed.pluginsStorageLimitKb,
      isPluginStorageKb,
      d.pluginsStorageLimitKb,
    ),
    pluginsSceneMaxOps: pick(
      parsed.pluginsSceneMaxOps,
      isSceneMaxOps,
      d.pluginsSceneMaxOps,
    ),
    navigatorSort: pick(parsed.navigatorSort, isSortOrder, d.navigatorSort),
    newDrawingFolder: pick(
      parsed.newDrawingFolder,
      isString,
      d.newDrawingFolder,
    ),
    templatesFolder: pick(
      parsed.templatesFolder,
      (v) => isString(v) && (v as string).trim() !== "",
      d.templatesFolder,
    ),
    linkNewFormat: pick(parsed.linkNewFormat, isNewLinkFormat, d.linkNewFormat),
    linkShapeFormat: pick(
      parsed.linkShapeFormat,
      isShapeLinkFormat,
      d.linkShapeFormat,
    ),
    linkOpenModifier: pick(
      parsed.linkOpenModifier,
      isOpenModifier,
      d.linkOpenModifier,
    ),
    linkUpdateOnRename: pick(
      parsed.linkUpdateOnRename,
      isUpdateOnRename,
      d.linkUpdateOnRename,
    ),
    linkAutocomplete: pick(
      parsed.linkAutocomplete,
      isBoolean,
      d.linkAutocomplete,
    ),
    linkHintChars: pick(parsed.linkHintChars, isHintChars, d.linkHintChars),
    linkStyle: pick(parsed.linkStyle, isBoolean, d.linkStyle),
    linkColor: pick(parsed.linkColor, isLinkColor, d.linkColor),
    linkHoverPreview: pick(
      parsed.linkHoverPreview,
      isHoverPreview,
      d.linkHoverPreview,
    ),
    tagAutocomplete: pick(parsed.tagAutocomplete, isBoolean, d.tagAutocomplete),
    tagPaneSort: pick(parsed.tagPaneSort, isTagSort, d.tagPaneSort),
    // Fail closed: anything but a literal true leaves AI off.
    aiEnabled: parsed.aiEnabled === true,
    aiMcpEnabled: pick(parsed.aiMcpEnabled, isBoolean, d.aiMcpEnabled),
    controlNotifyEdits: pick(
      parsed.controlNotifyEdits,
      isBoolean,
      d.controlNotifyEdits,
    ),
    pdfMaxSide: pick(parsed.pdfMaxSide, isPdfMaxSide, d.pdfMaxSide),
    pdfFormat: pick(parsed.pdfFormat, isPdfFormat, d.pdfFormat),
    pdfQuality: pick(parsed.pdfQuality, isPdfQuality, d.pdfQuality),
    pdfLockPages: pick(parsed.pdfLockPages, isBoolean, d.pdfLockPages),
    pdfWarnPages: pick(parsed.pdfWarnPages, isPdfWarnPages, d.pdfWarnPages),
    pdfPixelBudgetMp: pick(
      parsed.pdfPixelBudgetMp,
      isPdfPixelBudgetMp,
      d.pdfPixelBudgetMp,
    ),
    hotkeys: normalizeHotkeys(parsed.hotkeys),
    pluginSettings: normalizePluginSettings(parsed.pluginSettings),
    penPresets: normalizePenPresets(parsed.penPresets, d.penPresets),
    laserColor: pick(parsed.laserColor, isString, d.laserColor),
    laserSize: pick(
      parsed.laserSize,
      (v) => inRange(v, LASER_LIMITS.size),
      d.laserSize,
    ),
    laserDecayMs: pick(
      parsed.laserDecayMs,
      (v) => inRange(v, LASER_LIMITS.decayMs),
      d.laserDecayMs,
    ),
    laserLength: pick(
      parsed.laserLength,
      (v) => inRange(v, LASER_LIMITS.length),
      d.laserLength,
    ),
    ...normalizeHistoryPreferences(parsed as Record<string, unknown>),
    ...normalizeTabsPreferences(parsed as Record<string, unknown>),
    ...normalizeMemoryPreferences(parsed as Record<string, unknown>),
    ...normalizeSearchPreferences(parsed as Record<string, unknown>),
    ...normalizeKeysPreferences(parsed as Record<string, unknown>),
    ...normalizeServicesPreferences(parsed as Record<string, unknown>),
    ...normalizeToolStyles(parsed as Partial<Record<ToolField, unknown>>),
  };
}

export type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;

/** What getPreferences returns: a frozen snapshot, identity stable until a change. */
export type PreferencesSnapshot = DeepReadonly<VaultPreferences>;

const isPlain = (v: unknown): v is object =>
  typeof v === "object" && v !== null;

const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) {
    return true;
  }
  if (!isPlain(a) || !isPlain(b) || Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) {
    return false;
  }
  return ka.every((k) =>
    deepEqual(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
    ),
  );
};

/** Frozen deep copy; the caller's value is never frozen or retained. */
const freezeClone = <T>(v: T): T => {
  if (!isPlain(v)) {
    return v;
  }
  const copy: Record<string, unknown> | unknown[] = Array.isArray(v)
    ? v.map(freezeClone)
    : Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, freezeClone(x)]),
      );
  return Object.freeze(copy) as T;
};

/**
 * Next frozen snapshot built from `next`, reusing `prev`'s nested objects
 * where deep-equal (structural sharing). Returns `prev` itself when nothing
 * changed, so consumers can compare by identity.
 */
const toSnapshot = (
  prev: PreferencesSnapshot | null,
  next: DeepReadonly<Partial<VaultPreferences>> | PreferencesSnapshot,
): PreferencesSnapshot => {
  const out: Record<string, unknown> = {};
  let changed = prev === null;
  for (const [key, value] of Object.entries(next)) {
    const old = prev ? (prev as Record<string, unknown>)[key] : undefined;
    if (prev && deepEqual(old, value)) {
      out[key] = old;
    } else {
      out[key] = freezeClone(value);
      changed = true;
    }
  }
  if (prev && Object.keys(prev).length !== Object.keys(out).length) {
    changed = true;
  }
  return changed ? (Object.freeze(out) as PreferencesSnapshot) : prev!;
};

let defaultsSnapshot: PreferencesSnapshot | null = null;
const getDefaultsSnapshot = () =>
  (defaultsSnapshot ??= toSnapshot(null, DEFAULT_PREFERENCES));

// ---------------------------------------------------------------------------
// In-memory store (desktop config folder mode)
//
// In the Tauri app, settingsSync.ts attaches an in-memory store hydrated from
// config.toml + state.json. Reads come from memory; writes update memory
// synchronously and hand the change to the store's persist callback. Without
// an attached store (browser harness, unit tests) the module keeps its
// original localStorage behaviour.
// ---------------------------------------------------------------------------

type PersistCallback = (
  next: PreferencesSnapshot,
  prev: PreferencesSnapshot,
) => void;

let memoryStore: {
  prefs: PreferencesSnapshot;
  persist: PersistCallback;
} | null = null;

const listeners = new Set<() => void>();

/** Called after every preference change (any storage mode); returns unsubscribe. */
export function subscribePreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const notifyPreferences = () => {
  for (const listener of [...listeners]) {
    listener();
  }
};

export function attachPreferencesStore(
  initial: DeepReadonly<VaultPreferences>,
  persist: PersistCallback,
): void {
  memoryStore = { prefs: toSnapshot(null, initial), persist };
}

export function detachPreferencesStore(): void {
  memoryStore = null;
}

export function isPreferencesStoreAttached(): boolean {
  return memoryStore !== null;
}

/** Replace the in-memory preferences without persisting (used on reload). */
export function replaceStoredPreferences(
  next: DeepReadonly<VaultPreferences>,
): void {
  if (memoryStore) {
    memoryStore.prefs = toSnapshot(memoryStore.prefs, next);
  }
  notifyPreferences();
}

function getStorage(win?: Window | null): Storage | null {
  try {
    return (
      win?.localStorage ??
      (typeof window !== "undefined" ? window.localStorage : null)
    );
  } catch {
    return null;
  }
}

/** Raw preferences object stored in localStorage, if any (for migration). */
export function readLocalStoragePreferences(
  win?: Window | null,
): Partial<VaultPreferences> | null {
  const storage = getStorage(win);
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Partial<VaultPreferences>)
      : null;
  } catch {
    return null;
  }
}

// localStorage mode: the last stored string and its normalised preferences.
// getPreferences runs on many renders; re-parsing and re-normalising an
// unchanged string each time cost ~1 ms per call at 4x CPU throttling.
let parsedCache: { raw: string; prefs: PreferencesSnapshot } | null = null;

function readStoredRaw(win?: Window | null): string | null {
  const storage = getStorage(win);
  if (!storage) {
    return null;
  }
  try {
    return storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getPreferences(win?: Window | null): PreferencesSnapshot {
  if (memoryStore) {
    return memoryStore.prefs;
  }
  const raw = readStoredRaw(win);
  if (!raw) {
    parsedCache = null;
    return getDefaultsSnapshot();
  }
  if (parsedCache?.raw !== raw) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // unreadable: defaults, as for a missing value
    }
    if (!parsed || typeof parsed !== "object") {
      parsedCache = null;
      return getDefaultsSnapshot();
    }
    parsedCache = {
      raw,
      prefs: toSnapshot(
        parsedCache?.prefs ?? getDefaultsSnapshot(),
        normalizePreferences(parsed),
      ),
    };
  }
  return parsedCache.prefs;
}

/**
 * `trusted`: the caller's values are already in normalised form (for example
 * a string list and a string path), so the written snapshot goes straight into
 * the parse cache instead of being parsed and normalised again on the next
 * read (about 3 ms at 4x CPU throttling on vault open).
 */
export function updatePreferences(
  partial: DeepReadonly<Partial<VaultPreferences>>,
  win?: Window | null,
  trusted = false,
): PreferencesSnapshot {
  if (memoryStore) {
    const prev = memoryStore.prefs;
    const next = toSnapshot(prev, { ...prev, ...partial });
    memoryStore.prefs = next;
    try {
      memoryStore.persist(next, prev);
    } catch {
      // persistence failures are reported by the store, never thrown here
    }
    notifyPreferences();
    return next;
  }
  const current = getPreferences(win);
  const next = toSnapshot(current, { ...current, ...partial });
  const storage = getStorage(win);
  let stored = false;
  let written: string | null = null;
  if (storage) {
    try {
      written = JSON.stringify(next);
      storage.setItem(STORAGE_KEY, written);
      stored = true;
    } catch {
      // quota or security error ignored gracefully
    }
  }
  if (stored && trusted && written !== null) {
    parsedCache = { raw: written, prefs: next };
    notifyPreferences();
    return next;
  }
  notifyPreferences();
  // Re-read so the returned snapshot is the one later reads share identity with.
  return stored ? getPreferences(win) : next;
}

export function loadPreferences(win?: Window | null): PreferencesSnapshot {
  return getPreferences(win);
}

export function savePreferences(
  partial: DeepReadonly<Partial<VaultPreferences>>,
  win?: Window | null,
): PreferencesSnapshot {
  return updatePreferences(partial, win);
}

export function resolveTheme(
  theme: VaultTheme,
  win?: Window | null,
): "light" | "dark" {
  if (theme === "light" || theme === "dark") {
    return theme;
  }
  if (win?.matchMedia?.("(prefers-color-scheme: dark)")?.matches) {
    return "dark";
  }
  return "light";
}

export function getTheme(win?: Window | null): VaultTheme {
  return getPreferences(win).theme;
}

export function setTheme(theme: VaultTheme, win?: Window | null): void {
  updatePreferences({ theme }, win);
}

export function getAutosaveDelayMs(win?: Window | null): number {
  return getPreferences(win).autosaveDelayMs;
}

export function setAutosaveDelayMs(delayMs: number, win?: Window | null): void {
  updatePreferences({ autosaveDelayMs: delayMs }, win);
}

export function getEditorDefaults(win?: Window | null) {
  const prefs = getPreferences(win);
  return {
    defaultFontFamily: prefs.defaultFontFamily,
    defaultFontSize: prefs.defaultFontSize,
    defaultStrokeColor: prefs.defaultStrokeColor,
    defaultBackgroundColor: prefs.defaultBackgroundColor,
    defaultFillStyle: prefs.defaultFillStyle,
    defaultStrokeWidth: prefs.defaultStrokeWidth,
    defaultRoughness: prefs.defaultRoughness,
    defaultCanvasBackground: prefs.defaultCanvasBackground,
  };
}

export function setEditorDefaults(
  defaults: Partial<
    Pick<
      VaultPreferences,
      | "defaultFontFamily"
      | "defaultFontSize"
      | "defaultStrokeColor"
      | "defaultBackgroundColor"
      | "defaultFillStyle"
      | "defaultStrokeWidth"
      | "defaultRoughness"
      | "defaultCanvasBackground"
    >
  >,
  win?: Window | null,
): void {
  updatePreferences(defaults, win);
}

export function getRecentVaults(win?: Window | null): readonly string[] {
  return getPreferences(win).recentVaults;
}

export function getLastVaultPath(win?: Window | null): string | null {
  return getPreferences(win).lastVaultPath;
}

export function addRecentVault(vaultPath: string, win?: Window | null): void {
  if (!vaultPath) {
    return;
  }
  const current = getRecentVaults(win);
  const filtered = current.filter((p) => p !== vaultPath);
  const updated = [vaultPath, ...filtered].slice(0, 10);
  updatePreferences(
    { recentVaults: updated, lastVaultPath: vaultPath },
    win,
    true,
  );
}

export function removeRecentVault(
  vaultPath: string,
  win?: Window | null,
): void {
  const current = getRecentVaults(win);
  const updated = current.filter((p) => p !== vaultPath);
  updatePreferences({ recentVaults: updated }, win);
}

export function getExpandedFolders(
  vaultKey: string,
  win?: Window | null,
): readonly string[] {
  const prefs = getPreferences(win);
  return prefs.expandedFolders[vaultKey] ?? [""];
}

export function setExpandedFolders(
  vaultKey: string,
  folders: string[],
  win?: Window | null,
): void {
  const current = getPreferences(win);
  const nextExpanded = {
    ...current.expandedFolders,
    [vaultKey]: folders,
  };
  updatePreferences({ expandedFolders: nextExpanded }, win);
}

export function toggleFolderExpanded(
  vaultKey: string,
  folderPath: string,
  win?: Window | null,
): boolean {
  const current = new Set(getExpandedFolders(vaultKey, win));
  let isExpanded: boolean;
  if (current.has(folderPath)) {
    current.delete(folderPath);
    isExpanded = false;
  } else {
    current.add(folderPath);
    isExpanded = true;
  }
  setExpandedFolders(vaultKey, Array.from(current), win);
  return isExpanded;
}

export function getNavigatorCollapsed(win?: Window | null): boolean {
  return getPreferences(win).navigatorCollapsed;
}

export function setNavigatorCollapsed(
  collapsed: boolean,
  win?: Window | null,
): void {
  updatePreferences({ navigatorCollapsed: collapsed }, win);
}
