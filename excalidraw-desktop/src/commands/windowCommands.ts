/**
 * Window commands. Minimize and maximize serve the Linux custom title bar: their handlers are
 * bound by components/WindowControls.tsx only while the app draws its own window buttons.
 * Quit and full screen are what the macOS app menu gives (Cmd+Q, Ctrl+Cmd+F); elsewhere there is
 * no app menu, so they are commands with the usual Linux keys (Ctrl+Q, F11; toimprove 308),
 * bound by VaultApp. On macOS the menu keeps the keys.
 */
import type { CommandDefinition } from "./types";

export const WINDOW_COMMAND_IDS = {
  minimize: "window.minimize",
  toggleMaximize: "window.toggleMaximize",
  toggleFullscreen: "window.toggleFullscreen",
  quit: "app.quit",
} as const;

export const WINDOW_COMMANDS: CommandDefinition[] = [
  {
    id: WINDOW_COMMAND_IDS.minimize,
    title: "Window: Minimize",
    category: "Window",
    keys: { default: [] },
  },
  {
    id: WINDOW_COMMAND_IDS.toggleMaximize,
    title: "Window: Maximize or restore",
    category: "Window",
    keys: { default: [] },
  },
  {
    id: WINDOW_COMMAND_IDS.toggleFullscreen,
    title: "Window: Toggle full screen",
    category: "Window",
    keys: { default: ["F11"], mac: [] },
  },
  {
    id: WINDOW_COMMAND_IDS.quit,
    title: "Window: Quit Vaultdraw",
    category: "Window",
    keys: { default: ["Mod+Q"], mac: [] },
  },
];
