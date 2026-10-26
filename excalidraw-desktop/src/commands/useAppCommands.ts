/**
 * Binds the app shell's actions to command ids (see commands.ts). Every id in
 * COMMANDS gets a handler here; the dispatcher decides when it may run.
 */
import {
  SETTINGS_PAGES,
  type SettingsTarget,
} from "../components/settings/schema";
import { setSettingsScope } from "../components/settings/settingsScope";
import { EXTENSION_COMMAND_HANDLERS } from "../extensionSwitches/extensionCommands";
import { HELP_COMMAND_IDS, HELP_LINK_HANDLERS } from "../help/helpCommands";
import { PEN_COMMAND_HANDLERS } from "../pens/penCommands";
import { pluginUiHandlers } from "../plugins/ui/pluginCommands";
import { SORT_ORDERS, type SortOrder } from "../vault/sortOrder";

import { CONFIG_COMMAND_HANDLERS } from "./configCommands";
import {
  SETTINGS_PENS_COMMAND_ID,
  settingsPageCommandId,
  sortCommandId,
} from "./commands";

import type { PaletteMode } from "../palette/rank";
import type { CommandHandlers } from "./types";

export interface AppCommandActions {
  save(): void | Promise<void>;
  openSettings(): void;
  openHotkeySettings(): void;
  focusSearch(): void;
  zoom(command: "in" | "out" | "reset"): void;
  toggleNavigator(): void;
  toggleActivityBar(): void;
  newDrawing(): void | Promise<void>;
  /** Off with `extensions.templates`: no handler = not offered. */
  newFromTemplate?: () => void | Promise<void>;
  switchVault(): void | Promise<void>;
  revealActive(): void | Promise<void>;
  duplicateActive(): void | Promise<void>;
  toggleMode(): void;
  /** Open the palette in `mode`; the same mode again closes it. */
  togglePalette(mode: PaletteMode): void;
  openSettingsPage(page: SettingsTarget): void;
  setMode(mode: "light" | "dark" | "system"): void;
  setSyncCanvas(on: boolean): void;
  exportActive(format: "png" | "svg" | "pdf" | "copy"): void | Promise<void>;
  /** Off with `extensions.pdf-import`. */
  importPdf?: () => void | Promise<void>;
  /** Pick PDFs/images: PDF -> import dialog, images -> viewport centre. */
  importFile(): void | Promise<void>;
  /** "Import: Cancel": aborts the running plugin import. */
  cancelImport(): void;
  /** Off with `extensions.templates`. */
  saveActiveAsTemplate?: () => void;
  /** Off with `extensions.tags`. */
  searchTags?: () => void;
  newFolder(): void;
  newDrawingInFolder(): void;
  collapseAllFolders(): void;
  refreshFiles(): void;
  renameActive(): void;
  moveActive(): void;
  trashActive(): void;
  revealVault(): void | Promise<void>;
  revealRecovery(): void | Promise<void>;
  setSort(order: SortOrder): void;
  /** Only while recovered snapshots exist: no handler = not offered. */
  openRecovered?: () => void;
  /** Only while the open drawing has a conflict. */
  resolveConflict?: () => void;
  /** Only while the vault is open read-only. */
  retryWritable?: () => void;
}

export function appCommandHandlers(
  actions: AppCommandActions,
): CommandHandlers {
  return {
    "file.save": actions.save,
    "settings.open": actions.openSettings,
    "settings.openHotkeys": actions.openHotkeySettings,
    "settings.scope.global": () => {
      setSettingsScope("global");
      actions.openSettings();
    },
    "settings.scope.vault": () => {
      setSettingsScope("vault");
      actions.openSettings();
    },
    "navigator.focusSearch": actions.focusSearch,
    "view.zoomIn": () => actions.zoom("in"),
    "view.zoomOut": () => actions.zoom("out"),
    "view.zoomReset": () => actions.zoom("reset"),
    "view.toggleNavigator": actions.toggleNavigator,
    "view.toggleActivityBar": actions.toggleActivityBar,
    "vault.newDrawing": actions.newDrawing,
    "vault.newFromTemplate": actions.newFromTemplate,
    "vault.switch": actions.switchVault,
    "file.revealInFinder": actions.revealActive,
    "file.duplicate": actions.duplicateActive,
    "appearance.toggleMode": actions.toggleMode,
    "palette.files": () => actions.togglePalette("files"),
    "palette.commands": () => actions.togglePalette("commands"),
    "appearance.mode.light": () => actions.setMode("light"),
    "appearance.mode.dark": () => actions.setMode("dark"),
    "appearance.mode.system": () => actions.setMode("system"),
    "appearance.syncCanvas.on": () => actions.setSyncCanvas(true),
    "appearance.syncCanvas.off": () => actions.setSyncCanvas(false),
    "file.exportPng": () => actions.exportActive("png"),
    "file.exportSvg": () => actions.exportActive("svg"),
    "file.exportPdf": () => actions.exportActive("pdf"),
    "file.importPdf": actions.importPdf,
    "file.importFile": actions.importFile,
    "plugins.cancelImport": actions.cancelImport,
    "file.saveCopy": () => actions.exportActive("copy"),
    "templates.saveDrawing": actions.saveActiveAsTemplate,
    "navigator.searchTags": actions.searchTags,
    "navigator.newFolder": actions.newFolder,
    "navigator.newDrawingInFolder": actions.newDrawingInFolder,
    "navigator.collapseAll": actions.collapseAllFolders,
    "navigator.refresh": actions.refreshFiles,
    "file.rename": actions.renameActive,
    "file.move": actions.moveActive,
    "file.trash": actions.trashActive,
    "vault.reveal": actions.revealVault,
    "vault.revealRecovery": actions.revealRecovery,
    "vault.openRecovered": actions.openRecovered,
    "file.resolveConflict": actions.resolveConflict,
    "vault.retryWritable": actions.retryWritable,
    ...Object.fromEntries(
      SETTINGS_PAGES.filter((page) => page.id !== "hotkeys").map((page) => [
        settingsPageCommandId(page.id),
        () => actions.openSettingsPage(page.id),
      ]),
    ),
    [SETTINGS_PENS_COMMAND_ID]: () => actions.openSettingsPage("tools:pen"),
    ...Object.fromEntries(
      SORT_ORDERS.map((order) => [
        sortCommandId(order),
        () => actions.setSort(order),
      ]),
    ),
    ...PEN_COMMAND_HANDLERS,
    ...CONFIG_COMMAND_HANDLERS,
    ...HELP_LINK_HANDLERS,
    ...EXTENSION_COMMAND_HANDLERS,
    [HELP_COMMAND_IDS.about]: () => actions.openSettingsPage("about"),
    ...pluginUiHandlers(() => actions.openSettingsPage("plugins")),
  };
}
