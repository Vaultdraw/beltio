/**
 * Palette provider for Excalidraw's own commands (tools, align, group,
 * layers, flip, lock, grid, view modes, export, ...), read from the open
 * editor's getCommandPaletteItems().
 */
import type {
  EditorPaletteCommand,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import type { ActionName } from "@excalidraw/excalidraw/actions/types";

import {
  actionCommandId,
  isHostOwnedAction,
} from "../../commands/actionCommands";
import { commandShortcutLabel, excalidrawShortcutLabel } from "../shortcuts";

import type { HotkeyOverrides, Platform } from "../../commands/types";
import type { PaletteItem, PaletteProvider } from "../types";

/** Editor commands Vaultdraw does not offer, one reason each. */
export const EDITOR_PALETTE_EXCLUDED: Readonly<Record<string, string>> = {
  toggleTheme: "Vaultdraw has its own Mode: Light / Dark / System commands.",
  saveToActiveFile: "The vault autosaves; Mod+S is Vaultdraw's save.",
  saveFileToDisk: "The vault autosaves; use Export: Save a copy.",
  loadScene: "Opening a file would replace the drawing the vault owns.",
  textToDiagram: "AI / network feature; Vaultdraw is offline.",
  library: "Replaced by the editor-owned Library command (library.toggle).",
};

interface Deps {
  platform: Platform;
  /**
   * The editor ignores input (interaction off): list nothing. A view-only
   * editor needs no check here: Excalidraw's view-mode rule already marks
   * mutating commands unavailable (VaultEditor passes readOnly as
   * viewModeEnabled).
   */
  disabled(): boolean;
  /**
   * Live `[hotkeys]` overrides: an action that is a canvas.* command shows
   * the user's key, not Excalidraw's. Default: no overrides.
   */
  overrides?(): HotkeyOverrides;
}

function toItem(
  cmd: EditorPaletteCommand,
  platform: Platform,
  overrides: HotkeyOverrides,
): PaletteItem {
  return {
    key: `editor:${cmd.id}`,
    title: cmd.label,
    keywords: cmd.keywords,
    group: cmd.category,
    shortcut: isHostOwnedAction(cmd.id)
      ? commandShortcutLabel(
          actionCommandId(cmd.id as ActionName),
          overrides,
          platform,
        )
      : excalidrawShortcutLabel(cmd.shortcut, platform),
    icon: cmd.icon,
    run: cmd.perform,
  };
}

export function createEditorProvider(
  getApi: () => ExcalidrawImperativeAPI | null,
  deps: Deps,
): PaletteProvider {
  return {
    id: "editor",
    items() {
      const api = getApi();
      if (!api || api.isDestroyed || deps.disabled()) {
        return [];
      }
      const overrides = deps.overrides?.() ?? {};
      return api
        .getCommandPaletteItems()
        .filter((cmd) => cmd.available && !(cmd.id in EDITOR_PALETTE_EXCLUDED))
        .map((cmd) => toItem(cmd, deps.platform, overrides));
    },
  };
}
