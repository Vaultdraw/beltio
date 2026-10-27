/**
 * Window commands for the Linux custom title bar. Handlers are bound by
 * components/WindowControls.tsx only while the app draws its own window
 * buttons, so elsewhere the commands are unavailable.
 */
import type { CommandDefinition } from "./types";

export const WINDOW_COMMAND_IDS = {
  minimize: "window.minimize",
  toggleMaximize: "window.toggleMaximize",
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
];
