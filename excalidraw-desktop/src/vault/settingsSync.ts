/**
 * Bridge between the synchronous preferences API (preferences.ts) and the
 * desktop config folder owned by the Rust side:
 *
 *   ~/.config/vaultdraw/config.toml      user settings (hand-editable)
 *   ~/.local/state/vaultdraw/state.json  machine state
 *
 * Contract: personal/planning/config.md. In a plain browser (Playwright
 * harness, Vitest without injected deps) nothing here touches Tauri and
 * preferences.ts keeps its localStorage behaviour.
 */
import {
  BACKGROUND_PATTERN_LIMITS,
  BACKGROUND_PATTERN_TYPES,
} from "@excalidraw/excalidraw/data/backgroundPattern";
import {
  PAGE_LIMITS,
  PAGE_SIZE_PRESET_IDS,
  isPageLayout,
  isPageOrientation,
  isPageSize,
} from "@excalidraw/excalidraw/data/pageSetup";

import {
  MAX_THUMB_CACHE_MB,
  MAX_THUMB_MAX_ELEMENTS,
  MIN_THUMB_CACHE_MB,
  MIN_THUMB_MAX_ELEMENTS,
} from "../thumbnails/limits";

import {
  BUILTIN_COMMANDS,
  defaultKeys,
  isCommandId,
} from "../commands/commands";
import { detectPlatform } from "../commands/keys";
import {
  HISTORY_MAPPINGS,
  type HistoryField,
} from "../history/historySettings";
import { TABS_MAPPINGS, type TabsField } from "../tabs/tabsSettings";
import { NOTES_MAPPINGS, type NotesField } from "../notes/notesSettings";
import { MEMORY_MAPPINGS, type MemoryField } from "../memory/memorySettings";
import { SYNC_MAPPINGS, type SyncField } from "../sync/syncSettings";
import { setSafeStart, type SafeStart } from "../safeStart/state";
import { parseBisect, setBisect } from "../extensionSwitches/bisectState";
import { SEARCH_MAPPINGS, type SearchField } from "../search/searchSettings";
import {
  LAYOUT_MAPPINGS,
  layoutPresetProblems,
  type LayoutField,
} from "../layout/layoutSettings";
import { LAYOUT_PRESET_PREFIX } from "../layout/layoutCommands";
import { parseUserCommands } from "../commands/userCommands";
import {
  EXTENSION_MAPPINGS,
  type ExtensionField,
} from "../extensionSwitches/extensionSettings";
import {
  LEADER_TOKEN,
  normalizeKeys,
  parseSequence,
} from "../commands/keySequence";
import {
  KEYS_MAPPINGS,
  parseKeysExtras,
  type KeysField,
} from "../commands/keySettings";
import {
  SPECULATIVE_MAPPINGS,
  type SpeculativeField,
} from "../speculative/speculativeSettings";
import {
  SERVICES_MAPPINGS,
  type ServicesField,
} from "../services/servicesSettings";
import { PDF_IMPORT_LIMITS } from "../pdfImport/types";
import { WATCHDOG_LIMITS } from "../watchdog/limits";

import { inRange, LASER_LIMITS } from "../pens/laserSettings";
import {
  isPenPresets,
  MAX_PEN_PRESETS,
  penPresetProblem,
  withPenDefaults,
} from "../pens/penPresets";

import {
  isToolStyle,
  orderedStyle,
  TOOL_DEFAULT_TOOLS,
  TOOL_STYLE_KEYS,
  toolConfigKey,
  TOOL_FIELDS,
  toolField,
  toolStyleProblem,
  type ToolField,
  type ToolStyle,
} from "../toolDefaults/toolStyles";

import { setImporterOverrides } from "../plugins/importerMap";
import { resolveOfficial } from "../plugins/officialPlugins";

import { isWatchPollMs, WATCH_POLL_LIMITS } from "./watchPoll";

import { isNonSettingsBatch } from "./configPaths";
import { isWindowDecorations } from "./windowChrome";

import {
  isPluginId,
  parsePluginTable,
  pluginSettingsChanges,
  sortedPluginSettings,
} from "./pluginSettingsTable";
import { isSortOrder, SORT_ORDERS } from "./sortOrder";
import {
  buildKnownIndex,
  findUnknownKeys,
  NATIVE_KEYS,
  unknownKeyMessage,
  type KnownIndex,
} from "./configKeys";
import { layerFileName, sourceFileOf } from "./configSources";
import { isTauriAvailable } from "./DesktopVaultRepository";
import {
  attachPreferencesStore,
  MAX_ZOOM,
  MIN_ZOOM,
  DEFAULT_PREFERENCES,
  detachPreferencesStore,
  getPreferences,
  isExpandedFolders,
  isPageMode,
  isPagePaperTheme,
  isPageSide,
  isThemeInstallMaxKb,
  isThemesIndexTtlHours,
  isThemesIndexUrl,
  isPaperColor,
  isPaperMajorEvery,
  isHintChars,
  isHoverPreview,
  isLinkColor,
  isNewLinkFormat,
  isOpenModifier,
  isShapeLinkFormat,
  isTagSort,
  isPdfFormat,
  isPdfMaxSide,
  isPdfPixelBudgetMp,
  isPdfQuality,
  isPdfWarnPages,
  isWatchdogGraceMs,
  isUpdateOnRename,
  isPaperOpacity,
  isPaperSpacing,
  isPaperStyle,
  normalizeExportOptions,
  isVaultTheme,
  readLocalStoragePreferences,
  replaceStoredPreferences,
  isPluginImporters,
  isPluginStorageKb,
  isSceneMaxOps,
  MAX_PLUGIN_STORAGE_KB,
  MAX_SCENE_MAX_OPS,
  MIN_PLUGIN_STORAGE_KB,
  type DeepReadonly,
  type PreferencesSnapshot,
  type VaultPreferences,
} from "./preferences";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InvokeFn = <T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export type ListenFn = <T = unknown>(
  event: string,
  handler: (event: { payload: T }) => void,
) => Promise<() => void>;

export interface ConfigErrorPayload {
  message: string;
  line: number | null;
}

/** One config layer as `load_settings` reports it (lowest first). */
export interface LayerPayload {
  id: number;
  kind: "config" | "overrides" | "include" | "profile";
  /** File name: `config.toml`, `overrides.toml` or the included file's name. */
  name?: string;
  /** For an included file: the file that names it. */
  from?: string | null;
  path: string;
  status: "ok" | "missing" | "error";
  error: ConfigErrorPayload | null;
  /** The layer's own parsed content; null unless `ok`. */
  config: Record<string, unknown> | null;
}

const layerFile = (layer: LayerPayload) => layerFileName(layer);

export interface LoadSettingsResult {
  /** This launch's safe start (Rust launch check); null in a normal start. */
  safeStart?: SafeStart | null;
  /** The extension bisect this launch runs under (launch.rs). */
  bisect?: unknown;
  configDir: string;
  configPath: string;
  statePath: string;
  config: Record<string, unknown> | null;
  configError: ConfigErrorPayload | null;
  /** Why overrides.toml was skipped (absent from older backends). */
  overridesError?: ConfigErrorPayload | null;
  overridesPath?: string;
  layers?: LayerPayload[];
  /** Include problems that name no file (cycles, nesting, caps). */
  includeWarnings?: string[];
  /** The active profile (null = default) and every profile folder. */
  profile?: string | null;
  profiles?: string[];
  state: Record<string, unknown> | null;
}

export interface ConfigChange {
  key: string;
  value: unknown;
  /** Built-in value of the key: `value: null` with it means "use the default". */
  default?: unknown;
}

/** `include`: an included file or include rule was skipped (a warning, the rest applies). */
export type SettingsProblemKind =
  | "parse"
  | "invalid"
  | "unknown"
  | "io"
  | "include";

export interface SettingsProblem {
  kind: SettingsProblemKind;
  /** Human readable, ready for the banner. */
  message: string;
  /** Dotted config key for `invalid` and `unknown` problems. */
  key?: string;
  line?: number | null;
}

export interface SettingsStatus {
  /** "tauri" when backed by the config folder, "browser" for localStorage. */
  mode: "tauri" | "browser";
  configDir: string | null;
  configPath: string | null;
  statePath: string | null;
  /** Where Settings saves what you change (the state folder). */
  overridesPath?: string | null;
  /** The active profile (null = the default) and the profile folders. */
  profile?: string | null;
  profiles?: string[];
  /**
   * The config layers, lowest first. A layer that failed to parse on a reload keeps
   * the content of its last good read, so chips still show where values come from.
   */
  layers?: LayerPayload[];
  problems: SettingsProblem[];
}

export interface SettingsDeps {
  invoke?: InvokeFn;
  listen?: ListenFn;
  /** Force config-folder mode (tests). Defaults to isTauriAvailable(win). */
  tauri?: boolean;
  /** write_state debounce, default 300 ms. */
  stateDebounceMs?: number;
}

/** Messages already logged this session, so reloads never repeat them. */
const loggedProblems = new Set<string>();
const MAX_LOGGED = 1000;

/** console.warn each problem once per session, across reloads. */
export function logProblems(problems: readonly SettingsProblem[]): void {
  for (const { message } of problems) {
    if (!loggedProblems.has(message)) {
      if (loggedProblems.size >= MAX_LOGGED) {
        loggedProblems.clear();
      }
      loggedProblems.add(message);
      console.warn(message);
    }
  }
}

/** Fired on window when a reload changed the preferences. detail = prefs. */
export const PREFERENCES_CHANGED_EVENT = "vault-preferences-changed";
/** Fired on window when the settings status (problems, paths) changed. */
export const SETTINGS_STATUS_EVENT = "vault-settings-status";

// ---------------------------------------------------------------------------
// Mapping table (preference field <-> config.toml dotted key)
// ---------------------------------------------------------------------------

type ConfigField =
  | "colorTheme"
  | "networkEnabled"
  | "networkAllowThemes"
  | "networkAllowPlugins"
  | "pluginsRegistryUrl"
  | "pluginsRegistryTtlHours"
  | "themeInstallMaxKb"
  | "themesIndexUrl"
  | "themesIndexTtlHours"
  | "themesPreviews"
  | "theme"
  | "syncCanvas"
  | "defaultCanvasBackground"
  | "paperStyle"
  | "paperSpacing"
  | "paperColor"
  | "paperOpacity"
  | "paperMajorEvery"
  | "paperMarginLine"
  | "pageMode"
  | "pageLayout"
  | "pageSize"
  | "pageOrientation"
  | "pageWidth"
  | "pageHeight"
  | "pagePaperTheme"
  | "defaultFontFamily"
  | "defaultFontSize"
  | "defaultStrokeColor"
  | "defaultBackgroundColor"
  | "defaultFillStyle"
  | "defaultStrokeWidth"
  | "defaultRoughness"
  | "autosaveDelayMs"
  | "accentColor"
  | "snippets"
  | "zoom"
  | "confirmDelete"
  | "showTagChips"
  | "deferHomePane"
  | "thumbnails"
  | "thumbnailMaxElements"
  | "thumbnailCacheMb"
  | "activityBar"
  | "pluginsEnabled"
  | "networkAllowedHosts"
  | "pluginsDisabled"
  | "pluginImporters"
  | "pluginsStorageLimitKb"
  | "pluginsSceneMaxOps"
  | "pluginsStatusBar"
  | "pluginsToolbar"
  | "activityBarOrder"
  | "activityBarHidden"
  | "libraryFolders"
  | "libraryDefault"
  | "navigatorSort"
  | "newDrawingFolder"
  | "templatesFolder"
  | "linkNewFormat"
  | "linkShapeFormat"
  | "linkOpenModifier"
  | "linkUpdateOnRename"
  | "linkAutocomplete"
  | "linkHintChars"
  | "linkStyle"
  | "linkColor"
  | "linkHoverPreview"
  | "tagAutocomplete"
  | "tagPaneSort"
  | "aiEnabled"
  | "aiMcpEnabled"
  | "controlNotifyEdits"
  | "watchdogEnabled"
  | "watchdogGraceMs"
  | "filesWatchPollMs"
  | "windowDecorations"
  | "pdfMaxSide"
  | "pdfFormat"
  | "pdfQuality"
  | "pdfLockPages"
  | "pdfWarnPages"
  | "pdfPixelBudgetMp"
  | "penPresets"
  | "laserColor"
  | "laserSize"
  | "laserDecayMs"
  | "laserLength"
  | HistoryField
  | TabsField
  | NotesField
  | MemoryField
  | SyncField
  | SearchField
  | LayoutField
  | ExtensionField
  | KeysField
  | ServicesField
  | SpeculativeField
  | ToolField;

export interface ConfigMapping {
  field: ConfigField;
  key: string;
  /** Human description of what is accepted, used in problem messages. */
  expected: string | ((value: unknown) => string);
  /** Fills in hand-written gaps before validation; the result is stored. */
  normalize?: (value: unknown) => unknown;
  valid: (value: unknown) => boolean;
  /** Used instead of the default when the value is invalid (fail closed). */
  onInvalid?: unknown;
}

/** Every id in Excalidraw's FONT_FAMILY (packages/common/src/constants.ts). */
export const EXCALIDRAW_FONT_IDS = [1, 2, 3, 5, 6, 7, 8, 9, 10] as const;
export const FILL_STYLES = ["solid", "hachure", "cross-hatch"] as const;

const COLOR_RE =
  /^(#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|transparent|[a-z]+)$/i;

const isColor = (v: unknown) => typeof v === "string" && COLOR_RE.test(v);
const isStringList = (v: unknown) =>
  Array.isArray(v) && v.every((x) => typeof x === "string");
const isInt = (v: unknown) => typeof v === "number" && Number.isInteger(v);
const isPositive = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1000;

const ACCENT_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * A folder inside the vault: relative, "/"-separated, no "." or ".." parts,
 * no backslash, drive letter or reserved metadata folder. "" = unset.
 * The native side validates again when the folder is created.
 */
export const isVaultRelativeFolder = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length <= 1024 &&
  !v.includes("\\") &&
  !v.includes("\0") &&
  !v.startsWith("/") &&
  !/^[a-z]:/i.test(v) &&
  v
    .split("/")
    .every(
      (part, i, all) =>
        (part === "" ? all.length === 1 && i === 0 : true) &&
        part !== "." &&
        part !== ".." &&
        part.toLowerCase() !== ".excalidraw-vault",
    );

const CORE_MAPPING: readonly ConfigMapping[] = [
  {
    field: "colorTheme",
    key: "appearance.theme",
    expected: "a theme name",
    valid: (v) => typeof v === "string" && v.trim().length > 0,
  },
  {
    field: "networkEnabled",
    key: "network.enabled",
    expected: "true or false",
    valid: (v) => typeof v === "boolean",
  },
  {
    field: "networkAllowThemes",
    key: "network.allow_themes",
    expected: "true or false (leave it out to be asked)",
    valid: (v) => typeof v === "boolean",
  },
  {
    field: "networkAllowPlugins",
    key: "network.allow_plugins",
    expected: "true or false (leave it out to be asked)",
    valid: (v) => typeof v === "boolean",
  },
  {
    field: "networkAllowedHosts",
    key: "network.allowed_hosts",
    expected: 'a list of host names like ["themes.example.org"]',
    valid: (v) =>
      isStringList(v) && (v as string[]).every((x) => x.trim() !== ""),
  },
  {
    field: "pluginsRegistryUrl",
    key: "plugins.registry_url",
    expected: "an https address",
    valid: isThemesIndexUrl,
  },
  {
    field: "pluginsRegistryTtlHours",
    key: "plugins.registry_ttl_hours",
    expected: "a whole number of hours between 0 and 720",
    valid: isThemesIndexTtlHours,
  },
  {
    field: "themeInstallMaxKb",
    key: "themes.max_install_kb",
    expected: "a whole number of KiB between 1 and 256",
    valid: isThemeInstallMaxKb,
  },
  {
    field: "themesIndexUrl",
    key: "themes.index_url",
    expected: "an https address",
    valid: isThemesIndexUrl,
  },
  {
    field: "themesIndexTtlHours",
    key: "themes.index_ttl_hours",
    expected: "a whole number of hours between 0 and 720",
    valid: isThemesIndexTtlHours,
  },
  {
    field: "themesPreviews",
    key: "themes.previews",
    expected: "true or false",
    valid: (v) => typeof v === "boolean",
  },
  {
    field: "theme",
    key: "appearance.mode",
    expected: '"light", "dark" or "system"',
    valid: isVaultTheme,
  },
  {
    field: "syncCanvas",
    key: "appearance.sync_canvas",
    expected: "true or false",
    valid: (v) => typeof v === "boolean",
  },
  {
    field: "showTagChips",
    key: "interface.show_tag_chips",
    expected: "true or false",
    valid: (v) => typeof v === "boolean",
  },
  {
    field: "deferHomePane",
    key: "interface.defer_home_pane",
    expected: "true or false",
    valid: (v) => typeof v === "boolean",
  },
  {
    field: "thumbnails",
    key: "interface.thumbnails",
    expected: "true or false",
    valid: (v) => typeof v === "boolean",
  },
  {
    field: "thumbnailMaxElements",
    key: "interface.thumbnail_max_elements",
    expected: `an integer between ${MIN_THUMB_MAX_ELEMENTS} and ${MAX_THUMB_MAX_ELEMENTS}`,
    valid: (v) =>
      isInt(v) &&
      (v as number) >= MIN_THUMB_MAX_ELEMENTS &&
      (v as number) <= MAX_THUMB_MAX_ELEMENTS,
  },
  {
    field: "thumbnailCacheMb",
    key: "interface.thumbnail_cache_mb",
    expected: `an integer between ${MIN_THUMB_CACHE_MB} and ${MAX_THUMB_CACHE_MB} (megabytes)`,
    valid: (v) =>
      isInt(v) &&
      (v as number) >= MIN_THUMB_CACHE_MB &&
      (v as number) <= MAX_THUMB_CACHE_MB,
  },
  {
    field: "activityBar",
    key: "interface.activity_bar",
    expected: "true or false",
    valid: (v) => typeof v === "boolean",
  },
  {
    field: "activityBarOrder",
    key: "interface.activity_bar_order",
    expected: 'a list of entry ids like ["library", "history"]',
    valid: isStringList,
  },
  {
    field: "activityBarHidden",
    key: "interface.activity_bar_hidden",
    expected: 'a list of entry ids like ["tags"]',
    valid: isStringList,
  },
  {
    field: "libraryFolders",
    key: "library.folders",
    expected: 'a list of folder paths like ["~/Documents/Libraries"]',
    valid: (v) =>
      isStringList(v) && (v as string[]).every((x) => x.trim() !== ""),
  },
  {
    field: "libraryDefault",
    key: "library.default",
    expected: 'a library name like "Arrows", or "" for Personal',
    valid: (v) => typeof v === "string",
  },
  {
    field: "pluginsEnabled",
    key: "plugins.enabled",
    expected: 'a list of plugin ids like ["hello-command"]',
    valid: (v) =>
      Array.isArray(v) &&
      v.every((x) => typeof x === "string" && isPluginId(x)),
  },
  {
    field: "pluginsDisabled",
    key: "plugins.disabled",
    expected: 'a list of official plugin ids you turned off, like ["gallery"]',
    valid: (v) =>
      Array.isArray(v) &&
      v.every((x) => typeof x === "string" && isPluginId(x)),
  },
  {
    field: "pluginImporters",
    key: "plugins.importers",
    expected:
      'a table like { txt = "text-import" } (extension = plugin id, "" for none)',
    valid: isPluginImporters,
  },
  {
    field: "pluginsStorageLimitKb",
    key: "plugins.storage_limit_kb",
    expected: `an integer between ${MIN_PLUGIN_STORAGE_KB} and ${MAX_PLUGIN_STORAGE_KB}`,
    valid: isPluginStorageKb,
  },
  {
    field: "pluginsSceneMaxOps",
    key: "plugins.scene_max_ops",
    expected: `an integer between 1 and ${MAX_SCENE_MAX_OPS}`,
    valid: isSceneMaxOps,
  },
  {
    field: "pluginsStatusBar",
    key: "plugins.status_bar",
    expected: "true or false",
    valid: (v) => typeof v === "boolean",
  },
  {
    field: "pluginsToolbar",
    key: "plugins.toolbar",
    expected: "true or false",
    valid: (v) => typeof v === "boolean",
  },
  {
    field: "defaultCanvasBackground",
    key: "appearance.canvas_background",
    expected: 'a colour like "#ffffff"',
    valid: isColor,
  },
  {
    field: "paperStyle",
    key: "paper.style",
    expected: `"plain", ${BACKGROUND_PATTERN_TYPES.map((t) => `"${t}"`).join(
      ", ",
    )}`,
    valid: isPaperStyle,
  },
  {
    field: "paperSpacing",
    key: "paper.spacing",
    expected: `0 (the style's preset) or a number between ${BACKGROUND_PATTERN_LIMITS.spacing.min} and ${BACKGROUND_PATTERN_LIMITS.spacing.max}`,
    valid: isPaperSpacing,
  },
  {
    field: "paperColor",
    key: "paper.color",
    expected: 'a colour like "#8899aa", or "" for automatic',
    valid: isPaperColor,
  },
  {
    field: "paperOpacity",
    key: "paper.opacity",
    expected: `a number between ${BACKGROUND_PATTERN_LIMITS.opacity.min} and ${BACKGROUND_PATTERN_LIMITS.opacity.max}`,
    valid: isPaperOpacity,
  },
  {
    field: "paperMajorEvery",
    key: "paper.major_every",
    expected: `0 (the style's preset) or a whole number between ${BACKGROUND_PATTERN_LIMITS.majorEvery.min} and ${BACKGROUND_PATTERN_LIMITS.majorEvery.max}`,
    valid: isPaperMajorEvery,
  },
  {
    field: "paperMarginLine",
    key: "paper.margin_line",
    expected: "true or false",
    valid: (v) => typeof v === "boolean",
  },
  {
    field: "pageMode",
    key: "page.mode",
    expected: '"normal" (infinite canvas) or "page"',
    valid: isPageMode,
  },
  {
    field: "pageLayout",
    key: "page.layout",
    expected: '"continuous" or "separate"',
    valid: isPageLayout,
  },
  {
    field: "pageSize",
    key: "page.size",
    expected: `${[...PAGE_SIZE_PRESET_IDS, "custom"]
      .map((id) => `"${id}"`)
      .join(", ")}`,
    valid: isPageSize,
  },
  {
    field: "pageOrientation",
    key: "page.orientation",
    expected: '"portrait" or "landscape"',
    valid: isPageOrientation,
  },
  {
    field: "pageWidth",
    key: "page.width",
    expected: `0 (unset) or a whole number of pixels between ${PAGE_LIMITS.side.min} and ${PAGE_LIMITS.side.max}`,
    valid: isPageSide,
  },
  {
    field: "pageHeight",
    key: "page.height",
    expected: `0 (unset) or a whole number of pixels between ${PAGE_LIMITS.side.min} and ${PAGE_LIMITS.side.max}`,
    valid: isPageSide,
  },
  {
    field: "pagePaperTheme",
    key: "page.paper_theme",
    expected: '"normal", "old_school" or "match"',
    valid: isPagePaperTheme,
  },
  {
    field: "defaultFontFamily",
    key: "editor.font_family",
    expected: `one of ${EXCALIDRAW_FONT_IDS.join(", ")}`,
    valid: (v) =>
      isInt(v) &&
      (EXCALIDRAW_FONT_IDS as readonly number[]).includes(v as number),
  },
  {
    field: "defaultFontSize",
    key: "editor.font_size",
    expected: "a positive number",
    valid: isPositive,
  },
  {
    field: "defaultStrokeColor",
    key: "editor.stroke_color",
    expected: 'a colour like "#1e1e1e"',
    valid: isColor,
  },
  {
    field: "defaultBackgroundColor",
    key: "editor.background_color",
    expected: 'a colour like "transparent"',
    valid: isColor,
  },
  {
    field: "defaultFillStyle",
    key: "editor.fill_style",
    expected: FILL_STYLES.map((s) => `"${s}"`).join(", "),
    valid: (v) => (FILL_STYLES as readonly unknown[]).includes(v),
  },
  {
    field: "defaultStrokeWidth",
    key: "editor.stroke_width",
    expected: "a positive number",
    valid: isPositive,
  },
  {
    field: "defaultRoughness",
    key: "editor.roughness",
    expected: "0, 1 or 2",
    valid: (v) => v === 0 || v === 1 || v === 2,
  },
  {
    field: "autosaveDelayMs",
    key: "saving.autosave_delay_ms",
    expected: "an integer between 0 and 600000",
    valid: (v) => isInt(v) && (v as number) >= 0 && (v as number) <= 600000,
  },
  {
    field: "accentColor",
    key: "appearance.accent_color",
    expected: 'a colour like "#6965db", or "" for the theme\'s own',
    valid: (v) => v === "" || (typeof v === "string" && ACCENT_RE.test(v)),
  },
  {
    field: "snippets",
    key: "appearance.snippets",
    expected: 'a list of snippet names like ["wide-sidebar"]',
    valid: isStringList,
  },
  {
    field: "zoom",
    key: "interface.zoom",
    expected: `a whole number between ${MIN_ZOOM} and ${MAX_ZOOM} (percent)`,
    valid: (v) =>
      isInt(v) && (v as number) >= MIN_ZOOM && (v as number) <= MAX_ZOOM,
  },
  {
    field: "confirmDelete",
    key: "files.confirm_delete",
    expected: "true or false",
    valid: (v) => typeof v === "boolean",
  },
  {
    field: "navigatorSort",
    key: "navigator.sort",
    expected: SORT_ORDERS.map((s) => `"${s}"`).join(", "),
    valid: isSortOrder,
  },
  {
    field: "newDrawingFolder",
    key: "files.new_drawing_folder",
    expected: 'a folder path inside the vault like "Sketches/Inbox", or ""',
    valid: isVaultRelativeFolder,
  },
  {
    // Never empty: "" is invalid (reported, ignored) so the effective value
    // falls back to "Templates".
    field: "templatesFolder",
    key: "files.templates_folder",
    expected: 'a non-empty folder path inside the vault like "Templates"',
    valid: (v) => isVaultRelativeFolder(v) && v !== "",
  },
  {
    field: "linkNewFormat",
    key: "links.new_link_format",
    expected: '"shortest", "relative" or "absolute"',
    valid: isNewLinkFormat,
  },
  {
    field: "linkShapeFormat",
    key: "links.shape_link_format",
    expected: '"wikilink" or "vaultdraw-url"',
    valid: isShapeLinkFormat,
  },
  {
    field: "linkOpenModifier",
    key: "links.open_modifier",
    expected: '"mod", "alt", "ctrl" or "shift"',
    valid: isOpenModifier,
  },
  {
    field: "linkUpdateOnRename",
    key: "links.update_on_rename",
    expected: 'true, false or "ask"',
    valid: isUpdateOnRename,
  },
  {
    field: "linkAutocomplete",
    key: "links.autocomplete",
    expected: "true or false",
    valid: (v) => typeof v === "boolean",
  },
  {
    field: "linkHintChars",
    key: "links.hint_chars",
    expected:
      'at least 2 different lowercase characters with no spaces, like "asdfghjkl"',
    valid: isHintChars,
  },
  {
    field: "linkStyle",
    key: "links.style_links",
    expected: "true or false",
    valid: (v) => typeof v === "boolean",
  },
  {
    field: "linkColor",
    key: "links.color",
    expected: '"accent" or a hex colour like "#6965db"',
    valid: isLinkColor,
  },
  {
    field: "linkHoverPreview",
    key: "links.hover_preview",
    expected: '"always", "modifier" or "off"',
    valid: isHoverPreview,
  },
  {
    field: "tagAutocomplete",
    key: "tags.autocomplete",
    expected: "true or false",
    valid: (v) => typeof v === "boolean",
  },
  {
    field: "tagPaneSort",
    key: "tags.pane_sort",
    expected: '"name" or "count"',
    valid: isTagSort,
  },
  {
    field: "aiEnabled",
    key: "ai.enabled",
    expected: "true or false",
    valid: (v) => typeof v === "boolean",
  },
  {
    field: "aiMcpEnabled",
    key: "ai.mcp_enabled",
    expected: "true or false",
    valid: (v) => typeof v === "boolean",
    // The app refuses AI tools on a wrong type; Settings must show it off too.
    onInvalid: false,
  },
  {
    field: "controlNotifyEdits",
    key: "control.notify_edits",
    expected: "true or false",
    valid: (v) => typeof v === "boolean",
  },
  {
    field: "watchdogEnabled",
    key: "watchdog.enabled",
    expected: "true or false",
    valid: (v) => typeof v === "boolean",
  },
  {
    field: "watchdogGraceMs",
    key: "watchdog.grace_ms",
    expected: `a whole number of milliseconds between ${WATCHDOG_LIMITS.graceMs.min} and ${WATCHDOG_LIMITS.graceMs.max}`,
    valid: isWatchdogGraceMs,
  },
  {
    field: "filesWatchPollMs",
    key: "files.watch_poll_ms",
    expected: `a whole number of milliseconds between ${WATCH_POLL_LIMITS.min} and ${WATCH_POLL_LIMITS.max}`,
    valid: isWatchPollMs,
  },
  {
    field: "windowDecorations",
    key: "window.decorations",
    expected: '"custom" or "native"',
    valid: isWindowDecorations,
  },
  {
    field: "pdfMaxSide",
    key: "pdf_import.max_side",
    expected: `a whole number of pixels between ${PDF_IMPORT_LIMITS.maxSide.min} and ${PDF_IMPORT_LIMITS.maxSide.max}`,
    valid: isPdfMaxSide,
  },
  {
    field: "pdfFormat",
    key: "pdf_import.format",
    expected: '"jpeg" or "png"',
    valid: isPdfFormat,
  },
  {
    field: "pdfQuality",
    key: "pdf_import.quality",
    expected: `a number between ${PDF_IMPORT_LIMITS.quality.min} and ${PDF_IMPORT_LIMITS.quality.max}`,
    valid: isPdfQuality,
  },
  {
    field: "pdfLockPages",
    key: "pdf_import.lock_pages",
    expected: "true or false",
    valid: (v) => typeof v === "boolean",
  },
  {
    field: "pdfWarnPages",
    key: "pdf_import.warn_pages",
    expected: `a whole number between ${PDF_IMPORT_LIMITS.warnPages.min} and ${PDF_IMPORT_LIMITS.warnPages.max}`,
    valid: isPdfWarnPages,
  },
  {
    field: "pdfPixelBudgetMp",
    key: "pdf_import.pixel_budget_mp",
    expected: `a number of megapixels between ${PDF_IMPORT_LIMITS.pixelBudgetMp.min} and ${PDF_IMPORT_LIMITS.pixelBudgetMp.max}`,
    valid: isPdfPixelBudgetMp,
  },
  {
    field: "penPresets",
    key: "pens.presets",
    expected: (value) => {
      if (!Array.isArray(value)) {
        return `a list of 1 to ${MAX_PEN_PRESETS} pens`;
      }
      if (value.length < 1 || value.length > MAX_PEN_PRESETS) {
        return `1 to ${MAX_PEN_PRESETS} pens, found ${value.length}`;
      }
      const index = value.findIndex((p) => penPresetProblem(p) !== null);
      return `pen ${index + 1} ${penPresetProblem(value[index])}`;
    },
    normalize: withPenDefaults,
    valid: isPenPresets,
  },
  {
    field: "laserColor",
    key: "laser.color",
    expected: 'a colour like "red" or "#e03131"',
    valid: isColor,
  },
  {
    field: "laserSize",
    key: "laser.size",
    expected: `a number between ${LASER_LIMITS.size.min} and ${LASER_LIMITS.size.max} (pixels)`,
    valid: (v) => inRange(v, LASER_LIMITS.size),
  },
  {
    field: "laserDecayMs",
    key: "laser.decay_ms",
    expected: `a number between ${LASER_LIMITS.decayMs.min} and ${LASER_LIMITS.decayMs.max} (milliseconds)`,
    valid: (v) => inRange(v, LASER_LIMITS.decayMs),
  },
  {
    field: "laserLength",
    key: "laser.length",
    expected: `a number between ${LASER_LIMITS.length.min} and ${LASER_LIMITS.length.max} (trail points)`,
    valid: (v) => inRange(v, LASER_LIMITS.length),
  },
];

/** One `[tools.<tool>]` table per styled tool. */
const TOOL_MAPPINGS: readonly ConfigMapping[] = TOOL_DEFAULT_TOOLS.map(
  (tool) => ({
    field: toolField(tool),
    key: toolConfigKey(tool),
    expected: (value: unknown) =>
      `a valid ${tool} style (${toolStyleProblem(tool, value)})`,
    // Unknown keys are dropped here (and reported by the unknown-key check),
    // so a typo never resets the tool's valid keys.
    normalize: (value: unknown) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? orderedStyle(tool, value as ToolStyle)
        : value,
    valid: (value: unknown) => isToolStyle(tool, value),
  }),
);

export const CONFIG_MAPPING: readonly ConfigMapping[] = [
  ...CORE_MAPPING,
  ...HISTORY_MAPPINGS,
  ...TABS_MAPPINGS,
  ...NOTES_MAPPINGS,
  ...MEMORY_MAPPINGS,
  ...SYNC_MAPPINGS,
  ...SEARCH_MAPPINGS,
  ...LAYOUT_MAPPINGS,
  ...EXTENSION_MAPPINGS,
  ...KEYS_MAPPINGS,
  ...SERVICES_MAPPINGS,
  ...SPECULATIVE_MAPPINGS,
  ...TOOL_MAPPINGS,
];

/** The keys allowed inside each `[tools.<tool>]` table. */
export const TOOL_NESTED_KEYS: Readonly<Record<string, readonly string[]>> =
  Object.fromEntries(
    TOOL_DEFAULT_TOOLS.map((tool) => [
      toolConfigKey(tool),
      TOOL_STYLE_KEYS[tool],
    ]),
  );

let knownKeys: KnownIndex | null = null;

/** Unknown keys of a parsed TOML file, as warnings (the rest still applies). */
export const unknownKeyProblemsIn = (
  config: Record<string, unknown>,
  known: KnownIndex,
  file: string,
): SettingsProblem[] =>
  findUnknownKeys(config, known).map((u) => ({
    kind: "unknown",
    key: u.key,
    message: unknownKeyMessage(u, file),
  }));

/** config.toml keys no mapping reads, as warnings (the rest still applies). */
export const unknownKeyProblems = (
  config: Record<string, unknown>,
  file = "config.toml",
): SettingsProblem[] =>
  unknownKeyProblemsIn(
    config,
    (knownKeys ??= buildKnownIndex(
      // `[keys.labels]` holds free-text group names, read apart from the mapping.
      [...CONFIG_MAPPING.map((m) => m.key), "keys.labels", ...NATIVE_KEYS],
      TOOL_NESTED_KEYS,
    )),
    file,
  );

/** Unknown keys are warnings; parse, invalid and io problems are errors. */
export const isWarning = (problem: SettingsProblem): boolean =>
  problem.kind === "unknown" || problem.kind === "include";

export const STATE_FIELDS = [
  "recentVaults",
  "lastVaultPath",
  "navigatorCollapsed",
  "navigatorWidth",
  "expandedFolders",
  "exportOptions",
  "hasPanned",
  "profileChoice",
] as const;

type StateField = typeof STATE_FIELDS[number];
export type PersistedState = DeepReadonly<Pick<VaultPreferences, StateField>>;

export const show = (value: unknown) =>
  typeof value === "string" ? `"${value}"` : JSON.stringify(value);

export const readDotted = (
  config: Record<string, unknown>,
  key: string,
): { present: boolean; value: unknown } => {
  const [table, name] = key.split(".");
  const section = config[table];
  if (!section || typeof section !== "object" || Array.isArray(section)) {
    return { present: false, value: undefined };
  }
  const record = section as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(record, name)
    ? { present: true, value: record[name] }
    : { present: false, value: undefined };
};

/**
 * Plugin commands register after config.toml is parsed, so an id outside the
 * built-in namespaces is kept without a problem (it may be a plugin's).
 */
const isBuiltinNamespace = (id: string): boolean => {
  const ns = id.split(".")[0];
  return BUILTIN_COMMANDS.some((c) => c.id.split(".")[0] === ns);
};

const hotkeyProblem = (key: string, message: string): SettingsProblem => ({
  kind: "invalid",
  key,
  message,
});

/**
 * The dynamic `[hotkeys]` table (one entry per command id, so it is not a
 * CONFIG_MAPPING row). Valid chords and key sequences ("g g", with
 * `<leader>` kept literal) are kept in canonical form; an entry that
 * is not a list, or whose chords are all invalid, is left out so the command
 * keeps its defaults; unknown ids are kept (a newer config is never lost).
 */
export function parseHotkeysTable(table: unknown): {
  hotkeys: Record<string, string[]>;
  problems: SettingsProblem[];
} {
  const hotkeys: Record<string, string[]> = {};
  const problems: SettingsProblem[] = [];
  if (table === undefined) {
    return { hotkeys, problems };
  }
  if (!table || typeof table !== "object" || Array.isArray(table)) {
    problems.push(
      hotkeyProblem("hotkeys", "hotkeys: expected a table; using the defaults"),
    );
    return { hotkeys, problems };
  }
  for (const [id, value] of Object.entries(table)) {
    const key = `hotkeys.${id}`;
    if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
      problems.push(
        hotkeyProblem(
          key,
          `${key} = ${show(
            value,
          )} is not valid (expected a list like ["Mod+S"]); using the default`,
        ),
      );
      continue;
    }
    const chords: string[] = [];
    for (const text of value as string[]) {
      const parsed = parseSequence(text, null, LEADER_TOKEN);
      const chord = parsed && parsed.join(" ");
      if (!chord) {
        problems.push(
          hotkeyProblem(key, `${key}: "${text}" is not a valid key; ignored`),
        );
      } else if (!chords.includes(chord)) {
        chords.push(chord);
      }
    }
    if (chords.length === 0 && value.length > 0) {
      continue;
    }
    // A user preset's command registers after the config is read.
    if (
      !isCommandId(id) &&
      isBuiltinNamespace(id) &&
      !id.startsWith(LAYOUT_PRESET_PREFIX)
    ) {
      problems.push(hotkeyProblem(key, `hotkeys: unknown command ${id}`));
    }
    hotkeys[id] = chords;
  }
  return { hotkeys, problems };
}

/**
 * Parsed config.toml (as JSON) -> config-mapped preference fields. Missing
 * keys take their default; invalid values take their default and produce a
 * problem.
 */
export function configToPreferences(
  config: Record<string, unknown>,
  /** The layers the config was merged from: unknown keys are named by file. */
  layers?: readonly LayerPayload[],
): {
  values: Pick<
    VaultPreferences,
    ConfigField | "hotkeys" | "pluginSettings" | "keysLabels" | "userCommands"
  >;
  problems: SettingsProblem[];
} {
  const values = {} as Record<ConfigField, unknown>;
  const problems: SettingsProblem[] = [];
  for (const mapping of CONFIG_MAPPING) {
    const fallback = DEFAULT_PREFERENCES[mapping.field];
    const { present, value: raw } = readDotted(config, mapping.key);
    const value = mapping.normalize ? mapping.normalize(raw) : raw;
    if (!present) {
      values[mapping.field] = fallback;
    } else if (mapping.valid(value)) {
      values[mapping.field] = value;
    } else {
      const used = "onInvalid" in mapping ? mapping.onInvalid : fallback;
      values[mapping.field] = used;
      problems.push({
        kind: "invalid",
        key: mapping.key,
        message: `${sourceFileOf(layers, mapping.key)}: ${mapping.key} = ${show(
          value,
        )} is not valid (expected ${
          typeof mapping.expected === "function"
            ? mapping.expected(value)
            : mapping.expected
        }); using ${show(used)}`,
      });
    }
  }
  // Official plugins are on unless turned off (plugins/officialPlugins.ts); an old list is migrated.
  const resolved = resolveOfficial(
    readDotted(config, "plugins.enabled").present
      ? (values.pluginsEnabled as string[])
      : undefined,
    readDotted(config, "plugins.disabled").present
      ? (values.pluginsDisabled as string[])
      : undefined,
  );
  values.pluginsEnabled = resolved.enabled;
  values.pluginsDisabled = resolved.disabled;
  const table = parseHotkeysTable(config.hotkeys);
  problems.push(...table.problems);
  const keys = parseKeysExtras(config.keys);
  problems.push(...keys.problems);
  const plugins = parsePluginTable(config.plugin, "config.toml");
  problems.push(...plugins.problems);
  const user = parseUserCommands(config.commands);
  problems.push(...user.problems);
  problems.push(
    ...layoutPresetProblems(config, sourceFileOf(layers, "layout.presets")),
  );
  problems.push(
    ...(layers
      ? layers.flatMap((l) =>
          l.config ? unknownKeyProblems(l.config, layerFile(l)) : [],
        )
      : unknownKeyProblems(config)),
  );
  return {
    values: {
      ...(values as Pick<VaultPreferences, ConfigField>),
      hotkeys: table.hotkeys,
      keysLabels: keys.labels,
      pluginSettings: plugins.settings,
      userCommands: user.commands,
    },
    problems,
  };
}

const isToolField = (field: ConfigField): field is ToolField =>
  (TOOL_FIELDS as readonly string[]).includes(field);

/** The default chords of a command, as `[hotkeys]` would list them. */
const hotkeyDefault = (id: string): string[] => {
  const command = BUILTIN_COMMANDS.find((c) => c.id === id);
  const platform = detectPlatform();
  return command ? normalizeKeys(defaultKeys(command, platform), platform) : [];
};

/**
 * Changed config-mapped fields -> update_config changes (dotted keys).
 * Settings writes `overrides.toml`: a value equal to the built-in default is
 * sent as `null` with the default as a hint ("use the default"), so the
 * backend can pin the default over a `config.toml` value or drop the key.
 */
export function preferencesToConfigChanges(
  prev: PreferencesSnapshot,
  next: PreferencesSnapshot,
): ConfigChange[] {
  const changes: ConfigChange[] = [];
  for (const { field, key } of CONFIG_MAPPING) {
    if (!sameValue(prev[field], next[field])) {
      const value = next[field];
      const tool = isToolField(field);
      const fallback = tool ? {} : DEFAULT_PREFERENCES[field];
      const useDefault =
        value === undefined ||
        (tool && Object.keys(value as object).length === 0) ||
        (!tool && sameValue(value, fallback));
      changes.push(
        useDefault ? { key, value: null, default: fallback } : { key, value },
      );
    }
  }
  // [hotkeys]: one change per command id; null (the default keys) deletes the line.
  for (const id of new Set([
    ...Object.keys(prev.hotkeys),
    ...Object.keys(next.hotkeys),
  ])) {
    const was = prev.hotkeys[id];
    const now = next.hotkeys[id];
    if (!sameValue(was, now)) {
      const fallback = hotkeyDefault(id);
      changes.push(
        now === undefined || sameValue(now, fallback)
          ? { key: `hotkeys.${id}`, value: null, default: fallback }
          : { key: `hotkeys.${id}`, value: now },
      );
    }
  }
  // [keys.labels]: one change per sequence; null deletes the line.
  for (const seq of new Set([
    ...Object.keys(prev.keysLabels),
    ...Object.keys(next.keysLabels),
  ])) {
    const was = prev.keysLabels[seq];
    const now = next.keysLabels[seq];
    if (was !== now) {
      changes.push({ key: `keys.labels.${seq}`, value: now ?? null });
    }
  }
  // [plugin.<id>]: one change per plugin; null resets its table (an empty
  // table is the default, so the hint lets it beat a config.toml table).
  changes.push(
    ...pluginSettingsChanges(prev.pluginSettings, next.pluginSettings).map(
      (c) => (c.value === null ? { ...c, default: {} } : c),
    ),
  );
  return changes;
}

/** state.json object -> state preference fields (invalid -> default). */
export function stateToPreferences(
  state: Record<string, unknown> | null | undefined,
): PersistedState {
  const s = state && typeof state === "object" ? state : {};
  const d = DEFAULT_PREFERENCES;
  return {
    recentVaults:
      Array.isArray(s.recentVaults) &&
      s.recentVaults.every((v) => typeof v === "string")
        ? (s.recentVaults as string[])
        : [...d.recentVaults],
    lastVaultPath:
      typeof s.lastVaultPath === "string" ? s.lastVaultPath : d.lastVaultPath,
    navigatorCollapsed:
      typeof s.navigatorCollapsed === "boolean"
        ? s.navigatorCollapsed
        : d.navigatorCollapsed,
    navigatorWidth:
      typeof s.navigatorWidth === "number" && Number.isFinite(s.navigatorWidth)
        ? s.navigatorWidth
        : d.navigatorWidth,
    expandedFolders: isExpandedFolders(s.expandedFolders)
      ? s.expandedFolders
      : { ...d.expandedFolders },
    exportOptions: normalizeExportOptions(s.exportOptions),
    hasPanned: typeof s.hasPanned === "boolean" ? s.hasPanned : d.hasPanned,
    profileChoice:
      typeof s.profileChoice === "string" ? s.profileChoice : d.profileChoice,
  };
}

export function preferencesToState(prefs: PreferencesSnapshot): PersistedState {
  return {
    recentVaults: prefs.recentVaults,
    lastVaultPath: prefs.lastVaultPath,
    navigatorCollapsed: prefs.navigatorCollapsed,
    navigatorWidth: prefs.navigatorWidth,
    expandedFolders: prefs.expandedFolders,
    exportOptions: prefs.exportOptions,
    hasPanned: prefs.hasPanned,
    profileChoice: prefs.profileChoice,
  };
}

const sameValue = (a: unknown, b: unknown) =>
  a === b || JSON.stringify(a) === JSON.stringify(b);

const configSlice = (prefs: PreferencesSnapshot) => ({
  ...Object.fromEntries(
    CONFIG_MAPPING.map(({ field }) => [field, prefs[field]]),
  ),
  // sorted: the table's order in the file must not count as a change
  hotkeys: Object.entries(prefs.hotkeys).sort(([a], [b]) => (a < b ? -1 : 1)),
  keysLabels: Object.entries(prefs.keysLabels).sort(([a], [b]) =>
    a < b ? -1 : 1,
  ),
  pluginSettings: sortedPluginSettings(prefs.pluginSettings),
  userCommands: prefs.userCommands,
});

export function formatConfigError(
  error: ConfigErrorPayload,
  file = "config.toml",
): string {
  return error.line != null
    ? `${file} line ${error.line}: ${error.message}`
    : `${file}: ${error.message}`;
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

interface Runtime {
  win: Window;
  invoke: InvokeFn;
  stateDebounceMs: number;
  unlisten: (() => void) | null;
  /** Serialized update_config / reload chain. */
  queue: Promise<unknown>;
  /** Bumped on every local config edit; stale reloads are discarded. */
  localEdits: number;
  stateTimer: ReturnType<Window["setTimeout"]> | null;
  lastWrittenState: string;
  /** Problems from the last load (parse/invalid). */
  loadProblems: SettingsProblem[];
  /** Problems from the last failed write (cleared on next success). */
  writeProblems: SettingsProblem[];
  disposed: boolean;
}

let runtime: Runtime | null = null;
let status: SettingsStatus = browserStatus();
let lastStatusKey = "";

function browserStatus(): SettingsStatus {
  return {
    mode: "browser",
    configDir: null,
    configPath: null,
    statePath: null,
    problems: [],
  };
}

export function getSettingsStatus(): SettingsStatus {
  return { ...status, problems: [...status.problems] };
}

export function isConfigFolderActive(): boolean {
  return runtime !== null;
}

function publishStatus(win: Window | null, patch: Partial<SettingsStatus>) {
  status = { ...status, ...patch };
  const key = JSON.stringify(status);
  if (key === lastStatusKey) {
    return;
  }
  lastStatusKey = key;
  dispatch(win, SETTINGS_STATUS_EVENT, getSettingsStatus());
}

function refreshProblems(rt: Runtime) {
  publishStatus(rt.win, {
    problems: [...rt.loadProblems, ...rt.writeProblems],
  });
}

function dispatch(win: Window | null, type: string, detail: unknown) {
  if (!win) {
    return;
  }
  try {
    const EventCtor =
      (win as Window & { CustomEvent?: typeof CustomEvent }).CustomEvent ??
      CustomEvent;
    win.dispatchEvent(new EventCtor(type, { detail }));
  } catch {
    // a broken listener must never break settings sync
  }
}

const errorText = (err: unknown): string => {
  if (err && typeof err === "object") {
    const e = err as { message?: unknown; code?: unknown };
    if (typeof e.message === "string") {
      return typeof e.code === "string" ? `${e.code}: ${e.message}` : e.message;
    }
  }
  return String(err);
};

function enqueue<T>(rt: Runtime, task: () => Promise<T>): Promise<T> {
  const run = rt.queue.then(task, task);
  rt.queue = run.catch(() => undefined);
  return run;
}

/**
 * Turning network consent on is not an ordinary config write: Rust refuses it in
 * `update_config` and asks through a native dialog (`network_grant`) the page cannot click.
 * Turning it off or clearing it stays a normal write.
 */
const CONSENT_FIELDS: Readonly<Record<string, ConfigField>> = {
  "network.enabled": "networkEnabled",
  "network.allow_themes": "networkAllowThemes",
  "network.allow_plugins": "networkAllowPlugins",
};
const isConsentGrant = (change: ConfigChange) =>
  (change.value === true ||
    // Switching back to the default (true) is sent as "use the default".
    (change.value === null && change.default === true)) &&
  change.key in CONSENT_FIELDS;

function persist(
  rt: Runtime,
  next: PreferencesSnapshot,
  prev: PreferencesSnapshot,
) {
  if (rt.disposed) {
    return;
  }
  const all = preferencesToConfigChanges(prev, next);
  const grants = all.filter(isConsentGrant);
  const changes = all.filter((c) => !isConsentGrant(c));
  if (all.length > 0) {
    rt.localEdits++;
    void enqueue(rt, async () => {
      const refused: ConfigField[] = [];
      // The user said no (or the call failed): put the switch back to what config.toml holds.
      const revert = () => {
        if (refused.length > 0) {
          const back = Object.fromEntries(refused.map((f) => [f, prev[f]]));
          replaceStoredPreferences({ ...getPreferences(rt.win), ...back });
          dispatch(rt.win, PREFERENCES_CHANGED_EVENT, getPreferences(rt.win));
        }
      };
      try {
        if (changes.length > 0) {
          await rt.invoke("update_config", { changes });
        }
        if (grants.length > 0) {
          // One native dialog for every grant of this change, so one click asks once.
          const [first, ...rest] = grants.map((g) =>
            g.key.slice("network.".length),
          );
          refused.push(...grants.map((g) => CONSENT_FIELDS[g.key]));
          const granted = await rt.invoke<boolean>(
            "network_grant",
            rest.length > 0 ? { key: first, also: rest } : { key: first },
          );
          if (granted) {
            refused.length = 0;
          }
        }
        revert();
        if (rt.writeProblems.length) {
          rt.writeProblems = [];
          refreshProblems(rt);
        }
      } catch (err) {
        revert();
        rt.writeProblems = [
          {
            kind: "io",
            message: `Could not save settings: ${errorText(err)}`,
          },
        ];
        refreshProblems(rt);
      }
    });
  }

  const stateChanged = STATE_FIELDS.some(
    (field) => !sameValue(prev[field], next[field]),
  );
  if (stateChanged) {
    scheduleStateWrite(rt);
  }
}

function scheduleStateWrite(rt: Runtime) {
  if (rt.stateTimer !== null) {
    rt.win.clearTimeout(rt.stateTimer);
  }
  rt.stateTimer = rt.win.setTimeout(() => {
    rt.stateTimer = null;
    void flushState(rt);
  }, rt.stateDebounceMs);
}

async function flushState(rt: Runtime): Promise<void> {
  if (rt.disposed) {
    return;
  }
  const state = preferencesToState(getPreferences(rt.win));
  const serialized = JSON.stringify(state);
  if (serialized === rt.lastWrittenState) {
    return;
  }
  rt.lastWrittenState = serialized;
  try {
    await rt.invoke("write_state", { state });
  } catch {
    // Let the next change retry; machine state is best effort.
    rt.lastWrittenState = "";
  }
}

/**
 * Apply a load_settings result. Returns true if the in-memory preferences
 * changed. `includeState` is only set on startup: state.json belongs to this
 * process and is not watched, so reloads leave the in-memory state alone.
 */
/** Warnings for included files that were skipped, and for include problems naming no file. */
function includeProblems(result: LoadSettingsResult): SettingsProblem[] {
  const rows = (result.layers ?? [])
    .filter((l) => l.kind === "include" && l.status !== "ok" && l.error)
    .map((l): SettingsProblem => {
      const error = l.error as ConfigErrorPayload;
      // Most messages already name the file; a TOML error carries only its line.
      const text = error.message.includes(l.path)
        ? error.message
        : formatConfigError(error, l.path);
      return {
        kind: "include",
        line: error.line,
        message: `${text} (skipped)`,
      };
    });
  const warnings = (result.includeWarnings ?? []).map(
    (message): SettingsProblem => ({ kind: "include", message }),
  );
  return [...rows, ...warnings];
}

function applyLoad(
  rt: Runtime,
  result: LoadSettingsResult,
  includeState: boolean,
): boolean {
  const current = getPreferences(rt.win);
  let next: PreferencesSnapshot = current;
  const loadProblems: SettingsProblem[] = [];

  if (result.configError) {
    // Parse error: keep the last good config values.
    loadProblems.push({
      kind: "parse",
      line: result.configError.line,
      message: formatConfigError(result.configError),
    });
  }
  if (result.overridesError) {
    loadProblems.push({
      kind: "parse",
      line: result.overridesError.line,
      message: formatConfigError(result.overridesError, "overrides.toml"),
    });
  }
  loadProblems.push(...includeProblems(result));
  // A layer that fails to parse on a reload keeps the whole previous result;
  // at startup the layers that parse apply. A broken included file is only a
  // warning: that file is skipped and the rest applies.
  const keepPrevious =
    !includeState && !!(result.configError || result.overridesError);
  if (!keepPrevious && result.config && typeof result.config === "object") {
    const { values, problems } = configToPreferences(
      result.config,
      result.layers,
    );
    next = { ...next, ...values };
    loadProblems.push(...problems);
  }
  if (includeState) {
    next = { ...next, ...stateToPreferences(result.state) };
    rt.lastWrittenState = JSON.stringify(preferencesToState(next));
  }

  logProblems(loadProblems);
  rt.loadProblems = loadProblems;
  // A layer that failed to parse keeps its last good content for the chips.
  const previousLayers = status.layers;
  const layers = result.layers?.map((l) =>
    l.config || l.status !== "error"
      ? l
      : {
          ...l,
          config:
            previousLayers?.find((p) => p.id === l.id && p.path === l.path)
              ?.config ?? null,
        },
  );
  publishStatus(rt.win, {
    layers,
    mode: "tauri",
    configDir: result.configDir ?? null,
    configPath: result.configPath ?? null,
    statePath: result.statePath ?? null,
    overridesPath: result.overridesPath ?? null,
    profile: result.profile ?? null,
    profiles: result.profiles ?? [],
    problems: [...loadProblems, ...rt.writeProblems],
  });

  const changed =
    JSON.stringify(configSlice(current)) !==
      JSON.stringify(configSlice(next)) ||
    (includeState &&
      JSON.stringify(preferencesToState(current)) !==
        JSON.stringify(preferencesToState(next)));
  if (changed) {
    replaceStoredPreferences(next);
  }
  if (changed || includeState) {
    setImporterOverrides(next.pluginImporters);
  }
  return changed;
}

async function resolveDeps(deps: SettingsDeps) {
  const invoke =
    deps.invoke ?? ((await import("@tauri-apps/api/core")).invoke as InvokeFn);
  const listen =
    deps.listen ??
    ((await import("@tauri-apps/api/event")).listen as unknown as ListenFn);
  return { invoke, listen };
}

/**
 * Hydrate preferences from the config folder (Tauri) and start watching it.
 * In a browser this is a no-op and preferences stay on localStorage. Never
 * throws: if the native side fails, the app falls back to localStorage and
 * the failure is reported through the settings status.
 */
export async function initSettings(
  win: Window | null | undefined,
  deps: SettingsDeps = {},
): Promise<SettingsStatus> {
  disposeSettings();
  const useTauri = deps.tauri ?? isTauriAvailable(win);
  if (!win || !useTauri) {
    return getSettingsStatus();
  }

  let invoke: InvokeFn;
  let listen: ListenFn;
  let result: LoadSettingsResult;
  let reachedNative: InvokeFn | null = null;
  try {
    ({ invoke, listen } = await resolveDeps(deps));
    reachedNative = invoke;
    result = await invoke<LoadSettingsResult>("load_settings");
    // Set before preferences hydrate, so no extension starts in safe start.
    setSafeStart(result.safeStart ?? null);
    setBisect(parseBisect(result.bisect));
  } catch (err) {
    // The vault services still follow a running bisect: show it, so it can be stopped.
    void reachedNative?.<unknown>("launch_bisect_get")
      .then((b) => setBisect(parseBisect(b)))
      .catch(() => undefined);
    publishStatus(win, {
      ...browserStatus(),
      problems: [
        {
          kind: "io",
          message: `Could not load the config folder (using local settings): ${errorText(
            err,
          )}`,
        },
      ],
    });
    return getSettingsStatus();
  }

  // Start from defaults (not localStorage): config.toml is the source of
  // truth. Machine state is migrated once from localStorage when state.json
  // is empty, so recent vaults survive the switch.
  const rt: Runtime = {
    win,
    invoke,
    stateDebounceMs: deps.stateDebounceMs ?? 300,
    unlisten: null,
    queue: Promise.resolve(),
    localEdits: 0,
    stateTimer: null,
    lastWrittenState: "",
    loadProblems: [],
    writeProblems: [],
    disposed: false,
  };
  runtime = rt;
  attachPreferencesStore({ ...DEFAULT_PREFERENCES }, (next, prev) =>
    persist(rt, next, prev),
  );

  const state =
    result.state && typeof result.state === "object" ? result.state : {};
  const legacy =
    Object.keys(state).length === 0 ? readLocalStoragePreferences(win) : null;
  applyLoad(rt, { ...result, state: legacy ? { ...legacy } : state }, true);
  if (legacy) {
    rt.lastWrittenState = "";
    scheduleStateWrite(rt);
  }

  try {
    const unlisten = await listen<{ paths?: string[] }>(
      "config-change",
      (e) => {
        // Plugin, theme and snippet files and dot folders (.git) change no setting.
        if (isNonSettingsBatch(e?.payload?.paths, status.configDir)) {
          return;
        }
        void reloadSettings();
      },
    );
    if (rt.disposed) {
      unlisten();
    } else {
      rt.unlisten = unlisten;
    }
  } catch {
    // Live reload unavailable; the Reload button still works.
  }
  return getSettingsStatus();
}

/**
 * Re-read config.toml (load_settings) and apply it. Dispatches
 * `vault-preferences-changed` only when a value actually changed. Waits for
 * pending update_config writes first so our own echoes are idempotent.
 */
export async function reloadSettings(): Promise<boolean> {
  const rt = runtime;
  if (!rt) {
    return false;
  }
  return enqueue(rt, async () => {
    if (rt.disposed) {
      return false;
    }
    const editsBefore = rt.localEdits;
    let result: LoadSettingsResult;
    try {
      result = await rt.invoke<LoadSettingsResult>("load_settings");
    } catch (err) {
      rt.loadProblems = [
        {
          kind: "io",
          message: `Could not reload config.toml: ${errorText(err)}`,
        },
      ];
      refreshProblems(rt);
      return false;
    }
    if (rt.disposed || rt.localEdits !== editsBefore) {
      // A local edit raced this read; its own write will trigger a reload.
      return false;
    }
    const changed = applyLoad(rt, result, false);
    if (changed) {
      dispatch(rt.win, PREFERENCES_CHANGED_EVENT, getPreferences(rt.win));
    }
    return changed;
  });
}

/** Reveal the config folder in Finder / Explorer / the file manager. */
export async function openConfigDir(): Promise<void> {
  const rt = runtime;
  if (!rt) {
    throw new Error("The config folder is only available in the desktop app");
  }
  await rt.invoke("open_config_dir");
}

/** Open config.toml with the default app. */
export async function openConfigFile(): Promise<void> {
  await need("The config file").invoke("open_config_file");
}

/** Open an included file with the default app (the backend checks it is one). */
export async function openIncludedFile(path: string): Promise<void> {
  await need("The included file").invoke("open_included_file", { path });
}

/** Show overrides.toml (the Settings changes) in the file manager. */
export async function revealOverrides(): Promise<void> {
  await need("The Settings changes file").invoke("reveal_overrides");
}

/**
 * Delete overrides.toml (every change made in Settings), then reload. config.toml
 * is never touched. Returns whether a file existed.
 */
export async function resetOverrides(): Promise<boolean> {
  const rt = need("Settings changes");
  const existed = await enqueue(rt, () =>
    rt.invoke<boolean>("reset_overrides"),
  );
  await reloadSettings();
  return existed;
}

/**
 * Drop the override of one config key: its value comes from config.toml again
 * (`toDefault` pins the built-in default instead, even over a config.toml value).
 * Only keys of the mapping table; the rest of overrides.toml stays as it is.
 */
export async function resetConfigKey(
  key: string,
  toDefault = false,
): Promise<void> {
  const rt = need("Settings");
  const mapping = CONFIG_MAPPING.find((m) => m.key === key);
  if (!mapping) {
    throw new Error(`${key} is not a Settings key`);
  }
  const change: ConfigChange = toDefault
    ? {
        key,
        value: null,
        default: isToolField(mapping.field)
          ? {}
          : DEFAULT_PREFERENCES[mapping.field],
      }
    : { key, value: null };
  rt.localEdits++;
  await enqueue(rt, () => rt.invoke("update_config", { changes: [change] }));
  await reloadSettings();
}

function need(what: string): Runtime {
  if (!runtime) {
    throw new Error(`${what} is only available in the desktop app`);
  }
  return runtime;
}

/**
 * A profile command (`profile_use`, `profile_create`, `profile_delete`), then a reload so
 * the new profile's values apply at once (the watcher would also do it, a moment later).
 */
export async function profileCall(
  cmd: "profile_use" | "profile_create" | "profile_delete",
  args: Record<string, unknown>,
): Promise<void> {
  const rt = need("Profiles");
  await enqueue(rt, () => rt.invoke(cmd, args));
  await reloadSettings();
}

/** Call a read-only native command through the settings bridge (desktop only). */
export async function nativeCall<T>(
  what: string,
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return need(what).invoke<T>(cmd, args);
}

/** Write any pending state.json change now (e.g. before quitting). */
export async function flushSettings(): Promise<void> {
  const rt = runtime;
  if (!rt) {
    return;
  }
  if (rt.stateTimer !== null) {
    rt.win.clearTimeout(rt.stateTimer);
    rt.stateTimer = null;
  }
  await flushState(rt);
  await rt.queue;
}

/** Stop syncing and return preferences to localStorage mode. */
export function disposeSettings(): void {
  const rt = runtime;
  runtime = null;
  if (rt) {
    rt.disposed = true;
    if (rt.stateTimer !== null) {
      rt.win.clearTimeout(rt.stateTimer);
    }
    try {
      rt.unlisten?.();
    } catch {
      // ignore
    }
  }
  detachPreferencesStore();
  status = browserStatus();
  lastStatusKey = "";
}
