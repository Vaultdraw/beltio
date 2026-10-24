/**
 * The v1 command registry: pure metadata, no handlers (the app shell binds
 * those). Order matters: it is the dispatcher's tie-break and the order the
 * Hotkeys page lists commands in.
 */
import { AI_COMMANDS } from "../ai/aiCommands";
import { FORMULA_COMMANDS } from "../formula/formulaCommands";
import { HELP_COMMANDS } from "../help/helpCommands";
import { HISTORY_COMMANDS } from "../history/historyCommands";
import { SETTINGS_PAGES } from "../components/settings/schema";
import { MAX_PEN_PRESETS } from "../pens/penPresets";
import {
  TOOL_DEFAULT_RESET_DRAWING_ID,
  TOOL_DEFAULT_SAVE_ACTIVE_ID,
  toolDefaultResetId,
  toolDefaultSaveId,
} from "../toolDefaults/toolDefaultIds";
import { TOOL_DEFAULT_TOOLS, TOOL_LABELS } from "../toolDefaults/toolStyles";
import { PLUGIN_UI_COMMANDS } from "../plugins/ui/pluginCommands";
import { SORT_LABELS, SORT_ORDERS, type SortOrder } from "../vault/sortOrder";

import {
  drawingOpenCommands,
  makeDrawingOpenCommand,
  parseDrawingOpenCommandId,
} from "./drawingCommands";
import { EDITOR_COMMANDS } from "./editorCommands";
import { GALLERY_COMMANDS } from "./galleryCommands";
import { GRAPH_COMMANDS } from "./graphCommands";
import {
  getRegisteredCommand,
  isLegacyCommandId,
  registerCommands,
  registeredCommands,
} from "./registry";
import { TAB_COMMANDS } from "./tabCommands";
import { KEYS_COMMANDS } from "./keysCommands";
import { LIST_COMMANDS } from "./listCommands";
import { THUMBNAIL_COMMANDS } from "./thumbnailCommands";
import { CONFIG_COMMANDS } from "./configCommands";
import { MEMORY_COMMANDS } from "./memoryCommands";
import { TOOL_COMMANDS } from "./toolCommands";

import type {
  Chord,
  CommandDefinition,
  HotkeyOverrides,
  Platform,
} from "./types";

/** The palette's two modes (VS Code style): Cmd+P files, Cmd+Shift+P commands. */
export const PALETTE_FILES_ID = "palette.files";
export const PALETTE_COMMANDS_ID = "palette.commands";

/** "pen.select1" .. "pen.select9": pick a saved pen (and the freedraw tool). */
export const penCommandId = (index: number) => `pen.select${index + 1}`;

const PEN_COMMANDS: CommandDefinition[] = Array.from(
  { length: MAX_PEN_PRESETS },
  (_, i) => ({
    id: penCommandId(i),
    title: `Select pen ${i + 1}`,
    category: "Pens",
    // Matched by code, so macOS Option+digit dead keys do not matter. Never
    // while typing: Option+digit types characters (¡, ™, £...) on macOS.
    keys: { default: [`Alt+${i + 1}`] },
    when: ["drawingOpen", "!textEditing", "!modalOpen"],
    palette: false,
  }),
);

/** "toolDefaults.save.arrow" / ".reset.arrow" / ".saveActive": rebindable, no keys. */
const TOOL_DEFAULT_COMMANDS: CommandDefinition[] = [
  ...TOOL_DEFAULT_TOOLS.flatMap((tool): CommandDefinition[] => [
    {
      id: toolDefaultSaveId(tool),
      title: `Tool defaults: Save current style for ${TOOL_LABELS[tool]}`,
      category: "Tool defaults",
      keys: { default: [] },
      when: ["drawingOpen", "!textEditing", "!modalOpen"],
    },
    {
      id: toolDefaultResetId(tool),
      title: `Tool defaults: Reset ${TOOL_LABELS[tool]}`,
      category: "Tool defaults",
      keys: { default: [] },
      when: ["drawingOpen", "!textEditing", "!modalOpen"],
    },
  ]),
  {
    id: TOOL_DEFAULT_SAVE_ACTIVE_ID,
    title: "Tool defaults: Save current style for this tool",
    category: "Tool defaults",
    keys: { default: [] },
    when: ["drawingOpen", "!textEditing", "!modalOpen"],
  },
  {
    id: TOOL_DEFAULT_RESET_DRAWING_ID,
    title: "Tool defaults: Reset this drawing's styles to defaults",
    category: "Tool defaults",
    keys: { default: [] },
    when: ["drawingOpen", "!textEditing", "!modalOpen"],
  },
];

/** "settings.page.appearance": open one settings page (Hotkeys has its own). */
export const settingsPageCommandId = (page: string) => `settings.page.${page}`;

/**
 * "Pens & laser" became the Pen section of the Tools page; its command (and
 * any [hotkeys] binding of it) stays and opens that section.
 */
export const SETTINGS_PENS_COMMAND_ID = settingsPageCommandId("pens");

const SETTINGS_PAGE_COMMANDS: CommandDefinition[] = SETTINGS_PAGES.filter(
  (page) => page.id !== "hotkeys",
)
  .flatMap((page) => [
    ...(page.id === "tools"
      ? [{ id: SETTINGS_PENS_COMMAND_ID, label: "Pens & laser" }]
      : []),
    { id: settingsPageCommandId(page.id), label: page.label },
  ])
  .map(({ id, label }) => ({
    id,
    title: `Settings: ${label}`,
    category: "Settings",
    keys: { default: [] },
    when: ["vaultOpen", "!modalOpen"],
  }));

/** "navigator.sort.name_asc": set the navigator sort order. */
export const sortCommandId = (order: SortOrder) => `navigator.sort.${order}`;

const SORT_COMMANDS: CommandDefinition[] = SORT_ORDERS.map((order) => ({
  id: sortCommandId(order),
  title: `Sort: ${SORT_LABELS[order]}`,
  category: "Navigator",
  keys: { default: [] },
  when: ["vaultOpen", "!modalOpen"],
}));

const WHEN_LINK_SELECTION = [
  "drawingOpen",
  "!textEditing",
  "!modalOpen",
] as const;

/**
 * Links (P1). The key set follows Obsidian's Mod+Alt family, which Excalidraw
 * leaves free (its link key is plain Mod+K). Link hints would be a plain "F"
 * like Vimium, but F is Excalidraw's Frame tool and the dispatcher claims keys
 * first, so the default is Shift+F (free in Excalidraw); rebindable.
 */
const LINKS_COMMANDS: CommandDefinition[] = [
  {
    id: "links.linkSelection",
    title: "Links: Link selection to drawing…",
    category: "Links",
    keys: { default: ["Mod+Alt+K"] },
    when: [...WHEN_LINK_SELECTION, "writable"],
  },
  {
    id: "links.insert",
    title: "Links: Insert link…",
    category: "Links",
    keys: { default: [] },
    when: [...WHEN_LINK_SELECTION, "writable"],
  },
  {
    id: "links.openUnderSelection",
    title: "Links: Open link under selection",
    category: "Links",
    keys: { default: ["Mod+Alt+Enter"] },
    when: [...WHEN_LINK_SELECTION],
  },
  {
    id: "links.openUnderSelectionNew",
    title: "Links: Open link under selection in new tab",
    category: "Links",
    keys: { default: ["Mod+Alt+Shift+Enter"] },
    when: [...WHEN_LINK_SELECTION],
  },
  {
    id: "links.toggleDock",
    title: "Links: Toggle backlinks panel",
    category: "Links",
    keys: { default: ["Mod+Alt+B"] },
    when: ["drawingOpen", "!modalOpen"],
  },
  {
    id: "links.back",
    title: "Links: Go back",
    category: "Links",
    keys: { default: ["Mod+Alt+ArrowLeft"] },
    when: ["vaultOpen", "!modalOpen"],
  },
  {
    id: "links.forward",
    title: "Links: Go forward",
    category: "Links",
    keys: { default: ["Mod+Alt+ArrowRight"] },
    when: ["vaultOpen", "!modalOpen"],
  },
  {
    id: "links.copyLinkToDrawing",
    title: "Links: Copy link to this drawing",
    category: "Links",
    keys: { default: [] },
    when: ["drawingOpen", "!modalOpen"],
  },
  {
    id: "links.openUri",
    title: "Links: Open a vaultdraw:// link…",
    category: "Links",
    keys: { default: [] },
    when: ["!modalOpen"],
  },
  {
    id: "links.registerHandlers",
    title: "Links: Register Vaultdraw for links and files (Linux)",
    category: "Links",
    keys: { default: [] },
    when: ["!modalOpen"],
  },
  {
    id: "links.hints",
    title: "Links: Show link hints",
    category: "Links",
    keys: { default: ["Shift+F"] },
    when: ["canvasFocus", "!textEditing", "!modalOpen", "drawingOpen"],
  },
  {
    id: "links.toggleStyling",
    title: "Links: Toggle link styling",
    category: "Links",
    keys: { default: [] },
    when: ["vaultOpen", "!modalOpen"],
  },
  {
    id: "links.toggleHoverPreview",
    title: "Links: Toggle link hover preview",
    category: "Links",
    keys: { default: [] },
    when: ["vaultOpen", "!modalOpen"],
  },
  {
    id: "links.bindDrawingHotkey",
    title: "Links: Assign hotkey to this drawing",
    category: "Links",
    keys: { default: [] },
    when: ["drawingOpen", "!modalOpen"],
  },
];

/** Tags (P2). No default keys: bind them on the Hotkeys page. */
const TAGS_COMMANDS: CommandDefinition[] = [
  {
    id: "tags.rename",
    title: "Tags: Rename tag…",
    category: "Tags",
    keys: { default: [] },
    when: ["vaultOpen", "writable", "!modalOpen"],
  },
  {
    id: "tags.focusPane",
    title: "Tags: Focus tags pane",
    category: "Tags",
    keys: { default: [] },
    when: ["vaultOpen", "!modalOpen"],
  },
  {
    id: "tags.toggleSort",
    title: "Tags: Toggle sort by name/count",
    category: "Tags",
    keys: { default: [] },
    when: ["vaultOpen", "!modalOpen"],
  },
];

/** The built-in commands (registered below; plugins register more at runtime). */
export const COMMANDS: readonly CommandDefinition[] = [
  {
    id: "file.save",
    title: "Save drawing",
    category: "File",
    // Mod+Shift+S too, so it never reaches Excalidraw's "Save to disk"
    // download. Ctrl aliases on macOS keep the old Cmd-or-Ctrl behaviour.
    keys: {
      default: ["Mod+S", "Mod+Shift+S"],
      mac: ["Mod+S", "Mod+Shift+S", "Ctrl+S"],
    },
    when: ["drawingOpen"],
  },
  {
    id: "settings.open",
    title: "Open settings",
    category: "Settings",
    keys: { default: ["Mod+Comma"], mac: ["Mod+Comma", "Ctrl+Comma"] },
    when: ["vaultOpen", "!modalOpen"],
  },
  {
    id: "navigator.focusSearch",
    title: "Search vault",
    category: "Navigator",
    keys: { default: ["Mod+Shift+F"], mac: ["Mod+Shift+F", "Ctrl+Shift+F"] },
    when: ["vaultOpen", "!modalOpen"],
  },
  {
    id: "view.zoomIn",
    title: "Zoom in (interface)",
    category: "View",
    keys: { default: ["Mod+Shift+Equal", "Mod+Shift+NumpadAdd"] },
    repeat: true,
  },
  {
    id: "view.zoomOut",
    title: "Zoom out (interface)",
    category: "View",
    keys: { default: ["Mod+Shift+Minus", "Mod+Shift+NumpadSubtract"] },
    repeat: true,
  },
  {
    id: "view.zoomReset",
    title: "Reset interface zoom",
    category: "View",
    keys: { default: ["Mod+Shift+0", "Mod+Shift+Numpad0"] },
  },
  {
    id: PALETTE_FILES_ID,
    title: "Go to drawing",
    category: "Palette",
    keys: { default: ["Mod+P"] },
    when: ["vaultOpen", "!modalOpen"],
    // F41's single palette id: an existing `[hotkeys]` entry keeps working
    // (it was the Cmd+P key); the chords that now belong to the commands
    // mode by default are dropped from it.
    legacy: {
      id: "palette.quickSwitcher",
      except: ["Mod+Slash", "Mod+Shift+P"],
    },
  },
  {
    id: PALETTE_COMMANDS_ID,
    title: "Show all commands",
    category: "Palette",
    // VS Code's Mod+Shift+P, and Excalidraw's own palette key (Mod+/).
    keys: { default: ["Mod+Shift+P", "Mod+Slash"] },
    when: ["vaultOpen", "!modalOpen"],
    // Already in commands mode; "Go to drawing" is listed to switch.
    palette: false,
  },
  {
    id: "vault.newDrawing",
    title: "New drawing",
    category: "Vault",
    keys: { default: ["Mod+N"] },
    when: ["vaultOpen", "writable", "!modalOpen"],
  },
  {
    id: "vault.newFromTemplate",
    title: "Templates: New drawing from template",
    category: "Templates",
    // Matched by code: Option+N types a dead key on macOS.
    keys: { default: ["Mod+Alt+N"], mac: ["Mod+Alt+N", "Ctrl+Alt+N"] },
    when: ["vaultOpen", "!modalOpen"],
  },
  {
    id: "view.toggleNavigator",
    title: "Toggle navigator",
    category: "Navigator",
    keys: { default: ["Mod+Backslash"] },
    when: ["vaultOpen", "!modalOpen"],
  },
  {
    id: "view.toggleActivityBar",
    title: "Toggle activity bar",
    category: "View",
    keys: { default: [] },
    when: ["vaultOpen", "!modalOpen"],
  },
  {
    id: "cli.install",
    title: "Install 'vaultdraw' command in PATH",
    category: "Vault",
    keys: { default: [] },
  },
  {
    id: "cli.installSystem",
    title: "Install 'vaultdraw' command in /usr/local/bin",
    category: "Vault",
    keys: { default: [] },
  },
  {
    id: "vault.switch",
    title: "Open another vault",
    category: "Vault",
    keys: { default: [] },
    when: ["!modalOpen"],
  },
  {
    id: "file.revealInFinder",
    title: "Reveal drawing in Finder",
    category: "File",
    keys: { default: [] },
    when: ["drawingOpen"],
  },
  {
    id: "file.duplicate",
    title: "Duplicate drawing",
    category: "File",
    keys: { default: [] },
    when: ["drawingOpen", "writable"],
  },
  {
    id: "appearance.toggleMode",
    title: "Toggle light/dark mode",
    category: "Appearance",
    keys: { default: [] },
  },
  {
    id: "settings.openHotkeys",
    title: "Settings: Hotkeys",
    category: "Settings",
    keys: { default: [] },
    when: ["vaultOpen", "!modalOpen"],
  },
  {
    id: "settings.scope.global",
    title: "Settings: Edit global settings",
    category: "Settings",
    keys: { default: [] },
    when: ["vaultOpen", "!modalOpen"],
  },
  {
    id: "settings.scope.vault",
    title: "Settings: Edit this vault's settings",
    category: "Settings",
    keys: { default: [] },
    when: ["vaultOpen", "writable", "!modalOpen"],
  },
  ...SETTINGS_PAGE_COMMANDS,
  {
    id: "appearance.mode.light",
    title: "Mode: Light",
    category: "Appearance",
    keys: { default: [] },
  },
  {
    id: "appearance.mode.dark",
    title: "Mode: Dark",
    category: "Appearance",
    keys: { default: [] },
  },
  {
    id: "appearance.mode.system",
    title: "Mode: System",
    category: "Appearance",
    keys: { default: [] },
  },
  {
    id: "appearance.syncCanvas.on",
    title: "Sync canvas with theme: On",
    category: "Appearance",
    keys: { default: [] },
  },
  {
    id: "appearance.syncCanvas.off",
    title: "Sync canvas with theme: Off",
    category: "Appearance",
    keys: { default: [] },
  },
  {
    id: "file.exportPng",
    title: "Export: PNG",
    category: "Export",
    keys: { default: [] },
    when: ["drawingOpen"],
  },
  {
    id: "file.exportSvg",
    title: "Export: SVG",
    category: "Export",
    keys: { default: [] },
    when: ["drawingOpen"],
  },
  {
    id: "file.exportPdf",
    title: "Export: PDF",
    category: "Export",
    keys: { default: [] },
    when: ["drawingOpen"],
  },
  {
    id: "file.importPdf",
    title: "Import: PDF…",
    category: "File",
    keys: { default: [] },
    when: ["drawingOpen", "writable"],
  },
  {
    id: "file.importFile",
    title: "Import: File…",
    category: "File",
    keys: { default: [] },
    when: ["drawingOpen", "writable"],
  },
  {
    id: "plugins.cancelImport",
    title: "Import: Cancel",
    category: "File",
    keys: { default: [] },
  },
  {
    id: "file.saveCopy",
    title: "Save a copy",
    category: "Export",
    keys: { default: [] },
    when: ["drawingOpen"],
  },
  {
    id: "templates.saveDrawing",
    title: "Templates: Save drawing as template",
    category: "Templates",
    keys: { default: [] },
    when: ["drawingOpen"],
  },
  {
    id: "navigator.searchTags",
    title: "Tags: Search by tag",
    category: "Tags",
    keys: { default: [] },
    when: ["vaultOpen", "!modalOpen"],
  },
  {
    id: "navigator.newFolder",
    title: "New folder",
    category: "Navigator",
    keys: { default: [] },
    when: ["vaultOpen", "writable", "!modalOpen"],
  },
  {
    id: "navigator.newDrawingInFolder",
    title: "Navigator: New drawing in selected folder",
    category: "Navigator",
    keys: { default: [] },
    when: ["vaultOpen", "writable", "!modalOpen"],
  },
  {
    id: "navigator.collapseAll",
    title: "Navigator: Collapse all folders",
    category: "Navigator",
    keys: { default: [] },
    when: ["vaultOpen", "!modalOpen"],
  },
  {
    id: "navigator.refresh",
    title: "Navigator: Refresh files",
    category: "Navigator",
    keys: { default: [] },
    when: ["vaultOpen", "!modalOpen"],
  },
  {
    id: "file.rename",
    title: "Rename drawing",
    category: "File",
    keys: { default: [] },
    when: ["drawingOpen", "writable", "!modalOpen"],
  },
  {
    id: "file.move",
    title: "Move drawing",
    category: "File",
    keys: { default: [] },
    when: ["drawingOpen", "writable", "!modalOpen"],
  },
  {
    id: "file.trash",
    title: "Move drawing to Trash",
    category: "File",
    keys: { default: [] },
    when: ["drawingOpen", "writable", "!modalOpen"],
  },
  {
    id: "vault.reveal",
    title: "Reveal vault folder",
    category: "Vault",
    keys: { default: [] },
    when: ["vaultOpen"],
  },
  {
    id: "vault.retryWritable",
    title: "Retry opening vault writable",
    category: "Vault",
    keys: { default: [] },
    when: ["vaultOpen", "!modalOpen"],
  },
  {
    id: "vault.revealRecovery",
    title: "Reveal recovery folder",
    category: "Vault",
    keys: { default: [] },
    when: ["vaultOpen"],
  },
  {
    id: "vault.openRecovered",
    title: "Open recovered drawings",
    category: "Vault",
    keys: { default: [] },
    when: ["vaultOpen", "!modalOpen"],
  },
  {
    id: "file.resolveConflict",
    title: "Resolve conflict",
    category: "File",
    keys: { default: [] },
    when: ["drawingOpen", "!modalOpen"],
  },
  ...SORT_COMMANDS,
  ...EDITOR_COMMANDS,
  ...PEN_COMMANDS,
  ...TOOL_DEFAULT_COMMANDS,
  ...TOOL_COMMANDS,
  ...KEYS_COMMANDS,
  ...LINKS_COMMANDS,
  ...TAGS_COMMANDS,
  ...HISTORY_COMMANDS,
  ...GRAPH_COMMANDS,
  ...PLUGIN_UI_COMMANDS,
  ...TAB_COMMANDS,
  ...LIST_COMMANDS,
  ...FORMULA_COMMANDS,
  ...THUMBNAIL_COMMANDS,
  ...GALLERY_COMMANDS,
  ...MEMORY_COMMANDS,
  ...AI_COMMANDS,
  ...CONFIG_COMMANDS,
  ...HELP_COMMANDS,
];

registerCommands(COMMANDS);

const BUILTIN_IDS: ReadonlySet<string> = new Set(COMMANDS.map((c) => c.id));

/**
 * True for the app's own commands (and `drawing.open:<path>`), false for
 * anything a plugin registered. Links from outside may only run these.
 */
export const isBuiltinCommand = (id: string): boolean =>
  BUILTIN_IDS.has(id) || parseDrawingOpenCommandId(id) !== null;
export const BUILTIN_COMMANDS = COMMANDS;

/** A registered command, or the "Open drawing" command of a `drawing.open:` id. */
export const getCommand = (id: string): CommandDefinition | undefined => {
  const registered = getRegisteredCommand(id);
  if (registered) {
    return registered;
  }
  const path = parseDrawingOpenCommandId(id);
  return path === null ? undefined : makeDrawingOpenCommand(path);
};

/** The registry plus one command per drawing bound in `[hotkeys]`. */
export const allCommands = (
  overrides: HotkeyOverrides,
): readonly CommandDefinition[] => {
  const dynamic = drawingOpenCommands(overrides);
  return dynamic.length > 0
    ? [...registeredCommands(), ...dynamic]
    : registeredCommands();
};

export const isCommandId = (id: string): boolean =>
  getRegisteredCommand(id) !== undefined ||
  isLegacyCommandId(id) ||
  parseDrawingOpenCommandId(id) !== null;

/** Default chords on a platform ([] = unassigned). */
export const defaultKeys = (
  command: CommandDefinition,
  platform: Platform,
): Chord[] => command.keys[platform] ?? command.keys.default;
